"""Native Forge exercise library, plans, and explicit-save AI drafts."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import (
    ForgeExercise,
    ForgeMachineProfile,
    ForgePlanExercise,
    ForgePlanSet,
    ForgeProgramRoutine,
    ForgeSessionExercise,
    ForgeSessionMessage,
    ForgeSessionSet,
    ForgeTrainingPlan,
    ForgeTrainingProgram,
    ForgeWorkoutSession,
    User,
)
from app.schemas import (
    ForgeDraftResponse,
    ForgeExerciseDraftRequest,
    ForgeExerciseInput,
    ForgeExerciseResponse,
    ForgePlanDraftRequest,
    ForgePlanInput,
    ForgePlanResponse,
    ForgeProgramInput,
    ForgeProgramResponse,
    ForgeSessionChatRequest,
    ForgeSessionExerciseInput,
    ForgeSessionExerciseUpdate,
    ForgeSessionResponse,
    ForgeSessionSetInput,
    ForgeStartSessionRequest,
    ForgeTodayResponse,
    ForgeApplySessionActionRequest,
)
from app.services.ai_service import (
    _build_deterministic_set_targets,
    _compute_exercise_progression,
    generate_forge_exercise_draft,
    generate_forge_plan_draft,
    generate_forge_session_chat,
)

router = APIRouter(prefix="/api/forge", tags=["Forge"])


def _not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _serialize_profile(profile: ForgeMachineProfile | None) -> dict | None:
    if profile is None:
        return None
    return {"id": profile.id, "name": profile.name, "model": profile.model, "notes": profile.notes}


def _serialize_exercise(exercise: ForgeExercise) -> dict:
    return {
        "id": exercise.id,
        "name": exercise.name,
        "icon": exercise.icon,
        "equipment": exercise.equipment,
        "primary_muscle_group": exercise.primary_muscle_group,
        "secondary_muscle_groups": exercise.secondary_muscle_groups or [],
        "machine_profiles": [_serialize_profile(profile) for profile in exercise.machine_profiles],
    }


def _serialize_plan(plan: ForgeTrainingPlan) -> dict:
    return {
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "position": plan.position,
        "exercises": [
            {
                "id": plan_exercise.id,
                "position": plan_exercise.position,
                "notes": plan_exercise.notes,
                "exercise": _serialize_exercise(plan_exercise.exercise),
                "machine_profile": _serialize_profile(plan_exercise.machine_profile),
                "sets": [
                    {
                        "id": plan_set.id,
                        "position": plan_set.position,
                        "set_type": plan_set.set_type,
                        "previous_weight_kg": plan_set.previous_weight_kg,
                        "previous_reps": plan_set.previous_reps,
                        "current_weight_kg": plan_set.current_weight_kg,
                        "current_reps": plan_set.current_reps,
                        "coach_suggested_weight_kg": plan_set.coach_suggested_weight_kg,
                        "coach_suggested_reps": plan_set.coach_suggested_reps,
                        "note": plan_set.note,
                    }
                    for plan_set in plan_exercise.sets
                ],
            }
            for plan_exercise in plan.exercises
        ],
    }


def _validate_exercise_input(data: ForgeExerciseInput) -> None:
    if data.equipment != "machine" and data.machine_profiles:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Machine profiles are only valid for machine exercises.",
        )
    if len(set(data.secondary_muscle_groups)) != len(data.secondary_muscle_groups):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Secondary muscle groups must be unique.")


def _apply_exercise_input(exercise: ForgeExercise, data: ForgeExerciseInput) -> None:
    _validate_exercise_input(data)
    exercise.name = data.name.strip()
    exercise.icon = data.icon.strip()
    exercise.equipment = data.equipment
    exercise.primary_muscle_group = data.primary_muscle_group.strip()
    exercise.secondary_muscle_groups = [group.strip() for group in data.secondary_muscle_groups]
    exercise.machine_profiles.clear()
    for profile in data.machine_profiles:
        exercise.machine_profiles.append(
            ForgeMachineProfile(name=profile.name.strip(), model=profile.model, notes=profile.notes)
        )


def _owned_exercises(db: Session, user_id: UUID, exercise_ids: list[UUID]) -> dict[UUID, ForgeExercise]:
    exercises = db.query(ForgeExercise).filter(ForgeExercise.user_id == user_id, ForgeExercise.id.in_(exercise_ids)).all()
    by_id = {exercise.id: exercise for exercise in exercises}
    if len(by_id) != len(set(exercise_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more exercises do not belong to you.")
    return by_id


def _replace_plan_exercises(db: Session, plan: ForgeTrainingPlan, plan_input: ForgePlanInput, user_id: UUID) -> None:
    exercise_ids = [entry.exercise_id for entry in plan_input.exercises]
    exercises_by_id = _owned_exercises(db, user_id, exercise_ids) if exercise_ids else {}
    profile_ids = [entry.machine_profile_id for entry in plan_input.exercises if entry.machine_profile_id]
    profiles_by_id: dict[UUID, ForgeMachineProfile] = {}
    if profile_ids:
        profiles = db.query(ForgeMachineProfile).join(ForgeExercise).filter(
            ForgeExercise.user_id == user_id,
            ForgeMachineProfile.id.in_(profile_ids),
        ).all()
        profiles_by_id = {profile.id: profile for profile in profiles}
        if len(profiles_by_id) != len(set(profile_ids)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more machine profiles do not belong to you.")

    plan.exercises.clear()
    db.flush()
    for position, entry in enumerate(plan_input.exercises):
        exercise = exercises_by_id[entry.exercise_id]
        profile = profiles_by_id.get(entry.machine_profile_id) if entry.machine_profile_id else None
        if profile is not None and profile.exercise_id != exercise.id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The selected machine profile belongs to another exercise.")
        if profile is not None and exercise.equipment != "machine":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only machine exercises can use a machine profile.")
        plan_exercise = ForgePlanExercise(
            exercise=exercise,
            machine_profile=profile,
            position=position,
            notes=entry.notes,
        )
        for set_position, set_input in enumerate(entry.sets):
            plan_exercise.sets.append(ForgePlanSet(
                position=set_position,
                set_type=set_input.set_type,
                previous_weight_kg=set_input.previous_weight_kg,
                previous_reps=set_input.previous_reps,
                current_weight_kg=set_input.current_weight_kg,
                current_reps=set_input.current_reps,
                coach_suggested_weight_kg=set_input.coach_suggested_weight_kg,
                coach_suggested_reps=set_input.coach_suggested_reps,
                note=set_input.note,
            ))
        plan.exercises.append(plan_exercise)


@router.get("/exercises", response_model=list[ForgeExerciseResponse])
async def list_exercises(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercises = db.query(ForgeExercise).filter(ForgeExercise.user_id == current_user.id).order_by(ForgeExercise.name).all()
    return [_serialize_exercise(exercise) for exercise in exercises]


@router.post("/exercises", response_model=ForgeExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    data: ForgeExerciseInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercise = ForgeExercise(user_id=current_user.id)
    _apply_exercise_input(exercise, data)
    db.add(exercise)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have an exercise with this name.")
    db.refresh(exercise)
    return _serialize_exercise(exercise)


@router.put("/exercises/{exercise_id}", response_model=ForgeExerciseResponse)
async def update_exercise(
    exercise_id: UUID,
    data: ForgeExerciseInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercise = db.query(ForgeExercise).filter(ForgeExercise.id == exercise_id, ForgeExercise.user_id == current_user.id).first()
    if exercise is None:
        raise _not_found("Exercise not found")
    _apply_exercise_input(exercise, data)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have an exercise with this name.")
    db.refresh(exercise)
    return _serialize_exercise(exercise)


@router.delete("/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exercise(
    exercise_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercise = db.query(ForgeExercise).filter(ForgeExercise.id == exercise_id, ForgeExercise.user_id == current_user.id).first()
    if exercise is None:
        raise _not_found("Exercise not found")
    db.delete(exercise)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Remove this exercise from your plans before deleting it.")


@router.get("/plans", response_model=list[ForgePlanResponse])
async def list_plans(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plans = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.user_id == current_user.id).order_by(ForgeTrainingPlan.position, ForgeTrainingPlan.created_at).all()
    return [_serialize_plan(plan) for plan in plans]


@router.post("/plans", response_model=ForgePlanResponse, status_code=status.HTTP_201_CREATED)
async def create_plan(
    data: ForgePlanInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = ForgeTrainingPlan(user_id=current_user.id, name=data.name.strip(), description=data.description, position=data.position)
    db.add(plan)
    db.flush()
    _replace_plan_exercises(db, plan, data, current_user.id)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)


@router.put("/plans/{plan_id}", response_model=ForgePlanResponse)
async def update_plan(
    plan_id: UUID,
    data: ForgePlanInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.id == plan_id, ForgeTrainingPlan.user_id == current_user.id).first()
    if plan is None:
        raise _not_found("Training plan not found")
    plan.name = data.name.strip()
    plan.description = data.description
    plan.position = data.position
    _replace_plan_exercises(db, plan, data, current_user.id)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.id == plan_id, ForgeTrainingPlan.user_id == current_user.id).first()
    if plan is None:
        raise _not_found("Training plan not found")
    db.delete(plan)
    db.commit()


@router.post("/drafts/exercise", response_model=ForgeDraftResponse)
async def create_exercise_draft(
    data: ForgeExerciseDraftRequest,
    current_user: User = Depends(get_current_user),
):
    draft = await generate_forge_exercise_draft(data.instructions, current_user.language or "de")
    return {"draft": draft}


@router.post("/drafts/plan", response_model=ForgeDraftResponse)
async def create_plan_draft(
    data: ForgePlanDraftRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercises_by_id = _owned_exercises(db, current_user.id, data.exercise_ids)
    catalog = []
    for exercise_id in data.exercise_ids:
        exercise = exercises_by_id[exercise_id]
        catalog.append({
            "id": str(exercise.id),
            "name": exercise.name,
            "equipment": exercise.equipment,
            "primary_muscle_group": exercise.primary_muscle_group,
            "secondary_muscle_groups": exercise.secondary_muscle_groups or [],
            "machine_profiles": [
                {"id": str(profile.id), "name": profile.name, "model": profile.model}
                for profile in exercise.machine_profiles
            ],
        })
    draft = await generate_forge_plan_draft(
        data.instructions,
        catalog,
        current_user.language or "de",
        current_user.current_goal or "",
    )
    return {"draft": draft}


# ── Programs, today's routine, and native sessions ──────────────────────────

def _serialize_program(program: ForgeTrainingProgram) -> dict:
    return {
        "id": program.id,
        "name": program.name,
        "mode": program.mode,
        "is_active": program.is_active,
        "rotation_cursor": program.rotation_cursor,
        "routines": [
            {
                "id": routine.id,
                "position": routine.position,
                "weekdays": routine.weekdays or [],
                "plan": _serialize_plan(routine.plan),
            }
            for routine in program.routines
        ],
    }


def _serialize_session(session: ForgeWorkoutSession) -> dict:
    return {
        "id": session.id,
        "program_id": session.program_id,
        "source_plan_id": session.source_plan_id,
        "name": session.name,
        "status": session.status,
        "started_at": session.started_at,
        "completed_at": session.completed_at,
        "exercises": [
            {
                "id": exercise.id,
                "source_exercise_id": exercise.source_exercise_id,
                "name": exercise.name,
                "icon": exercise.icon,
                "equipment": exercise.equipment,
                "primary_muscle_group": exercise.primary_muscle_group,
                "secondary_muscle_groups": exercise.secondary_muscle_groups or [],
                "machine_profile_name": exercise.machine_profile_name,
                "notes": exercise.notes,
                "position": exercise.position,
                "sets": [
                    {
                        "id": set_data.id,
                        "position": set_data.position,
                        "set_type": set_data.set_type,
                        "target_weight_kg": set_data.target_weight_kg,
                        "target_reps": set_data.target_reps,
                        "actual_weight_kg": set_data.actual_weight_kg,
                        "actual_reps": set_data.actual_reps,
                        "coach_suggested_weight_kg": set_data.coach_suggested_weight_kg,
                        "coach_suggested_reps": set_data.coach_suggested_reps,
                        "completed": set_data.completed,
                        "note": set_data.note,
                    }
                    for set_data in exercise.sets
                ],
            }
            for exercise in session.exercises
        ],
        "messages": [
            {
                "id": message.id,
                "role": message.role,
                "content": message.content,
                "proposed_action": message.proposed_action,
                "action_status": message.action_status,
                "created_at": message.created_at,
            }
            for message in session.messages
        ],
    }


def _owned_plan(db: Session, user_id: UUID, plan_id: UUID) -> ForgeTrainingPlan:
    plan = db.query(ForgeTrainingPlan).filter(
        ForgeTrainingPlan.id == plan_id,
        ForgeTrainingPlan.user_id == user_id,
    ).first()
    if plan is None:
        raise _not_found("Routine not found")
    return plan


def _owned_program(db: Session, user_id: UUID, program_id: UUID) -> ForgeTrainingProgram:
    program = db.query(ForgeTrainingProgram).filter(
        ForgeTrainingProgram.id == program_id,
        ForgeTrainingProgram.user_id == user_id,
    ).first()
    if program is None:
        raise _not_found("Training program not found")
    return program


def _owned_session(db: Session, user_id: UUID, session_id: UUID) -> ForgeWorkoutSession:
    session = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.id == session_id,
        ForgeWorkoutSession.user_id == user_id,
    ).first()
    if session is None:
        raise _not_found("Session not found")
    return session


def _apply_program_input(db: Session, program: ForgeTrainingProgram, data: ForgeProgramInput, user_id: UUID) -> None:
    plan_ids = [routine.plan_id for routine in data.routines]
    plans = db.query(ForgeTrainingPlan).filter(
        ForgeTrainingPlan.user_id == user_id,
        ForgeTrainingPlan.id.in_(plan_ids),
    ).all() if plan_ids else []
    if len({plan.id for plan in plans}) != len(set(plan_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more routines do not belong to you.")
    if len(set(plan_ids)) != len(plan_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A routine can only appear once in a program.")
    for routine in data.routines:
        if any(day < 0 or day > 6 for day in routine.weekdays):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Weekdays must be between Monday (0) and Sunday (6).")
    if data.mode == "weekly" and any(not routine.weekdays for routine in data.routines):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Every weekly routine needs at least one weekday.")

    program.name = data.name.strip()
    program.mode = data.mode
    program.is_active = data.is_active
    if data.is_active:
        db.query(ForgeTrainingProgram).filter(
            ForgeTrainingProgram.user_id == user_id,
            ForgeTrainingProgram.id != program.id,
        ).update({ForgeTrainingProgram.is_active: False}, synchronize_session=False)
    program.routines.clear()
    db.flush()
    for position, routine in enumerate(data.routines):
        program.routines.append(ForgeProgramRoutine(
            plan_id=routine.plan_id,
            position=position,
            weekdays=sorted(set(routine.weekdays)),
        ))
    if program.rotation_cursor >= max(len(data.routines), 1):
        program.rotation_cursor = 0


@router.get("/programs", response_model=list[ForgeProgramResponse])
async def list_programs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    programs = db.query(ForgeTrainingProgram).filter(ForgeTrainingProgram.user_id == current_user.id).order_by(ForgeTrainingProgram.created_at).all()
    return [_serialize_program(program) for program in programs]


@router.post("/programs", response_model=ForgeProgramResponse, status_code=status.HTTP_201_CREATED)
async def create_program(data: ForgeProgramInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = ForgeTrainingProgram(user_id=current_user.id, name=data.name.strip(), mode=data.mode, is_active=data.is_active)
    db.add(program)
    db.flush()
    _apply_program_input(db, program, data, current_user.id)
    db.commit()
    db.refresh(program)
    return _serialize_program(program)


@router.put("/programs/{program_id}", response_model=ForgeProgramResponse)
async def update_program(program_id: UUID, data: ForgeProgramInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = _owned_program(db, current_user.id, program_id)
    _apply_program_input(db, program, data, current_user.id)
    db.commit()
    db.refresh(program)
    return _serialize_program(program)


@router.delete("/programs/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_program(program_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = _owned_program(db, current_user.id, program_id)
    db.delete(program)
    db.commit()


@router.get("/today", response_model=ForgeTodayResponse)
async def get_today_routine(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = db.query(ForgeTrainingProgram).filter(
        ForgeTrainingProgram.user_id == current_user.id,
        ForgeTrainingProgram.is_active.is_(True),
    ).order_by(ForgeTrainingProgram.created_at).first()
    if program is None or not program.routines:
        return {"message": "Kein aktiver Trainingsplan eingerichtet."}

    routines = list(program.routines)
    if program.mode == "weekly":
        weekday = datetime.now(timezone.utc).astimezone().weekday()
        options = [routine.plan for routine in routines if weekday in (routine.weekdays or [])]
        if not options:
            return {"mode": "weekly", "program": _serialize_program(program), "message": "Heute ist kein Training geplant."}
        return {
            "mode": "weekly",
            "program": _serialize_program(program),
            "routine": _serialize_plan(options[0]),
            "options": [_serialize_plan(option) for option in options],
            "message": "Heutige geplante Routine.",
        }

    routine = routines[program.rotation_cursor % len(routines)].plan
    return {
        "mode": "rotation",
        "program": _serialize_program(program),
        "routine": _serialize_plan(routine),
        "options": [_serialize_plan(item.plan) for item in routines],
        "message": "Nächste Routine in deiner Rotation.",
    }


def _snapshot_plan_into_session(plan: ForgeTrainingPlan, session: ForgeWorkoutSession) -> None:
    for exercise_position, plan_exercise in enumerate(plan.exercises):
        exercise = plan_exercise.exercise
        session_exercise = ForgeSessionExercise(
            source_exercise_id=exercise.id,
            source_plan_exercise_id=plan_exercise.id,
            name=exercise.name,
            icon=exercise.icon,
            equipment=exercise.equipment,
            primary_muscle_group=exercise.primary_muscle_group,
            secondary_muscle_groups=exercise.secondary_muscle_groups or [],
            machine_profile_name=plan_exercise.machine_profile.name if plan_exercise.machine_profile else None,
            notes=plan_exercise.notes,
            position=exercise_position,
        )
        for set_position, plan_set in enumerate(plan_exercise.sets):
            session_exercise.sets.append(ForgeSessionSet(
                position=set_position,
                set_type=plan_set.set_type,
                target_weight_kg=plan_set.coach_suggested_weight_kg if plan_set.coach_suggested_weight_kg is not None else plan_set.current_weight_kg,
                target_reps=plan_set.coach_suggested_reps if plan_set.coach_suggested_reps is not None else plan_set.current_reps,
                coach_suggested_weight_kg=plan_set.coach_suggested_weight_kg,
                coach_suggested_reps=plan_set.coach_suggested_reps,
                note=plan_set.note,
            ))
        session.exercises.append(session_exercise)


@router.post("/sessions", response_model=ForgeSessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(data: ForgeStartSessionRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active_session = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == current_user.id,
        ForgeWorkoutSession.status == "active",
    ).order_by(ForgeWorkoutSession.started_at.desc()).first()
    if active_session is not None:
        return _serialize_session(active_session)

    plan = _owned_plan(db, current_user.id, data.plan_id)
    program = _owned_program(db, current_user.id, data.program_id) if data.program_id else None
    if program is not None and not any(link.plan_id == plan.id for link in program.routines):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This routine is not part of the selected program.")
    _refresh_native_coach_targets(db, current_user.id, plan)
    session = ForgeWorkoutSession(
        user_id=current_user.id,
        program_id=program.id if program else None,
        source_plan_id=plan.id,
        name=plan.name,
        status="active",
    )
    _snapshot_plan_into_session(plan, session)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.get("/sessions/{session_id}", response_model=ForgeSessionResponse)
async def get_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _serialize_session(_owned_session(db, current_user.id, session_id))


@router.post("/sessions/{session_id}/exercises", response_model=ForgeSessionResponse)
async def add_session_exercise(session_id: UUID, data: ForgeSessionExerciseInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    exercise = None
    if data.exercise_id:
        exercise = db.query(ForgeExercise).filter(ForgeExercise.id == data.exercise_id, ForgeExercise.user_id == current_user.id).first()
        if exercise is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Exercise does not belong to you.")
    if exercise is None and not (data.name or "").strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose a library exercise or supply a name.")
    session_exercise = ForgeSessionExercise(
        source_exercise_id=exercise.id if exercise else None,
        name=exercise.name if exercise else data.name.strip(),
        icon=exercise.icon if exercise else "Dumbbell",
        equipment=exercise.equipment if exercise else "other",
        primary_muscle_group=exercise.primary_muscle_group if exercise else "Other",
        secondary_muscle_groups=exercise.secondary_muscle_groups if exercise else [],
        machine_profile_name=data.machine_profile_name,
        notes=data.notes,
        position=len(session.exercises),
    )
    for position, set_data in enumerate(data.sets):
        session_exercise.sets.append(ForgeSessionSet(position=position, **set_data.model_dump()))
    session.exercises.append(session_exercise)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.patch("/sessions/{session_id}/exercises/{session_exercise_id}", response_model=ForgeSessionResponse)
async def update_session_exercise(session_id: UUID, session_exercise_id: UUID, data: ForgeSessionExerciseUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    exercise = next((item for item in session.exercises if item.id == session_exercise_id), None)
    if exercise is None:
        raise _not_found("Session exercise not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(exercise, key, value)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.patch("/sessions/{session_id}/sets/{set_id}", response_model=ForgeSessionResponse)
async def update_session_set(session_id: UUID, set_id: UUID, data: ForgeSessionSetInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    set_data = db.query(ForgeSessionSet).join(ForgeSessionExercise).filter(
        ForgeSessionSet.id == set_id,
        ForgeSessionExercise.session_id == session.id,
    ).first()
    if set_data is None:
        raise _not_found("Set not found")
    for key, value in data.model_dump().items():
        setattr(set_data, key, value)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/exercises/{session_exercise_id}/sets", response_model=ForgeSessionResponse)
async def add_session_set(session_id: UUID, session_exercise_id: UUID, data: ForgeSessionSetInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    exercise = next((item for item in session.exercises if item.id == session_exercise_id), None)
    if exercise is None:
        raise _not_found("Session exercise not found")
    exercise.sets.append(ForgeSessionSet(position=len(exercise.sets), **data.model_dump()))
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.delete("/sessions/{session_id}/sets/{set_id}", response_model=ForgeSessionResponse)
async def delete_session_set(session_id: UUID, set_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    set_data = db.query(ForgeSessionSet).join(ForgeSessionExercise).filter(
        ForgeSessionSet.id == set_id,
        ForgeSessionExercise.session_id == session.id,
    ).first()
    if set_data is None:
        raise _not_found("Set not found")
    exercise_id = set_data.session_exercise_id
    db.delete(set_data)
    db.flush()
    remaining_sets = db.query(ForgeSessionSet).filter(
        ForgeSessionSet.session_exercise_id == exercise_id,
    ).order_by(ForgeSessionSet.position).all()
    for position, remaining in enumerate(remaining_sets):
        remaining.position = position
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.delete("/sessions/{session_id}/exercises/{session_exercise_id}", response_model=ForgeSessionResponse)
async def delete_session_exercise(session_id: UUID, session_exercise_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    exercise = next((item for item in session.exercises if item.id == session_exercise_id), None)
    if exercise is None:
        raise _not_found("Session exercise not found")
    db.delete(exercise)
    db.flush()
    remaining_exercises = db.query(ForgeSessionExercise).filter(
        ForgeSessionExercise.session_id == session.id,
    ).order_by(ForgeSessionExercise.position).all()
    for position, remaining in enumerate(remaining_exercises):
        remaining.position = position
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/complete", response_model=ForgeSessionResponse)
async def complete_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status == "completed":
        return _serialize_session(session)
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)
    if session.program and session.program.mode == "rotation" and session.program.routines:
        current = session.program.routines[session.program.rotation_cursor % len(session.program.routines)]
        if current.plan_id == session.source_plan_id:
            session.program.rotation_cursor = (session.program.rotation_cursor + 1) % len(session.program.routines)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


def _session_context(session: ForgeWorkoutSession) -> dict:
    return {
        "session_id": str(session.id),
        "name": session.name,
        "exercises": [
            {
                "id": str(exercise.id),
                "name": exercise.name,
                "machine_profile": exercise.machine_profile_name,
                "sets": [
                    {
                        "id": str(set_data.id),
                        "target": {"weight_kg": set_data.target_weight_kg, "reps": set_data.target_reps},
                        "actual": {"weight_kg": set_data.actual_weight_kg, "reps": set_data.actual_reps},
                        "completed": set_data.completed,
                    }
                    for set_data in exercise.sets
                ],
            }
            for exercise in session.exercises
        ],
    }


def _validate_session_action(action: dict | None, session: ForgeWorkoutSession, user_id: UUID, db: Session) -> dict | None:
    if not isinstance(action, dict) or action.get("type") not in {"adjust_set", "add_set", "add_exercise"}:
        return None
    payload = action.get("payload")
    if not isinstance(payload, dict):
        return None
    session_set_ids = {str(set_data.id) for exercise in session.exercises for set_data in exercise.sets}
    session_exercise_ids = {str(exercise.id) for exercise in session.exercises}
    if action["type"] == "adjust_set":
        if str(payload.get("session_set_id")) not in session_set_ids:
            return None
        if not isinstance(payload.get("target_reps"), int) or not 1 <= payload["target_reps"] <= 200:
            return None
        if payload.get("target_weight_kg") is not None and not isinstance(payload["target_weight_kg"], (int, float)):
            return None
    elif action["type"] == "add_set":
        if str(payload.get("session_exercise_id")) not in session_exercise_ids:
            return None
        if not isinstance(payload.get("target_reps"), int) or not 1 <= payload["target_reps"] <= 200:
            return None
    else:
        try:
            exercise_id = UUID(str(payload.get("exercise_id")))
        except (ValueError, TypeError):
            return None
        if db.query(ForgeExercise).filter(ForgeExercise.id == exercise_id, ForgeExercise.user_id == user_id).first() is None:
            return None
    return action


@router.post("/sessions/{session_id}/chat", response_model=ForgeSessionResponse)
async def session_chat(session_id: UUID, data: ForgeSessionChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    user_message = ForgeSessionMessage(session_id=session.id, role="user", content=data.message.strip())
    db.add(user_message)
    db.flush()
    history = [{"role": message.role, "content": message.content} for message in session.messages[-12:]]
    library = db.query(ForgeExercise).filter(ForgeExercise.user_id == current_user.id).all()
    catalog = [{"id": str(exercise.id), "name": exercise.name, "primary_muscle_group": exercise.primary_muscle_group} for exercise in library]
    response = await generate_forge_session_chat(
        data.message.strip(),
        _session_context(session),
        catalog,
        history,
        current_user.language or "de",
    )
    action = _validate_session_action(response.get("action"), session, current_user.id, db)
    assistant_message = ForgeSessionMessage(
        session_id=session.id,
        role="assistant",
        content=response.get("message") or "Ich konnte dafür gerade keinen sicheren Vorschlag bilden.",
        proposed_action=action,
        action_status="pending" if action else None,
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/actions/apply", response_model=ForgeSessionResponse)
async def apply_session_action(session_id: UUID, data: ForgeApplySessionActionRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    message = db.query(ForgeSessionMessage).filter(
        ForgeSessionMessage.id == data.message_id,
        ForgeSessionMessage.session_id == session.id,
        ForgeSessionMessage.role == "assistant",
        ForgeSessionMessage.action_status == "pending",
    ).first()
    if message is None:
        raise _not_found("Pending action not found")
    action = _validate_session_action(message.proposed_action, session, current_user.id, db)
    if action is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This action is no longer valid.")
    payload = action["payload"]
    if action["type"] == "adjust_set":
        set_data = db.query(ForgeSessionSet).filter(ForgeSessionSet.id == UUID(payload["session_set_id"])).first()
        set_data.target_weight_kg = payload.get("target_weight_kg")
        set_data.target_reps = payload["target_reps"]
    elif action["type"] == "add_set":
        exercise = db.query(ForgeSessionExercise).filter(ForgeSessionExercise.id == UUID(payload["session_exercise_id"])).first()
        exercise.sets.append(ForgeSessionSet(
            position=len(exercise.sets),
            set_type="working",
            target_weight_kg=payload.get("target_weight_kg"),
            target_reps=payload["target_reps"],
            note=payload.get("note"),
        ))
    else:
        exercise = db.query(ForgeExercise).filter(ForgeExercise.id == UUID(payload["exercise_id"]), ForgeExercise.user_id == current_user.id).first()
        session_exercise = ForgeSessionExercise(
            source_exercise_id=exercise.id,
            name=exercise.name,
            icon=exercise.icon,
            equipment=exercise.equipment,
            primary_muscle_group=exercise.primary_muscle_group,
            secondary_muscle_groups=exercise.secondary_muscle_groups or [],
            position=len(session.exercises),
            notes=payload.get("notes"),
        )
        session_exercise.sets.append(ForgeSessionSet(position=0, set_type="working", target_reps=payload.get("target_reps", 10)))
        session.exercises.append(session_exercise)
    message.action_status = "applied"
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/actions/dismiss", response_model=ForgeSessionResponse)
async def dismiss_session_action(session_id: UUID, data: ForgeApplySessionActionRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    message = db.query(ForgeSessionMessage).filter(
        ForgeSessionMessage.id == data.message_id,
        ForgeSessionMessage.session_id == session.id,
        ForgeSessionMessage.role == "assistant",
        ForgeSessionMessage.action_status == "pending",
    ).first()
    if message is None:
        raise _not_found("Pending action not found")
    message.action_status = "dismissed"
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


# ── Native-only progression adapter ─────────────────────────────────────────

def _native_plan_template(plan: ForgeTrainingPlan) -> list[dict]:
    """Normalize a native routine into the deterministic progression template shape."""
    template = []
    for plan_exercise in plan.exercises:
        note_parts = [part for part in [plan_exercise.notes, plan_exercise.machine_profile.notes if plan_exercise.machine_profile else None] if part]
        template.append({
            "title": plan_exercise.exercise.name,
            "muscle_group": plan_exercise.exercise.primary_muscle_group,
            "notes": "\n".join(note_parts),
            "sets": [
                {
                    "type": plan_set.set_type,
                    "weight_kg": plan_set.current_weight_kg,
                    "reps": plan_set.current_reps,
                }
                for plan_set in plan_exercise.sets
            ],
        })
    return template


def _native_completed_sessions(db: Session, user_id: UUID, plan: ForgeTrainingPlan) -> list[dict]:
    """Return completed native sessions in the legacy-neutral shape used by progression."""
    sessions = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.source_plan_id == plan.id,
        ForgeWorkoutSession.status == "completed",
    ).order_by(ForgeWorkoutSession.completed_at.desc()).all()
    return [
        {
            "id": str(session.id),
            "title": plan.name,
            "start_time": (session.completed_at or session.started_at).isoformat(),
            "exercises": [
                {
                    "title": exercise.name,
                    "muscle_group": exercise.primary_muscle_group,
                    "notes": exercise.notes or "",
                    "sets": [
                        {
                            "type": set_data.set_type,
                            # Progression is based solely on what was actually logged.
                            "weight_kg": set_data.actual_weight_kg,
                            "reps": set_data.actual_reps,
                        }
                        for set_data in exercise.sets
                        if set_data.actual_weight_kg is not None and set_data.actual_reps is not None
                    ],
                }
                for exercise in session.exercises
            ],
        }
        for session in sessions
    ]


def _refresh_native_coach_targets(db: Session, user_id: UUID, plan: ForgeTrainingPlan) -> tuple[dict, list[dict]]:
    """Persist previous performance and deterministic coach suggestions without Hevy."""
    template = _native_plan_template(plan)
    history = _native_completed_sessions(db, user_id, plan)
    progression = _compute_exercise_progression(history, template)
    targets = _build_deterministic_set_targets(template, progression, [])
    targets_by_name = {target["name"].strip().lower(): target for target in targets}

    latest_by_name: dict[str, dict] = {}
    if history:
        latest_by_name = {
            exercise.get("title", "").strip().lower(): exercise
            for exercise in history[0].get("exercises", [])
        }

    for plan_exercise in plan.exercises:
        exercise_key = plan_exercise.exercise.name.strip().lower()
        target = targets_by_name.get(exercise_key)
        latest = latest_by_name.get(exercise_key, {})
        latest_sets = latest.get("sets", [])
        target_sets = target.get("set_targets", []) if target else []
        for position, plan_set in enumerate(plan_exercise.sets):
            if position < len(latest_sets):
                plan_set.previous_weight_kg = latest_sets[position].get("weight_kg")
                plan_set.previous_reps = latest_sets[position].get("reps")
            if position < len(target_sets):
                plan_set.coach_suggested_weight_kg = target_sets[position].get("weight_kg")
                plan_set.coach_suggested_reps = target_sets[position].get("reps")
    return progression, targets


@router.post("/plans/{plan_id}/coach-targets", response_model=ForgePlanResponse)
async def refresh_plan_coach_targets(plan_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Refresh plan coach columns using only completed native Forge sessions."""
    plan = _owned_plan(db, current_user.id, plan_id)
    _refresh_native_coach_targets(db, current_user.id, plan)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)
