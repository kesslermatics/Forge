"""Native Forge exercise library, plans, and explicit-save AI drafts."""
from datetime import date, datetime, timezone
from math import isfinite
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.encryption import decrypt_value
from app.models import (
    ForgeExercise,
    ForgeMachineProfile,
    ForgePlanExercise,
    ForgePlanSet,
    ForgeProgressPhoto,
    ForgeProgramRoutine,
    ForgeSessionExercise,
    ForgeSessionMessage,
    ForgeSessionSet,
    ForgeTrainingPlan,
    ForgeTrainingProgram,
    ForgeWorkoutSession,
    User,
    WeightEntry,
)
from app.schemas import (
    ForgeDraftResponse,
    ForgeExerciseDraftRequest,
    ForgeExerciseHistoryResponse,
    ForgeExerciseInput,
    ForgeExerciseResponse,
    ForgePlanDraftRequest,
    ForgePlanInput,
    ForgePlanResponse,
    ForgeProgressPhotoListResponse,
    ForgeProgressPhotoResponse,
    ForgeProgressPhotoUpdate,
    ForgeProgramInput,
    ForgeProgramResponse,
    ForgeSessionChatRequest,
    ForgeSessionExerciseInput,
    ForgeSessionExerciseUpdate,
    ForgeSessionResponse,
    ForgeSessionSummaryResponse,
    ForgeSessionSetInput,
    ForgeSessionSetUpdate,
    ForgeStartSessionRequest,
    ForgeTodayResponse,
    ForgeApplySessionActionRequest,
)
from app.services.progress_photo_storage import (
    PhotoStorageUnavailable,
    delete_progress_photo as delete_progress_photo_file,
    prepare_progress_photo,
    read_progress_photo,
    storage_root,
    storage_unavailable_error,
    write_progress_photo,
)
from app.services.ai_service import (
    _build_deterministic_set_targets,
    _compute_exercise_progression,
    generate_forge_exercise_draft,
    generate_forge_plan_draft,
    generate_forge_session_chat,
    generate_forge_session_start_coaching,
)
from app.services.yazio_service import resolve_yazio_goal_context

router = APIRouter(prefix="/api/forge", tags=["Forge"])


async def _yazio_goal_context(user: User) -> dict:
    """Resolve coaching goals only from Yazio; never fall back to Forge profile data."""
    if not user.yazio_email or not user.yazio_password:
        return {"available": False, "source": "unavailable", "goal": None, "profile": {}, "nutrition": None}
    try:
        return await resolve_yazio_goal_context(
            decrypt_value(user.yazio_email),
            decrypt_value(user.yazio_password),
            target_date=date.today(),
        )
    except Exception:
        return {"available": False, "source": "unavailable", "goal": None, "profile": {}, "nutrition": None}


def _not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _validate_progress_photo_date(taken_on: date) -> None:
    if taken_on > date.today():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A progress photo cannot be dated in the future.")


def _owned_progress_photo(db: Session, user_id: UUID, photo_id: UUID) -> ForgeProgressPhoto:
    photo = db.query(ForgeProgressPhoto).filter(
        ForgeProgressPhoto.id == photo_id,
        ForgeProgressPhoto.user_id == user_id,
    ).first()
    if photo is None:
        raise _not_found("Progress photo not found")
    return photo


def _progress_photo_context(db: Session, user: User, taken_on: date) -> dict:
    """Read-only account data for a journal card; never sent to AI services."""
    weight_entry = db.query(WeightEntry).filter(
        WeightEntry.user_id == user.id,
        WeightEntry.date == taken_on,
    ).first()
    sessions = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == user.id,
        ForgeWorkoutSession.status == "completed",
        func.date(ForgeWorkoutSession.completed_at) == taken_on,
    ).order_by(ForgeWorkoutSession.completed_at).all()
    return {
        "weight_kg": weight_entry.weight_kg if weight_entry else None,
        "workout_names": [session.name for session in sessions],
    }


def _serialize_progress_photo(db: Session, user: User, photo: ForgeProgressPhoto) -> dict:
    return {
        "id": photo.id,
        "taken_on": photo.taken_on,
        "view": photo.view,
        "note": photo.note,
        "byte_size": photo.byte_size,
        "width": photo.width,
        "height": photo.height,
        "created_at": photo.created_at,
        "updated_at": photo.updated_at,
        "context": _progress_photo_context(db, user, photo.taken_on),
    }


def _validate_note(note: str | None) -> str | None:
    if note is not None and len(note) > 500:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Notes must be 500 characters or fewer.")
    return note.strip() if note and note.strip() else None


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
    profile_names = [profile.name.strip().lower() for profile in data.machine_profiles]
    if len(profile_names) != len(set(profile_names)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Machine profile names must be unique per exercise.")

    exercise.name = data.name.strip()
    exercise.icon = data.icon.strip()
    exercise.equipment = data.equipment
    exercise.primary_muscle_group = data.primary_muscle_group.strip()
    exercise.secondary_muscle_groups = [group.strip() for group in data.secondary_muscle_groups]

    existing_profiles = {profile.id: profile for profile in exercise.machine_profiles}
    supplied_profile_ids = {profile.id for profile in data.machine_profiles if profile.id is not None}
    unknown_profile_ids = supplied_profile_ids - existing_profiles.keys()
    if unknown_profile_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more machine profiles do not belong to this exercise.")

    for profile in list(exercise.machine_profiles):
        if profile.id not in supplied_profile_ids:
            exercise.machine_profiles.remove(profile)
    for profile_input in data.machine_profiles:
        profile = existing_profiles.get(profile_input.id) if profile_input.id is not None else None
        if profile is None:
            profile = ForgeMachineProfile()
            exercise.machine_profiles.append(profile)
        profile.name = profile_input.name.strip()
        profile.model = profile_input.model
        profile.notes = profile_input.notes


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


@router.get("/exercises/{exercise_id}/history", response_model=ForgeExerciseHistoryResponse)
async def get_exercise_history(
    exercise_id: UUID,
    machine_profile_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return actual logged sets from completed native Forge sessions for one library exercise."""
    exercise = db.query(ForgeExercise).filter(
        ForgeExercise.id == exercise_id,
        ForgeExercise.user_id == current_user.id,
    ).first()
    if exercise is None:
        raise _not_found("Exercise not found")
    if machine_profile_id is not None:
        profile = db.query(ForgeMachineProfile).filter(
            ForgeMachineProfile.id == machine_profile_id,
            ForgeMachineProfile.exercise_id == exercise.id,
        ).first()
        if profile is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Machine profile does not belong to this exercise.")

    rows_query = db.query(ForgeWorkoutSession, ForgeSessionExercise).join(
        ForgeSessionExercise, ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
    ).filter(
        ForgeWorkoutSession.user_id == current_user.id,
        ForgeWorkoutSession.status == "completed",
        ForgeSessionExercise.source_exercise_id == exercise_id,
    )
    if machine_profile_id is not None:
        rows_query = rows_query.filter(ForgeSessionExercise.source_machine_profile_id == machine_profile_id)
    rows = rows_query.order_by(ForgeWorkoutSession.completed_at.desc(), ForgeWorkoutSession.started_at.desc()).all()

    return {
        "exercise": _serialize_exercise(exercise),
        "sessions": [
            {
                "id": session.id,
                "name": session.name,
                "completed_at": session.completed_at,
                "started_at": session.started_at,
                "machine_profile_id": session_exercise.source_machine_profile_id,
                "machine_profile_name": session_exercise.machine_profile_name,
                "sets": [
                    {
                        "position": set_data.position,
                        "set_type": set_data.set_type,
                        "actual_weight_kg": set_data.actual_weight_kg,
                        "actual_reps": set_data.actual_reps,
                        "completed": set_data.completed,
                        "note": set_data.note,
                    }
                    for set_data in session_exercise.sets
                ],
            }
            for session, session_exercise in rows
        ],
    }


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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An exercise name must be unique and profiles used by plans or sessions cannot be removed.",
        )
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
    draft = await generate_forge_exercise_draft(
        data.instructions,
        current_user.language or "de",
        data.allowed_icons,
    )
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
    yazio_context = await _yazio_goal_context(current_user)
    draft = await generate_forge_plan_draft(
        data.instructions,
        catalog,
        current_user.language or "de",
        yazio_context["goal"],
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
        "start_coaching": session.start_coaching,
        "exercises": [
            {
                "id": exercise.id,
                "source_exercise_id": exercise.source_exercise_id,
                "name": exercise.name,
                "icon": exercise.icon,
                "equipment": exercise.equipment,
                "primary_muscle_group": exercise.primary_muscle_group,
                "secondary_muscle_groups": exercise.secondary_muscle_groups or [],
                "machine_profile_id": exercise.source_machine_profile_id,
                "machine_profile_name": exercise.machine_profile_name,
                "notes": exercise.notes,
                "coach_guidance": exercise.coach_guidance,
                "addition_coaching": exercise.addition_coaching,
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


async def _forge_coaching_profile(user: User) -> dict:
    """Build Forge coaching context exclusively from the live Yazio profile."""
    yazio_context = await _yazio_goal_context(user)
    yazio_profile = yazio_context["profile"]
    nutrition = yazio_context["nutrition"] or {}
    totals = nutrition.get("totals") or {}
    goals = nutrition.get("goals") or {}
    profile = {
        "goal": yazio_context["goal"],
        "goal_source": yazio_context["source"],
        "current_weight_kg": None,
        "start_weight_kg": None,
        "weight_change_per_week_kg": None,
        "nutrition": None,
    }
    for key in ("current_weight_kg", "start_weight_kg", "weight_change_per_week_kg"):
        value = yazio_profile.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value):
            profile[key] = float(value)
    if nutrition:
        profile["nutrition"] = {
            "date": nutrition.get("date"),
            "totals": {key: totals.get(key) for key in ("calories", "protein", "carbs", "fat")},
            "goals": {key: goals.get(key) for key in ("calories", "protein", "carbs", "fat")},
        }
    return profile


def _session_coaching_context(
    db: Session,
    user: User,
    session: ForgeWorkoutSession,
    coaching_profile: dict,
    only_exercise_id: UUID | None = None,
) -> dict:
    """Project only relevant, server-owned history and set constraints for the AI coach."""
    selected = [exercise for exercise in session.exercises if only_exercise_id is None or exercise.id == only_exercise_id]
    selected_keys = {
        _native_progression_key(exercise.source_exercise_id, exercise.source_machine_profile_id)
        for exercise in selected
    }
    selected_keys.discard(None)
    history = []
    historical_weights: dict[str, set[float]] = {}
    for completed in _native_completed_sessions(db, user.id, session.name)[:6]:
        matching = [
            {
                "exercise": exercise.get("title"),
                "progression_key": exercise.get("progression_key"),
                "working_sets": [
                    set_data for set_data in exercise.get("sets", [])
                    if set_data.get("type") == "working"
                ],
            }
            for exercise in completed.get("exercises", [])
            if exercise.get("progression_key") in selected_keys
        ]
        if matching:
            history.append({"completed_at": completed.get("start_time"), "exercises": matching})
            for exercise in matching:
                key = exercise.get("progression_key")
                for set_data in exercise["working_sets"]:
                    weight = set_data.get("weight_kg")
                    if key and isinstance(weight, (int, float)) and not isinstance(weight, bool) and isfinite(weight) and weight >= 0:
                        historical_weights.setdefault(key, set()).add(float(weight))

    def _rep_bounds(exercise: ForgeSessionExercise) -> tuple[int, int]:
        rep_range = str((exercise.coach_guidance or {}).get("rep_range") or "8-12").replace("–", "-")
        lower, separator, upper = rep_range.partition("-")
        if separator and lower.strip().isdigit() and upper.strip().isdigit():
            minimum, maximum = int(lower), int(upper)
            if 1 <= minimum <= maximum <= 200:
                return minimum, maximum
        return 8, 12

    def _target_context(exercise: ForgeSessionExercise, set_data: ForgeSessionSet) -> dict:
        minimum, maximum = _rep_bounds(exercise)
        progression_key = _native_progression_key(exercise.source_exercise_id, exercise.source_machine_profile_id)
        baseline_weight = set_data.target_weight_kg
        candidates = {float(baseline_weight)} if isinstance(baseline_weight, (int, float)) and isfinite(baseline_weight) and baseline_weight >= 0 else set()
        for historical_weight in historical_weights.get(progression_key or "", set()):
            if baseline_weight is None or historical_weight <= float(baseline_weight) + 0.001:
                candidates.add(historical_weight)
        return {
            "session_set_id": str(set_data.id),
            "type": set_data.set_type,
            "weight_kg": set_data.target_weight_kg,
            "reps": set_data.target_reps,
            "min_reps": minimum,
            "max_reps": maximum,
            "allowed_weight_kg": sorted(candidates),
        }

    return {
        "profile": coaching_profile,
        "session": {
            "name": session.name,
            "exercises": [
                {
                    "session_exercise_id": str(exercise.id),
                    "name": exercise.name,
                    "equipment": exercise.equipment,
                    "muscle_group": exercise.primary_muscle_group,
                    "machine_profile": exercise.machine_profile_name,
                    "notes": exercise.notes or "",
                    "deterministic_guidance": exercise.coach_guidance or {},
                    "targets": [_target_context(exercise, set_data) for set_data in exercise.sets],
                }
                for exercise in selected
            ],
        },
        "recent_matching_history": history,
    }


def _apply_forge_set_proposals(session: ForgeWorkoutSession, coaching: dict) -> None:
    """Persist only already-normalized working-set proposals from the coaching service."""
    by_id = {str(set_data.id): set_data for exercise in session.exercises for set_data in exercise.sets}
    for proposal in coaching.get("set_proposals", []):
        if not isinstance(proposal, dict):
            continue
        set_data = by_id.get(str(proposal.get("session_set_id") or ""))
        if set_data is None or set_data.set_type != "working":
            continue
        weight = proposal.get("target_weight_kg")
        reps = proposal.get("target_reps")
        if isinstance(weight, (int, float)) and not isinstance(weight, bool) and isfinite(weight) and 0 <= weight <= 1000:
            set_data.target_weight_kg = float(weight)
        if isinstance(reps, int) and not isinstance(reps, bool) and 1 <= reps <= 200:
            set_data.target_reps = reps


def _serialize_session_summary(session: ForgeWorkoutSession) -> dict:
    """Return history metadata without exposing the full immutable session snapshot."""
    all_sets = [set_data for exercise in session.exercises for set_data in exercise.sets]
    completed_at = session.completed_at or session.started_at
    duration_seconds = max(0, int((completed_at - session.started_at).total_seconds())) if completed_at and session.started_at else 0
    return {
        "id": session.id,
        "name": session.name,
        "status": "completed",
        "source_plan_id": session.source_plan_id,
        "started_at": session.started_at,
        "completed_at": completed_at,
        "duration_seconds": duration_seconds,
        "completed_sets": sum(set_data.completed for set_data in all_sets),
        "total_sets": len(all_sets),
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


def _session_machine_profile(
    db: Session,
    user_id: UUID,
    source_exercise_id: UUID | None,
    machine_profile_id: UUID | None,
) -> ForgeMachineProfile | None:
    """Resolve a submitted profile ID and verify it belongs to this user's source exercise."""
    if machine_profile_id is None:
        return None
    if source_exercise_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A machine profile requires a library exercise.")
    profile = db.query(ForgeMachineProfile).join(ForgeExercise).filter(
        ForgeMachineProfile.id == machine_profile_id,
        ForgeMachineProfile.exercise_id == source_exercise_id,
        ForgeExercise.user_id == user_id,
    ).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Machine profile does not belong to this exercise.")
    return profile


def _apply_program_input(db: Session, program: ForgeTrainingProgram, data: ForgeProgramInput, user_id: UUID) -> None:
    plan_ids = [routine.plan_id for routine in data.routines]
    plans = db.query(ForgeTrainingPlan).filter(
        ForgeTrainingPlan.user_id == user_id,
        ForgeTrainingPlan.id.in_(plan_ids),
    ).all() if plan_ids else []
    if len({plan.id for plan in plans}) != len(set(plan_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more routines do not belong to you.")
    # A rotation is an ordered sequence, so the same routine may repeat (A-B-A). A weekday
    # plan addresses each routine once and keeps all of its days in that single entry.
    if data.mode == "weekly" and len(set(plan_ids)) != len(plan_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="In a weekly plan a routine can only appear once; assign all of its weekdays there.")
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
    # A rotation may repeat a routine across slots; offer every distinct routine only once.
    distinct_plans = list({item.plan.id: item.plan for item in routines}.values())
    return {
        "mode": "rotation",
        "program": _serialize_program(program),
        "routine": _serialize_plan(routine),
        "options": [_serialize_plan(plan) for plan in distinct_plans],
        "message": "Nächste Routine in deiner Rotation.",
    }


def _native_session_rationale(progression_data: dict, progression_status: str) -> str:
    """Explain a deterministic native target in German without inventing training data."""
    rep_range = progression_data.get("rep_range", "8–12")
    current_weight = progression_data.get("current_weight_kg")
    latest_reps = progression_data.get("latest_reps") or []
    latest_reps_text = "/".join(str(reps) for reps in latest_reps)

    if progression_status == "INCREASE_WEIGHT":
        next_weight = progression_data.get("suggested_weight_kg")
        weight_text = f" auf die bestätigte nächste Last von {next_weight:g} kg" if isinstance(next_weight, (int, float)) else " auf die bestätigte nächste Last"
        return f"Alle vergleichbaren Arbeitssätze lagen am oberen Ende des {rep_range}-Bereichs. Nach dem Prinzip der doppelten Progression geht es deshalb{weight_text}; die Wiederholungen starten wieder am unteren Bereich."
    if progression_status == "STAGNATED":
        return f"Das Wiederholungsvolumen war über drei vergleichbare Sessions bei gleicher Last stabil. Halte Gewicht und Satzanzahl im {rep_range}-Bereich und prüfe Technik, Pausen und Erholung, bevor du mehr Last oder Volumen erzwingst."
    if progression_status == "REGRESSED":
        return f"Die vergleichbare Gesamtwiederholungszahl ist zuletzt gesunken. Das Ziel bleibt bewusst im {rep_range}-Bereich bei gleicher Last, damit du erst die vorherige Leistung sauber stabilisierst statt vorschnell zu erhöhen."
    if progression_status == "FIRST_SESSION":
        return f"Es gibt noch keinen vergleichbaren Verlauf. Starte kontrolliert im {rep_range}-Bereich; bei sauberer Technik werden zuerst Wiederholungen aufgebaut, bevor das Gewicht steigt."

    weight_text = f" bei {current_weight:g} kg" if isinstance(current_weight, (int, float)) else ""
    previous_text = f" (zuletzt {latest_reps_text} Wdh.)" if latest_reps_text else ""
    return f"Du hast im {rep_range}-Bereich noch Wiederholungen aufzubauen{weight_text}{previous_text}. Die Last bleibt deshalb konstant; das nächste messbare Ziel ist eine saubere zusätzliche Wiederholung, bevor das Gewicht erhöht wird."


def _session_guidance_by_plan_exercise(plan: ForgeTrainingPlan, progression: dict, targets: list[dict]) -> dict[UUID, dict]:
    """Freeze the deterministic coach explanation next to each planned session exercise."""
    guidance: dict[UUID, dict] = {}
    for position, plan_exercise in enumerate(plan.exercises):
        target = targets[position] if position < len(targets) else {}
        progression_key = _native_progression_key(plan_exercise.exercise.id, plan_exercise.machine_profile_id)
        progression_data = progression.get(progression_key, {})
        progression_status = target.get("progression_status") or progression_data.get("signal") or "FIRST_SESSION"
        guidance[plan_exercise.id] = {
            "progression_status": progression_status,
            "rep_range": progression_data.get("rep_range", "8–12"),
            "rationale": _native_session_rationale(progression_data, progression_status),
        }
    return guidance


def _snapshot_plan_into_session(plan: ForgeTrainingPlan, session: ForgeWorkoutSession, guidance_by_plan_exercise: dict[UUID, dict] | None = None) -> None:
    guidance_by_plan_exercise = guidance_by_plan_exercise or {}
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
            source_machine_profile_id=plan_exercise.machine_profile_id,
            machine_profile_name=plan_exercise.machine_profile.name if plan_exercise.machine_profile else None,
            notes=plan_exercise.notes,
            coach_guidance=guidance_by_plan_exercise.get(plan_exercise.id),
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
    progression, targets = _refresh_native_coach_targets(db, current_user.id, plan)
    guidance_by_plan_exercise = _session_guidance_by_plan_exercise(plan, progression, targets)
    session = ForgeWorkoutSession(
        user_id=current_user.id,
        program_id=program.id if program else None,
        source_plan_id=plan.id,
        name=plan.name,
        status="active",
    )
    _snapshot_plan_into_session(plan, session, guidance_by_plan_exercise)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/start-coaching", response_model=ForgeSessionResponse)
async def generate_session_start_coaching(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Persist one idempotent, text-only coaching briefing after the durable session snapshot exists."""
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions do not need a new start briefing.")
    if session.start_coaching is None:
        coaching_profile = await _forge_coaching_profile(current_user)
        context = _session_coaching_context(db, current_user, session, coaching_profile)
        coaching = await generate_forge_session_start_coaching(context, current_user.language or "de")
        _apply_forge_set_proposals(session, coaching)
        coaching.pop("set_proposals", None)
        session.start_coaching = coaching
        db.commit()
        db.refresh(session)
    return _serialize_session(session)


@router.get("/sessions/active", response_model=ForgeSessionResponse | None)
async def get_active_session(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the caller's resumable native Forge session, if one exists."""
    session = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == current_user.id,
        ForgeWorkoutSession.status == "active",
    ).order_by(ForgeWorkoutSession.started_at.desc()).first()
    return _serialize_session(session) if session is not None else None


@router.get("/sessions", response_model=list[ForgeSessionSummaryResponse])
async def list_completed_sessions(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List completed native Forge workouts for the authenticated user's history."""
    if not 1 <= limit <= 100 or offset < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Limit must be 1–100 and offset cannot be negative.")
    sessions = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == current_user.id,
        ForgeWorkoutSession.status == "completed",
    ).order_by(ForgeWorkoutSession.completed_at.desc()).offset(offset).limit(limit).all()
    return [_serialize_session_summary(session) for session in sessions]


@router.get("/progress-photos", response_model=ForgeProgressPhotoListResponse)
async def list_progress_photos(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List only the caller's private progress-photo metadata and read-only context."""
    if not 1 <= limit <= 100 or offset < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Limit must be 1–100 and offset cannot be negative.")
    query = db.query(ForgeProgressPhoto).filter(ForgeProgressPhoto.user_id == current_user.id)
    photos = query.order_by(ForgeProgressPhoto.taken_on.desc(), ForgeProgressPhoto.created_at.desc()).offset(offset).limit(limit).all()
    return {"items": [_serialize_progress_photo(db, current_user, photo) for photo in photos], "total": query.count()}


@router.post("/progress-photos", response_model=ForgeProgressPhotoResponse, status_code=status.HTTP_201_CREATED)
async def create_progress_photo(
    image: UploadFile = File(...),
    taken_on: date = Form(...),
    view: str = Form("front"),
    note: str | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a private snapshot after server-side validation and metadata stripping."""
    _validate_progress_photo_date(taken_on)
    if view not in {"front", "side", "back", "other"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="View must be front, side, back, or other.")
    try:
        storage_root()
    except PhotoStorageUnavailable as error:
        raise storage_unavailable_error(error)
    normalized, width, height, digest = prepare_progress_photo(await image.read())
    photo = ForgeProgressPhoto(
        id=uuid4(),
        user_id=current_user.id,
        taken_on=taken_on,
        view=view,
        note=_validate_note(note),
        storage_key="",
        content_type="image/webp",
        byte_size=len(normalized),
        width=width,
        height=height,
        sha256=digest,
    )
    photo.storage_key = f"{current_user.id}/{photo.id}.webp"
    try:
        write_progress_photo(photo.storage_key, normalized)
        db.add(photo)
        db.commit()
        db.refresh(photo)
    except Exception:
        db.rollback()
        delete_progress_photo_file(photo.storage_key)
        raise
    return _serialize_progress_photo(db, current_user, photo)


@router.get("/progress-photos/{photo_id}/image")
async def get_progress_photo_image(
    photo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve a photo only after JWT authentication and owner lookup; never publish a URL."""
    photo = _owned_progress_photo(db, current_user.id, photo_id)
    try:
        photo_path = read_progress_photo(photo.storage_key)
    except PhotoStorageUnavailable as error:
        raise storage_unavailable_error(error)
    except FileNotFoundError:
        raise _not_found("Progress photo image not found")
    return FileResponse(
        photo_path,
        media_type=photo.content_type,
        headers={"Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff"},
    )


@router.patch("/progress-photos/{photo_id}", response_model=ForgeProgressPhotoResponse)
async def update_progress_photo(
    photo_id: UUID,
    data: ForgeProgressPhotoUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    photo = _owned_progress_photo(db, current_user.id, photo_id)
    updates = data.model_dump(exclude_unset=True)
    if "taken_on" in updates and updates["taken_on"] is not None:
        _validate_progress_photo_date(updates["taken_on"])
    if "note" in updates:
        updates["note"] = _validate_note(updates["note"])
    for key, value in updates.items():
        setattr(photo, key, value)
    db.commit()
    db.refresh(photo)
    return _serialize_progress_photo(db, current_user, photo)


@router.put("/progress-photos/{photo_id}/image", response_model=ForgeProgressPhotoResponse)
async def replace_progress_photo_image(
    photo_id: UUID,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    photo = _owned_progress_photo(db, current_user.id, photo_id)
    try:
        storage_root()
    except PhotoStorageUnavailable as error:
        raise storage_unavailable_error(error)
    normalized, width, height, digest = prepare_progress_photo(await image.read())
    try:
        write_progress_photo(photo.storage_key, normalized)
        photo.content_type = "image/webp"
        photo.byte_size = len(normalized)
        photo.width = width
        photo.height = height
        photo.sha256 = digest
        db.commit()
        db.refresh(photo)
    except Exception:
        db.rollback()
        raise
    return _serialize_progress_photo(db, current_user, photo)


@router.delete("/progress-photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_progress_photo(
    photo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    photo = _owned_progress_photo(db, current_user.id, photo_id)
    storage_key = photo.storage_key
    db.delete(photo)
    db.commit()
    try:
        delete_progress_photo_file(storage_key)
    except PhotoStorageUnavailable:
        # The record is gone; an unavailable backend volume cannot make it publicly reachable.
        pass


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Discard an active session or explicitly remove a completed history entry."""
    session = _owned_session(db, current_user.id, session_id)
    plans_to_refresh = []
    if session.status == "completed":
        plans_to_refresh = db.query(ForgeTrainingPlan).filter(
            ForgeTrainingPlan.user_id == current_user.id,
        ).all()
    db.delete(session)
    db.flush()
    # Completed-session history is shared by matching canonical exercise/profile IDs.
    for plan in plans_to_refresh:
        _refresh_native_coach_targets(db, current_user.id, plan)
    db.commit()


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
    machine_profile = _session_machine_profile(
        db,
        current_user.id,
        exercise.id if exercise else None,
        data.machine_profile_id,
    )
    session_exercise = ForgeSessionExercise(
        source_exercise_id=exercise.id if exercise else None,
        source_machine_profile_id=machine_profile.id if machine_profile else None,
        name=exercise.name if exercise else data.name.strip(),
        icon=exercise.icon if exercise else "Dumbbell",
        equipment=exercise.equipment if exercise else "other",
        primary_muscle_group=exercise.primary_muscle_group if exercise else "Other",
        secondary_muscle_groups=exercise.secondary_muscle_groups if exercise else [],
        machine_profile_name=machine_profile.name if machine_profile else None,
        notes=data.notes,
        position=len(session.exercises),
    )
    for position, set_data in enumerate(data.sets):
        session_exercise.sets.append(ForgeSessionSet(position=position, **set_data.model_dump()))
    if exercise is not None:
        _apply_live_session_exercise_guidance(db, current_user.id, session_exercise, exercise, machine_profile)
    session.exercises.append(session_exercise)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/exercises/{session_exercise_id}/addition-coaching", response_model=ForgeSessionResponse)
async def generate_session_exercise_addition_coaching(session_id: UUID, session_exercise_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create one persisted coaching card for a newly added live-session exercise."""
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot receive new exercise coaching.")
    exercise = next((item for item in session.exercises if item.id == session_exercise_id), None)
    if exercise is None:
        raise _not_found("Session exercise not found")
    if exercise.addition_coaching is None:
        coaching_profile = await _forge_coaching_profile(current_user)
        context = _session_coaching_context(
            db, current_user, session, coaching_profile, only_exercise_id=session_exercise_id,
        )
        generated = await generate_forge_session_start_coaching(context, current_user.language or "de")
        _apply_forge_set_proposals(session, generated)
        decision = next((item for item in generated.get("exercise_decisions", []) if item.get("session_exercise_id") == str(exercise.id)), None)
        if decision is None:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Exercise coaching could not be prepared safely.")
        exercise.addition_coaching = {
            "recommendation": decision["recommendation"],
            "first_set_focus": decision["first_set_focus"],
            "effort_hint": decision["effort_hint"],
        }
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
    updates = data.model_dump(exclude_unset=True)
    if "machine_profile_id" in updates:
        machine_profile = _session_machine_profile(
            db,
            current_user.id,
            exercise.source_exercise_id,
            updates.pop("machine_profile_id"),
        )
        exercise.source_machine_profile_id = machine_profile.id if machine_profile else None
        exercise.machine_profile_name = machine_profile.name if machine_profile else None
        library_exercise = db.query(ForgeExercise).filter(
            ForgeExercise.id == exercise.source_exercise_id,
            ForgeExercise.user_id == current_user.id,
        ).first()
        if library_exercise is not None:
            _apply_live_session_exercise_guidance(db, current_user.id, exercise, library_exercise, machine_profile)
    for key, value in updates.items():
        setattr(exercise, key, value)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.patch("/sessions/{session_id}/sets/{set_id}", response_model=ForgeSessionResponse)
async def update_session_set(session_id: UUID, set_id: UUID, data: ForgeSessionSetUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions cannot be changed.")
    set_data = db.query(ForgeSessionSet).join(ForgeSessionExercise).filter(
        ForgeSessionSet.id == set_id,
        ForgeSessionExercise.session_id == session.id,
    ).first()
    if set_data is None:
        raise _not_found("Set not found")

    updates = data.model_dump(exclude={"position"})
    requested_position = data.position
    for key, value in updates.items():
        setattr(set_data, key, value)

    if requested_position is not None:
        siblings = db.query(ForgeSessionSet).filter(
            ForgeSessionSet.session_exercise_id == set_data.session_exercise_id,
        ).order_by(ForgeSessionSet.position).all()
        if requested_position >= len(siblings):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Set position is outside this exercise.")
        reordered = [item for item in siblings if item.id != set_data.id]
        reordered.insert(requested_position, set_data)
        # The unique constraint is immediate in PostgreSQL. Move every row to a
        # unique temporary position first, then apply the final ordered positions.
        for temporary_position, item in enumerate(reordered, start=1):
            item.position = -temporary_position
        db.flush()
        for position, item in enumerate(reordered):
            item.position = position
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
    # A just-completed profile contributes to every plan that selects the same profile.
    for plan in db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.user_id == current_user.id).all():
        _refresh_native_coach_targets(db, current_user.id, plan)
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
        _apply_live_session_exercise_guidance(db, current_user.id, session_exercise, exercise, None)
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

def _native_progression_key(exercise_id: UUID | None, machine_profile_id: UUID | None) -> str | None:
    """Stable identity for native progression; labels remain immutable snapshots only."""
    if exercise_id is None:
        return None
    return f"{exercise_id}:{machine_profile_id or 'unprofiled'}"


def _native_plan_template(plan: ForgeTrainingPlan) -> list[dict]:
    """Normalize a native routine into the deterministic progression template shape."""
    template = []
    for plan_exercise in plan.exercises:
        note_parts = [part for part in [plan_exercise.notes, plan_exercise.machine_profile.notes if plan_exercise.machine_profile else None] if part]
        template.append({
            "title": plan_exercise.exercise.name,
            "progression_key": _native_progression_key(plan_exercise.exercise.id, plan_exercise.machine_profile_id),
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


def _native_completed_sessions(db: Session, user_id: UUID, routine_name: str) -> list[dict]:
    """Return all completed native sessions, keyed by canonical exercise and machine profile."""
    sessions = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
    ).order_by(ForgeWorkoutSession.completed_at.desc()).all()
    return [
        {
            "id": str(session.id),
            "title": routine_name,
            "start_time": (session.completed_at or session.started_at).isoformat(),
            "exercises": [
                {
                    "title": exercise.name,
                    "progression_key": _native_progression_key(exercise.source_exercise_id, exercise.source_machine_profile_id),
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
                if _native_progression_key(exercise.source_exercise_id, exercise.source_machine_profile_id) is not None
            ],
        }
        for session in sessions
    ]


def _apply_live_session_exercise_guidance(
    db: Session,
    user_id: UUID,
    session_exercise: ForgeSessionExercise,
    exercise: ForgeExercise,
    machine_profile: ForgeMachineProfile | None,
) -> None:
    """Freeze conservative progression guidance for an exercise added during a live session."""
    notes = "\n".join(part for part in [session_exercise.notes, machine_profile.notes if machine_profile else None] if part)
    progression_key = _native_progression_key(exercise.id, machine_profile.id if machine_profile else None)
    template = [{
        "title": exercise.name,
        "progression_key": progression_key,
        "muscle_group": exercise.primary_muscle_group,
        "notes": notes,
        "sets": [
            {"type": set_data.set_type, "weight_kg": set_data.target_weight_kg, "reps": set_data.target_reps}
            for set_data in session_exercise.sets
        ],
    }]
    progression = _compute_exercise_progression(
        _native_completed_sessions(db, user_id, session_exercise.name),
        template,
    )
    targets = _build_deterministic_set_targets(template, progression, [])
    target = targets[0] if targets else {}
    progression_data = progression.get(progression_key, {})
    progression_status = target.get("progression_status") or progression_data.get("signal") or "FIRST_SESSION"
    session_exercise.coach_guidance = {
        "progression_status": progression_status,
        "rep_range": progression_data.get("rep_range", "8–12"),
        "rationale": _native_session_rationale(progression_data, progression_status),
    }
    for set_data, target_set in zip(session_exercise.sets, target.get("set_targets", [])):
        target_weight = target_set.get("weight_kg")
        target_reps = target_set.get("reps")
        if isinstance(target_weight, (int, float)) and target_weight > 0:
            set_data.target_weight_kg = float(target_weight)
            set_data.coach_suggested_weight_kg = float(target_weight)
        if isinstance(target_reps, int) and target_reps > 0:
            set_data.target_reps = target_reps
            set_data.coach_suggested_reps = target_reps


def _refresh_native_coach_targets(db: Session, user_id: UUID, plan: ForgeTrainingPlan) -> tuple[dict, list[dict]]:
    """Persist targets using a distinct history bucket for every selected machine profile."""
    template = _native_plan_template(plan)
    history = _native_completed_sessions(db, user_id, plan.name)
    progression = _compute_exercise_progression(history, template)
    targets = _build_deterministic_set_targets(template, progression, [])
    targets_by_key = {target.get("progression_key"): target for target in targets}

    latest_by_key: dict[str, dict] = {}
    for completed_session in history:
        for exercise in completed_session.get("exercises", []):
            progression_key = exercise.get("progression_key")
            if progression_key and progression_key not in latest_by_key:
                latest_by_key[progression_key] = exercise

    for plan_exercise in plan.exercises:
        progression_key = _native_progression_key(plan_exercise.exercise.id, plan_exercise.machine_profile_id)
        target = targets_by_key.get(progression_key)
        latest = latest_by_key.get(progression_key, {})
        latest_sets = latest.get("sets", [])
        target_sets = target.get("set_targets", []) if target else []
        for position, plan_set in enumerate(plan_exercise.sets):
            # A refresh must remove values that belonged only to deleted history.
            plan_set.previous_weight_kg = None
            plan_set.previous_reps = None
            plan_set.coach_suggested_weight_kg = None
            plan_set.coach_suggested_reps = None
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
