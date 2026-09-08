"""Native Forge exercise library, plans, and explicit-save AI drafts."""
from datetime import date, datetime, timedelta, timezone
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
    ForgePlanChangesResponse,
    ForgeCompleteCourseRequest,
    ForgeCompleteSessionRequest,
    ForgeMachineProfileResourceInput,
    ForgeMachineProfileResponse,
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
    ForgeCoachingGenerationError,
    _build_deterministic_set_targets,
    _compute_exercise_progression,
    _parse_available_weights,
    generate_forge_exercise_draft,
    generate_forge_plan_draft,
    generate_forge_session_chat,
    generate_forge_session_start_coaching,
)
from app.services.yazio_service import resolve_yazio_goal_context
from app.services.google_health_service import export_completed_session

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
    return {
        "id": profile.id,
        "name": profile.name,
        "model": profile.model,
        "notes": profile.notes,
        "exercise_ids": [exercise.id for exercise in profile.exercises],
    }


def _available_machine_profiles(
    db: Session,
    user_id: UUID,
    equipment: str,
) -> list[ForgeMachineProfile]:
    """Return current global profiles usable by machine and cable exercises."""
    if equipment not in {"machine", "cable"}:
        return []
    return db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.user_id == user_id,
        ForgeMachineProfile.is_archived.is_(False),
    ).order_by(
        ForgeMachineProfile.name,
        ForgeMachineProfile.created_at,
    ).all()


def _last_exercise_performances(
    db: Session,
    user_id: UUID,
    exercise_ids: list[UUID],
) -> dict[UUID, dict]:
    """Return each exercise's newest real working-set performance in one query."""
    if not exercise_ids:
        return {}
    rows = db.query(ForgeWorkoutSession, ForgeSessionExercise, ForgeSessionSet).join(
        ForgeSessionExercise, ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
    ).join(
        ForgeSessionSet, ForgeSessionSet.session_exercise_id == ForgeSessionExercise.id,
    ).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeSessionExercise.source_exercise_id.in_(set(exercise_ids)),
        ForgeSessionSet.completed.is_(True),
        ForgeSessionSet.set_type == "working",
        ForgeSessionSet.actual_reps.isnot(None),
    ).order_by(
        ForgeWorkoutSession.completed_at.desc().nullslast(),
        ForgeWorkoutSession.started_at.desc(),
        ForgeSessionExercise.position.desc(),
        ForgeSessionSet.position,
    ).all()

    selected_snapshot_ids: dict[UUID, UUID] = {}
    performances: dict[UUID, dict] = {}
    for session, session_exercise, set_data in rows:
        exercise_id = session_exercise.source_exercise_id
        if exercise_id is None:
            continue
        selected_id = selected_snapshot_ids.get(exercise_id)
        if selected_id is None:
            selected_snapshot_ids[exercise_id] = session_exercise.id
            performances[exercise_id] = {
                "machine_profile_id": session_exercise.source_machine_profile_id,
                "machine_profile_name": session_exercise.machine_profile_name,
                "completed_at": session.completed_at or session.started_at,
                "sets": [],
            }
        elif selected_id != session_exercise.id:
            continue
        performances[exercise_id]["sets"].append({
            "position": set_data.position,
            "set_type": set_data.set_type,
            "actual_weight_kg": set_data.actual_weight_kg,
            "actual_reps": set_data.actual_reps,
        })
    return performances


def _last_used_machine_profiles(
    db: Session,
    user_id: UUID,
    exercise_ids: list[UUID],
) -> dict[UUID, ForgeMachineProfile]:
    """Return the newest active machine profile used for each library exercise."""
    if not exercise_ids:
        return {}
    rows = db.query(ForgeWorkoutSession, ForgeSessionExercise).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
        ForgeSessionExercise.source_exercise_id.in_(set(exercise_ids)),
        ForgeSessionExercise.source_machine_profile_id.isnot(None),
    ).order_by(
        ForgeWorkoutSession.completed_at.desc().nullslast(),
        ForgeWorkoutSession.started_at.desc(),
    ).all()
    latest_profile_ids: dict[UUID, UUID] = {}
    for _, session_exercise in rows:
        if session_exercise.source_exercise_id not in latest_profile_ids and session_exercise.source_machine_profile_id is not None:
            latest_profile_ids[session_exercise.source_exercise_id] = session_exercise.source_machine_profile_id
    if not latest_profile_ids:
        return {}
    profiles = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.user_id == user_id,
        ForgeMachineProfile.is_archived.is_(False),
        ForgeMachineProfile.id.in_(set(latest_profile_ids.values())),
    ).all()
    profiles_by_id = {profile.id: profile for profile in profiles}
    return {
        exercise_id: profiles_by_id[profile_id]
        for exercise_id, profile_id in latest_profile_ids.items()
        if profile_id in profiles_by_id
    }


def _last_profile_set_targets(
    db: Session,
    user_id: UUID,
    exercise_id: UUID | None,
    machine_profile_id: UUID | None,
) -> dict[int, dict[str, float | int | None]]:
    """Return the newest target/actual values for one exercise/profile identity."""
    if exercise_id is None or machine_profile_id is None:
        return {}
    rows = db.query(ForgeWorkoutSession, ForgeSessionExercise, ForgeSessionSet).join(
        ForgeSessionExercise, ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
    ).join(
        ForgeSessionSet, ForgeSessionSet.session_exercise_id == ForgeSessionExercise.id,
    ).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeSessionExercise.source_exercise_id == exercise_id,
        ForgeSessionExercise.source_machine_profile_id == machine_profile_id,
    ).order_by(
        ForgeWorkoutSession.completed_at.desc().nullslast(),
        ForgeWorkoutSession.started_at.desc(),
        ForgeSessionSet.position,
    ).all()
    if not rows:
        return {}

    latest_session_exercise_id = rows[0][1].id
    return {
        set_data.position: {
            # Older sessions may not have persisted coach targets. Their completed
            # value is still the best profile-specific starting point available.
            "target_weight_kg": set_data.target_weight_kg if set_data.target_weight_kg is not None else set_data.actual_weight_kg,
            "target_reps": set_data.target_reps if set_data.target_reps is not None else set_data.actual_reps,
        }
        for _, session_exercise, set_data in rows
        if session_exercise.id == latest_session_exercise_id
    }


def _apply_last_used_profiles_to_session(
    db: Session,
    user_id: UUID,
    session: ForgeWorkoutSession,
) -> bool:
    """Backfill the last active profile on legacy active sessions before coaching."""
    candidates = [
        exercise.source_exercise_id
        for exercise in session.exercises
        if exercise.source_exercise_id is not None
        and exercise.source_machine_profile_id is None
        and exercise.equipment in {"machine", "cable"}
    ]
    last_used = _last_used_machine_profiles(db, user_id, candidates)
    changed = False
    for exercise in session.exercises:
        profile = last_used.get(exercise.source_exercise_id)
        if profile is None or exercise.source_machine_profile_id is not None:
            continue
        exercise.source_machine_profile_id = profile.id
        exercise.machine_profile_name = profile.name
        for set_data in exercise.sets:
            set_data.target_weight_kg = None
            set_data.target_reps = None
            set_data.coach_suggested_weight_kg = None
            set_data.coach_suggested_reps = None
        exercise.coach_guidance = None
        exercise.addition_coaching = None
        changed = True
    if changed:
        # The previous briefing was generated without the profile identity and
        # must not survive the profile backfill.
        session.start_coaching = None
    return changed


def _serialize_exercise(
    exercise: ForgeExercise,
    db: Session,
    user_id: UUID,
    last_performances: dict[UUID, dict] | None = None,
) -> dict:
    if last_performances is None:
        last_performances = _last_exercise_performances(db, user_id, [exercise.id])
    return {
        "id": exercise.id,
        "name": exercise.name,
        "icon": exercise.icon,
        "equipment": exercise.equipment,
        "primary_muscle_group": exercise.primary_muscle_group,
        "secondary_muscle_groups": exercise.secondary_muscle_groups or [],
        "machine_profiles": [
            _serialize_profile(profile)
            for profile in exercise.machine_profiles
        ],
        "available_machine_profiles": [
            _serialize_profile(profile)
            for profile in _available_machine_profiles(db, user_id, exercise.equipment)
        ],
        "last_performance": last_performances.get(exercise.id),
    }


def _serialize_plan(
    plan: ForgeTrainingPlan,
    db: Session,
    last_performances: dict[UUID, dict] | None = None,
) -> dict:
    if last_performances is None:
        last_performances = _last_exercise_performances(
            db,
            plan.user_id,
            [item.exercise_id for item in plan.exercises],
        )
    return {
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "plan_type": plan.plan_type,
        "default_duration_minutes": plan.default_duration_minutes,
        "position": plan.position,
        "has_image": bool(plan.image_storage_key),
        "exercises": [
            {
                "id": plan_exercise.id,
                "position": plan_exercise.position,
                "notes": plan_exercise.notes,
                "exercise": _serialize_exercise(
                    plan_exercise.exercise,
                    db,
                    plan.user_id,
                    last_performances,
                ),
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
    submitted_profiles = data.machine_profiles or []
    submitted_profile_ids = data.machine_profile_ids or []
    if data.machine_profile_ids is not None and data.machine_profiles is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Submit machine_profile_ids or legacy machine_profiles, not both.",
        )
    if data.equipment not in {"machine", "cable"} and (submitted_profiles or submitted_profile_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Maschinenprofile können nur Übungen mit Gerät ‚Maschine‘ oder ‚Kabelzug‘ zugeordnet werden.",
        )
    normalized_groups = [group.strip().lower() for group in data.secondary_muscle_groups]
    if len(set(normalized_groups)) != len(normalized_groups):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Secondary muscle groups must be unique.")


def _clear_plan_profile_references(
    db: Session,
    exercise_id: UUID,
    profile_ids: set[UUID],
) -> None:
    """Remove outdated defaults without changing historical session snapshots."""
    if not profile_ids:
        return
    db.query(ForgePlanExercise).filter(
        ForgePlanExercise.exercise_id == exercise_id,
        ForgePlanExercise.machine_profile_id.in_(profile_ids),
    ).update({ForgePlanExercise.machine_profile_id: None}, synchronize_session=False)


def _apply_exercise_input(db: Session, exercise: ForgeExercise, data: ForgeExerciseInput) -> None:
    _validate_exercise_input(data)
    previous_profile_ids = {profile.id for profile in exercise.machine_profiles if profile.id is not None}
    exercise.name = data.name.strip()
    exercise.icon = data.icon.strip()
    exercise.equipment = data.equipment
    exercise.primary_muscle_group = data.primary_muscle_group.strip()
    exercise.secondary_muscle_groups = [group.strip() for group in data.secondary_muscle_groups]

    if data.machine_profile_ids is not None:
        requested_ids = list(dict.fromkeys(data.machine_profile_ids))
        profiles = db.query(ForgeMachineProfile).filter(
            ForgeMachineProfile.user_id == exercise.user_id,
            ForgeMachineProfile.is_archived.is_(False),
            ForgeMachineProfile.id.in_(requested_ids),
        ).all() if requested_ids else []
        if len(profiles) != len(requested_ids):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mindestens eines der ausgewählten Maschinenprofile ist nicht verfügbar.")
        exercise.machine_profiles = profiles
    elif data.machine_profiles is not None:
        profile_names = [profile.name.strip().lower() for profile in data.machine_profiles]
        if len(profile_names) != len(set(profile_names)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Maschinenprofilnamen müssen innerhalb einer Übung eindeutig sein.")
        linked_profiles: list[ForgeMachineProfile] = []
        for profile_input in data.machine_profiles:
            profile = None
            if profile_input.id is not None:
                profile = db.query(ForgeMachineProfile).filter(
                    ForgeMachineProfile.id == profile_input.id,
                    ForgeMachineProfile.user_id == exercise.user_id,
                ).first()
                if profile is None:
                    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mindestens eines der ausgewählten Maschinenprofile ist nicht verfügbar.")
            else:
                profile = ForgeMachineProfile(user_id=exercise.user_id)
                db.add(profile)
            profile.name = profile_input.name.strip()
            profile.model = profile_input.model.strip() if profile_input.model and profile_input.model.strip() else None
            profile.notes = profile_input.notes.strip() if profile_input.notes and profile_input.notes.strip() else None
            linked_profiles.append(profile)
        exercise.machine_profiles = linked_profiles
    elif data.equipment not in {"machine", "cable"}:
        exercise.machine_profiles = []

    resulting_profile_ids = {profile.id for profile in exercise.machine_profiles if profile.id is not None}
    if exercise.id is not None:
        _clear_plan_profile_references(
            db,
            exercise.id,
            previous_profile_ids - resulting_profile_ids,
        )


def _owned_exercises(db: Session, user_id: UUID, exercise_ids: list[UUID]) -> dict[UUID, ForgeExercise]:
    exercises = db.query(ForgeExercise).filter(ForgeExercise.user_id == user_id, ForgeExercise.id.in_(exercise_ids)).all()
    by_id = {exercise.id: exercise for exercise in exercises}
    if len(by_id) != len(set(exercise_ids)):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="One or more exercises do not belong to you.")
    return by_id


def _validate_plan_input(data: ForgePlanInput) -> None:
    if data.plan_type == "course":
        if data.exercises:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Courses cannot contain exercises.")
        if data.default_duration_minutes is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Courses require a default duration.")
    elif data.default_duration_minutes is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only courses can have a default duration.")


def _replace_plan_exercises(db: Session, plan: ForgeTrainingPlan, plan_input: ForgePlanInput, user_id: UUID) -> None:
    exercise_ids = [entry.exercise_id for entry in plan_input.exercises]
    exercises_by_id = _owned_exercises(db, user_id, exercise_ids) if exercise_ids else {}
    profile_ids = [entry.machine_profile_id for entry in plan_input.exercises if entry.machine_profile_id]
    profiles_by_id: dict[UUID, ForgeMachineProfile] = {}
    if profile_ids:
        profiles = db.query(ForgeMachineProfile).filter(
            ForgeMachineProfile.user_id == user_id,
            ForgeMachineProfile.is_archived.is_(False),
            ForgeMachineProfile.id.in_(profile_ids),
        ).all()
        profiles_by_id = {profile.id: profile for profile in profiles}
        if len(profiles_by_id) != len(set(profile_ids)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mindestens eines der ausgewählten Maschinenprofile ist nicht verfügbar.")

    plan.exercises.clear()
    db.flush()
    for position, entry in enumerate(plan_input.exercises):
        exercise = exercises_by_id[entry.exercise_id]
        profile = profiles_by_id.get(entry.machine_profile_id) if entry.machine_profile_id else None
        if profile is not None and exercise.equipment not in {"machine", "cable"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Maschinenprofile können nur Übungen mit Gerät ‚Maschine‘ oder ‚Kabelzug‘ zugeordnet werden.")
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


def _apply_profile_resource_input(
    db: Session,
    profile: ForgeMachineProfile,
    data: ForgeMachineProfileResourceInput,
    user_id: UUID,
) -> None:
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Bitte gib dem Maschinenprofil einen Namen.")
    if data.exercise_ids is not None:
        exercise_ids = list(dict.fromkeys(data.exercise_ids))
        exercises = _owned_exercises(db, user_id, exercise_ids) if exercise_ids else {}
        invalid_equipment = [item.name for item in exercises.values() if item.equipment not in {"machine", "cable"}]
        if invalid_equipment:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Maschinenprofile können nur Übungen mit Gerät ‚Maschine‘ oder ‚Kabelzug‘ zugeordnet werden.",
            )
        if profile.id is not None:
            retained_exercise_ids = set(exercise_ids)
            for linked_exercise in profile.exercises:
                if linked_exercise.id not in retained_exercise_ids:
                    _clear_plan_profile_references(db, linked_exercise.id, {profile.id})
        profile.exercises = [exercises[exercise_id] for exercise_id in exercise_ids]
    profile.name = name
    profile.model = data.model.strip() if data.model and data.model.strip() else None
    profile.notes = data.notes.strip() if data.notes and data.notes.strip() else None


@router.get("/machine-profiles", response_model=list[ForgeMachineProfileResponse])
async def list_machine_profiles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profiles = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.user_id == current_user.id,
        ForgeMachineProfile.is_archived.is_(False),
    ).order_by(ForgeMachineProfile.name, ForgeMachineProfile.created_at).all()
    return [_serialize_profile(profile) for profile in profiles]


@router.get("/machine-profiles/{profile_id}", response_model=ForgeMachineProfileResponse)
async def get_machine_profile(profile_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.id == profile_id,
        ForgeMachineProfile.user_id == current_user.id,
        ForgeMachineProfile.is_archived.is_(False),
    ).first()
    if profile is None:
        raise _not_found("Maschinenprofil nicht gefunden.")
    return _serialize_profile(profile)


@router.post("/machine-profiles", response_model=ForgeMachineProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_machine_profile(
    data: ForgeMachineProfileResourceInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = ForgeMachineProfile(user_id=current_user.id)
    _apply_profile_resource_input(db, profile, data, current_user.id)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return _serialize_profile(profile)


@router.put("/machine-profiles/{profile_id}", response_model=ForgeMachineProfileResponse)
async def update_machine_profile(
    profile_id: UUID,
    data: ForgeMachineProfileResourceInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.id == profile_id,
        ForgeMachineProfile.user_id == current_user.id,
        ForgeMachineProfile.is_archived.is_(False),
    ).first()
    if profile is None:
        raise _not_found("Maschinenprofil nicht gefunden.")
    _apply_profile_resource_input(db, profile, data, current_user.id)
    db.commit()
    db.refresh(profile)
    return _serialize_profile(profile)


@router.delete("/machine-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_machine_profile(profile_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.id == profile_id,
        ForgeMachineProfile.user_id == current_user.id,
        ForgeMachineProfile.is_archived.is_(False),
    ).first()
    if profile is None:
        raise _not_found("Maschinenprofil nicht gefunden.")

    # Current plans may safely fall back to choosing a profile when the session starts.
    db.query(ForgePlanExercise).filter(
        ForgePlanExercise.machine_profile_id == profile.id,
    ).update({ForgePlanExercise.machine_profile_id: None}, synchronize_session=False)

    has_session_history = db.query(ForgeSessionExercise.id).filter(
        ForgeSessionExercise.source_machine_profile_id == profile.id,
    ).first() is not None
    if has_session_history:
        # Keep the UUID for historic machine-specific filters and progression, but hide it
        # from every current exercise, plan and selector.
        profile.exercises = []
        profile.is_archived = True
    else:
        db.delete(profile)
    db.commit()


@router.get("/exercises", response_model=list[ForgeExerciseResponse])
async def list_exercises(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    exercises = db.query(ForgeExercise).filter(ForgeExercise.user_id == current_user.id).order_by(ForgeExercise.name).all()
    last_performances = _last_exercise_performances(db, current_user.id, [item.id for item in exercises])
    return [_serialize_exercise(exercise, db, current_user.id, last_performances) for exercise in exercises]


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
            ForgeMachineProfile.user_id == current_user.id,
        ).first()
        if profile is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Das Maschinenprofil gehört nicht zu deinem Konto.")

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
        "exercise": _serialize_exercise(exercise, db, current_user.id),
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
    _apply_exercise_input(db, exercise, data)
    db.add(exercise)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have an exercise with this name.")
    db.refresh(exercise)
    return _serialize_exercise(exercise, db, current_user.id)


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
    _apply_exercise_input(db, exercise, data)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Du hast bereits eine Übung mit diesem Namen.",
        )
    db.refresh(exercise)
    return _serialize_exercise(exercise, db, current_user.id)


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
    exercise_ids = [item.exercise_id for plan in plans for item in plan.exercises]
    last_performances = _last_exercise_performances(db, current_user.id, exercise_ids)
    return [_serialize_plan(plan, db, last_performances) for plan in plans]


@router.post("/plans", response_model=ForgePlanResponse, status_code=status.HTTP_201_CREATED)
async def create_plan(
    data: ForgePlanInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_plan_input(data)
    plan = ForgeTrainingPlan(
        user_id=current_user.id,
        name=data.name.strip(),
        description=data.description,
        plan_type=data.plan_type,
        default_duration_minutes=data.default_duration_minutes,
        position=data.position,
    )
    db.add(plan)
    db.flush()
    _replace_plan_exercises(db, plan, data, current_user.id)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan, db)


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
    _validate_plan_input(data)
    plan.name = data.name.strip()
    plan.description = data.description
    plan.plan_type = data.plan_type
    plan.default_duration_minutes = data.default_duration_minutes
    plan.position = data.position
    _replace_plan_exercises(db, plan, data, current_user.id)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan, db)


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.id == plan_id, ForgeTrainingPlan.user_id == current_user.id).first()
    if plan is None:
        raise _not_found("Training plan not found")
    image_storage_key = plan.image_storage_key
    db.delete(plan)
    db.commit()
    if image_storage_key:
        try:
            delete_progress_photo_file(image_storage_key)
        except PhotoStorageUnavailable:
            # The row is gone and the private storage cannot be reached right now.
            pass


@router.put("/plans/{plan_id}/image", response_model=ForgePlanResponse)
async def replace_plan_image(
    plan_id: UUID,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Normalize and attach one private image to an owned training-day plan."""
    plan = _owned_plan(db, current_user.id, plan_id)
    try:
        storage_root()
    except PhotoStorageUnavailable as error:
        raise storage_unavailable_error(error)
    normalized, width, height, digest = prepare_progress_photo(await image.read())
    storage_key = plan.image_storage_key or f"{current_user.id}/plans/{plan.id}.webp"
    try:
        write_progress_photo(storage_key, normalized)
        plan.image_storage_key = storage_key
        plan.image_content_type = "image/webp"
        plan.image_byte_size = len(normalized)
        plan.image_width = width
        plan.image_height = height
        plan.image_sha256 = digest
        db.commit()
        db.refresh(plan)
    except Exception:
        db.rollback()
        raise
    return _serialize_plan(plan, db)


@router.get("/plans/{plan_id}/image")
async def get_plan_image(
    plan_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Serve a plan image only to its owner; image files are never public URLs."""
    plan = _owned_plan(db, current_user.id, plan_id)
    if not plan.image_storage_key:
        raise _not_found("Training plan image not found")
    try:
        image_path = read_progress_photo(plan.image_storage_key)
    except PhotoStorageUnavailable as error:
        raise storage_unavailable_error(error)
    except FileNotFoundError:
        raise _not_found("Training plan image not found")
    return FileResponse(
        image_path,
        media_type=plan.image_content_type or "image/webp",
        headers={"Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/plans/{plan_id}/image", response_model=ForgePlanResponse)
async def delete_plan_image(
    plan_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    plan = _owned_plan(db, current_user.id, plan_id)
    storage_key = plan.image_storage_key
    plan.image_storage_key = None
    plan.image_content_type = None
    plan.image_byte_size = None
    plan.image_width = None
    plan.image_height = None
    plan.image_sha256 = None
    db.commit()
    db.refresh(plan)
    if storage_key:
        try:
            delete_progress_photo_file(storage_key)
        except PhotoStorageUnavailable:
            pass
    return _serialize_plan(plan, db)


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
                for profile in _available_machine_profiles(db, current_user.id, exercise.equipment)
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

def _serialize_program(
    program: ForgeTrainingProgram,
    db: Session,
    last_performances: dict[UUID, dict] | None = None,
) -> dict:
    if last_performances is None:
        exercise_ids = [
            item.exercise_id
            for routine in program.routines
            for item in routine.plan.exercises
        ]
        last_performances = _last_exercise_performances(db, program.user_id, exercise_ids)
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
                "plan": _serialize_plan(routine.plan, db, last_performances),
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
                "source_plan_exercise_id": exercise.source_plan_exercise_id,
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
    selected_profile_ids = {
        exercise.source_machine_profile_id
        for exercise in selected
        if exercise.source_machine_profile_id is not None
    }
    selected_profiles = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.user_id == user.id,
        ForgeMachineProfile.is_archived.is_(False),
        ForgeMachineProfile.id.in_(selected_profile_ids),
    ).all() if selected_profile_ids else []
    profiles_by_id = {profile.id: profile for profile in selected_profiles}
    profile_weights_by_exercise: dict[UUID, list[float]] = {}
    profile_notes_by_exercise: dict[UUID, str] = {}
    for exercise in selected:
        profile = profiles_by_id.get(exercise.source_machine_profile_id)
        profile_notes = profile.notes if profile else ""
        combined_notes = "\n".join(part for part in [exercise.notes, profile_notes] if part)
        profile_notes_by_exercise[exercise.id] = profile_notes
        profile_weights_by_exercise[exercise.id] = _parse_available_weights(combined_notes)
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
        if set_data.set_type == "warmup":
            # Warm-ups prepare the movement and do not share the hypertrophy range
            # of the working sets. Give the model a dedicated practical range.
            minimum, maximum = 6, 15
        progression_key = _native_progression_key(exercise.source_exercise_id, exercise.source_machine_profile_id)
        profile_weights = profile_weights_by_exercise.get(exercise.id, [])
        baseline_weight = set_data.target_weight_kg
        candidates = {float(baseline_weight)} if isinstance(baseline_weight, (int, float)) and isfinite(baseline_weight) and baseline_weight >= 0 else set()
        if set_data.set_type == "warmup":
            candidates.update(profile_weights)
            if not candidates:
                # A profile may be selected for the first time and have no explicit
                # weight list. Give the AI a conservative, concrete warm-up anchor
                # derived from this exercise's current/profile-specific working load.
                working_weights = [
                    sibling.target_weight_kg
                    for sibling in exercise.sets
                    if sibling.set_type == "working"
                    and isinstance(sibling.target_weight_kg, (int, float))
                    and isfinite(sibling.target_weight_kg)
                    and sibling.target_weight_kg > 0
                ]
                if not working_weights:
                    working_weights = list(historical_weights.get(progression_key or "", set()))
                if working_weights:
                    candidates.add(max(0.5, round(min(working_weights) * 0.5 * 2) / 2))
        else:
            # Explicit loads documented on the selected profile are valid for both
            # working and warm-up proposals. History remains more specific and is
            # still restricted to the same exercise/profile progression key.
            candidates.update(profile_weights)
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
                    "machine_profile_notes": profile_notes_by_exercise.get(exercise.id, ""),
                    "available_weight_kg": profile_weights_by_exercise.get(exercise.id, []),
                    "notes": "\n".join(part for part in [exercise.notes or "", profile_notes_by_exercise.get(exercise.id, "")] if part),
                    "deterministic_guidance": exercise.coach_guidance or {},
                    "working_set_count": sum(1 for set_data in exercise.sets if set_data.set_type == "working"),
                    "targets": [_target_context(exercise, set_data) for set_data in exercise.sets],
                }
                for exercise in selected
            ],
        },
        "recent_matching_history": history,
    }


def _apply_forge_set_proposals(session: ForgeWorkoutSession, coaching: dict) -> None:
    """Persist already-normalized proposals for both warm-up and working sets."""
    by_id = {str(set_data.id): set_data for exercise in session.exercises for set_data in exercise.sets}
    for proposal in coaching.get("set_proposals", []):
        if not isinstance(proposal, dict):
            continue
        set_data = by_id.get(str(proposal.get("session_set_id") or ""))
        if set_data is None:
            continue
        weight = proposal.get("target_weight_kg")
        reps = proposal.get("target_reps")
        if isinstance(weight, (int, float)) and not isinstance(weight, bool) and isfinite(weight) and 0 <= weight <= 1000:
            set_data.target_weight_kg = float(weight)
            set_data.coach_suggested_weight_kg = float(weight)
        if isinstance(reps, int) and not isinstance(reps, bool) and 1 <= reps <= 200:
            set_data.target_reps = reps
            set_data.coach_suggested_reps = reps


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


def _match_session_plan_exercises(
    session: ForgeWorkoutSession,
    plan: ForgeTrainingPlan,
) -> tuple[dict[UUID, ForgePlanExercise], list[ForgeSessionExercise], list[ForgePlanExercise]]:
    """Match snapshots to current plan rows by stable ID, then canonical exercise fallback."""
    plan_by_id = {item.id: item for item in plan.exercises}
    unmatched_plan = {item.id: item for item in plan.exercises}
    matches: dict[UUID, ForgePlanExercise] = {}
    unmatched_session: list[ForgeSessionExercise] = []

    for session_exercise in session.exercises:
        plan_exercise = plan_by_id.get(session_exercise.source_plan_exercise_id)
        if plan_exercise is not None and plan_exercise.id in unmatched_plan:
            matches[session_exercise.id] = plan_exercise
            unmatched_plan.pop(plan_exercise.id, None)
        else:
            unmatched_session.append(session_exercise)

    still_unmatched: list[ForgeSessionExercise] = []
    for session_exercise in unmatched_session:
        candidates = [
            item for item in unmatched_plan.values()
            if session_exercise.source_exercise_id is not None
            and item.exercise_id == session_exercise.source_exercise_id
        ]
        if not candidates:
            still_unmatched.append(session_exercise)
            continue
        plan_exercise = min(candidates, key=lambda item: abs(item.position - session_exercise.position))
        matches[session_exercise.id] = plan_exercise
        unmatched_plan.pop(plan_exercise.id, None)

    return matches, still_unmatched, list(unmatched_plan.values())


def _session_set_signature(session_exercise: ForgeSessionExercise) -> list[tuple]:
    return [
        (item.set_type, item.target_reps, (item.note or "").strip())
        for item in sorted(session_exercise.sets, key=lambda item: item.position)
    ]


def _plan_set_signature(plan_exercise: ForgePlanExercise) -> list[tuple]:
    return [
        (
            item.set_type,
            item.coach_suggested_reps if item.coach_suggested_reps is not None else item.current_reps,
            (item.note or "").strip(),
        )
        for item in sorted(plan_exercise.sets, key=lambda item: item.position)
    ]


def _plan_changes(db: Session, user_id: UUID, session: ForgeWorkoutSession) -> tuple[dict, ForgeTrainingPlan | None]:
    plan = None
    if session.source_plan_id is not None:
        plan = db.query(ForgeTrainingPlan).filter(
            ForgeTrainingPlan.id == session.source_plan_id,
            ForgeTrainingPlan.user_id == user_id,
            ForgeTrainingPlan.plan_type == "workout",
        ).first()
    if plan is None:
        return {"has_changes": False, "can_apply": False, "changes": []}, None

    matches, added_to_session, removed_from_session = _match_session_plan_exercises(session, plan)
    changes: list[dict] = []
    for session_exercise in added_to_session:
        changes.append({
            "kind": "exercise_added",
            "label": session_exercise.name,
            "detail": "Exercise exists in the session but not in the current source plan.",
        })
    for plan_exercise in removed_from_session:
        changes.append({
            "kind": "exercise_removed",
            "label": plan_exercise.exercise.name,
            "detail": "Exercise exists in the current source plan but not in the session.",
        })
    for session_exercise in session.exercises:
        plan_exercise = matches.get(session_exercise.id)
        if plan_exercise is None:
            continue
        label = session_exercise.name
        if session_exercise.position != plan_exercise.position:
            changes.append({
                "kind": "exercise_reordered",
                "label": label,
                "detail": f"Position changed from {plan_exercise.position + 1} to {session_exercise.position + 1}.",
            })
        if session_exercise.source_machine_profile_id != plan_exercise.machine_profile_id:
            changes.append({
                "kind": "profile_changed",
                "label": label,
                "detail": "Das ausgewählte Maschinenprofil unterscheidet sich vom aktuellen Trainingstag.",
            })
        if (session_exercise.notes or "").strip() != (plan_exercise.notes or "").strip():
            changes.append({
                "kind": "notes_changed",
                "label": label,
                "detail": "Exercise notes differ from the current source plan.",
            })
        if _session_set_signature(session_exercise) != _plan_set_signature(plan_exercise):
            changes.append({
                "kind": "sets_changed",
                "label": label,
                "detail": "Set order, type, target repetitions, or notes differ from the current source plan.",
            })

    can_apply = session.status == "active"
    for session_exercise in session.exercises:
        library_exercise = None
        if session_exercise.source_exercise_id is not None:
            library_exercise = db.query(ForgeExercise).filter(
                ForgeExercise.id == session_exercise.source_exercise_id,
                ForgeExercise.user_id == user_id,
            ).first()
        if library_exercise is None:
            can_apply = False
            continue
        if session_exercise.source_machine_profile_id is not None:
            profile = db.query(ForgeMachineProfile).filter(
                ForgeMachineProfile.id == session_exercise.source_machine_profile_id,
                ForgeMachineProfile.user_id == user_id,
                ForgeMachineProfile.is_archived.is_(False),
            ).first()
            if profile is None or library_exercise.equipment not in {"machine", "cable"}:
                can_apply = False

    return {"has_changes": bool(changes), "can_apply": can_apply, "changes": changes}, plan


def _apply_session_plan_changes(db: Session, user_id: UUID, session: ForgeWorkoutSession) -> None:
    payload, plan = _plan_changes(db, user_id, session)
    if plan is None or not payload["can_apply"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session changes cannot be applied because the source plan or one of its resources is no longer available.",
        )
    if not payload["has_changes"]:
        return

    matches, _, removed_plan_exercises = _match_session_plan_exercises(session, plan)
    for temporary_position, plan_exercise in enumerate(list(plan.exercises), start=1):
        plan_exercise.position = -temporary_position
    db.flush()
    for plan_exercise in removed_plan_exercises:
        plan.exercises.remove(plan_exercise)

    desired: list[tuple[ForgeSessionExercise, ForgePlanExercise]] = []
    for position, session_exercise in enumerate(sorted(session.exercises, key=lambda item: item.position)):
        library_exercise = db.query(ForgeExercise).filter(
            ForgeExercise.id == session_exercise.source_exercise_id,
            ForgeExercise.user_id == user_id,
        ).one()
        profile = None
        if session_exercise.source_machine_profile_id is not None:
            profile = db.query(ForgeMachineProfile).filter(
                ForgeMachineProfile.id == session_exercise.source_machine_profile_id,
                ForgeMachineProfile.user_id == user_id,
                ForgeMachineProfile.is_archived.is_(False),
            ).one_or_none()
        plan_exercise = matches.get(session_exercise.id)
        if plan_exercise is None:
            plan_exercise = ForgePlanExercise(exercise=library_exercise)
            plan.exercises.append(plan_exercise)
        plan_exercise.position = position
        plan_exercise.machine_profile = profile
        plan_exercise.notes = session_exercise.notes
        plan_exercise.sets.clear()
        desired.append((session_exercise, plan_exercise))
    db.flush()

    for session_exercise, plan_exercise in desired:
        session_exercise.source_plan_exercise_id = plan_exercise.id
        for position, session_set in enumerate(sorted(session_exercise.sets, key=lambda item: item.position)):
            plan_exercise.sets.append(ForgePlanSet(
                position=position,
                set_type=session_set.set_type,
                previous_weight_kg=None,
                previous_reps=None,
                current_weight_kg=None,
                current_reps=session_set.target_reps,
                coach_suggested_weight_kg=None,
                coach_suggested_reps=None,
                note=session_set.note,
            ))


def _session_machine_profile(
    db: Session,
    user_id: UUID,
    source_exercise_id: UUID | None,
    machine_profile_id: UUID | None,
) -> ForgeMachineProfile | None:
    """Resolve a submitted global profile ID for a machine or cable exercise."""
    if machine_profile_id is None:
        return None
    if source_exercise_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Für ein Maschinenprofil muss eine Übung aus deiner Bibliothek gewählt sein.")
    profile = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.id == machine_profile_id,
        ForgeMachineProfile.user_id == user_id,
        ForgeMachineProfile.is_archived.is_(False),
    ).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Das ausgewählte Geräteprofil ist nicht verfügbar.")
    exercise = db.query(ForgeExercise).filter(
        ForgeExercise.id == source_exercise_id,
        ForgeExercise.user_id == user_id,
    ).first()
    if exercise is None or exercise.equipment not in {"machine", "cable"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Maschinenprofile können nur Übungen mit Gerät ‚Maschine‘ oder ‚Kabelzug‘ zugeordnet werden.")
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
    exercise_ids = [
        item.exercise_id
        for program in programs
        for routine in program.routines
        for item in routine.plan.exercises
    ]
    last_performances = _last_exercise_performances(db, current_user.id, exercise_ids)
    return [_serialize_program(program, db, last_performances) for program in programs]


@router.post("/programs", response_model=ForgeProgramResponse, status_code=status.HTTP_201_CREATED)
async def create_program(data: ForgeProgramInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = ForgeTrainingProgram(user_id=current_user.id, name=data.name.strip(), mode=data.mode, is_active=data.is_active)
    db.add(program)
    db.flush()
    _apply_program_input(db, program, data, current_user.id)
    db.commit()
    db.refresh(program)
    return _serialize_program(program, db)


@router.put("/programs/{program_id}", response_model=ForgeProgramResponse)
async def update_program(program_id: UUID, data: ForgeProgramInput, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    program = _owned_program(db, current_user.id, program_id)
    _apply_program_input(db, program, data, current_user.id)
    db.commit()
    db.refresh(program)
    return _serialize_program(program, db)


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

    last_performances = _last_exercise_performances(
        db,
        current_user.id,
        [item.exercise_id for link in program.routines for item in link.plan.exercises],
    )
    routines = list(program.routines)
    if program.mode == "weekly":
        weekday = datetime.now(timezone.utc).astimezone().weekday()
        options = [routine.plan for routine in routines if weekday in (routine.weekdays or [])]
        if not options:
            return {"mode": "weekly", "program": _serialize_program(program, db, last_performances), "message": "Heute ist kein Training geplant."}
        return {
            "mode": "weekly",
            "program": _serialize_program(program, db, last_performances),
            "routine": _serialize_plan(options[0], db, last_performances),
            "options": [_serialize_plan(option, db, last_performances) for option in options],
            "message": "Heutige geplante Routine.",
        }

    routine = routines[program.rotation_cursor % len(routines)].plan
    # A rotation may repeat a routine across slots; offer every distinct routine only once.
    distinct_plans = list({item.plan.id: item.plan for item in routines}.values())
    return {
        "mode": "rotation",
        "program": _serialize_program(program, db, last_performances),
        "routine": _serialize_plan(routine, db, last_performances),
        "options": [_serialize_plan(plan, db, last_performances) for plan in distinct_plans],
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


def _session_guidance_by_plan_exercise(
    plan: ForgeTrainingPlan,
    progression: dict,
    targets: list[dict],
    profile_overrides: dict[UUID, ForgeMachineProfile] | None = None,
) -> dict[UUID, dict]:
    """Freeze the deterministic coach explanation next to each planned session exercise."""
    profile_overrides = profile_overrides or {}
    guidance: dict[UUID, dict] = {}
    for position, plan_exercise in enumerate(plan.exercises):
        target = targets[position] if position < len(targets) else {}
        profile = profile_overrides.get(plan_exercise.exercise.id) or plan_exercise.machine_profile
        progression_key = _native_progression_key(plan_exercise.exercise.id, profile.id if profile else None)
        progression_data = progression.get(progression_key, {})
        progression_status = target.get("progression_status") or progression_data.get("signal") or "FIRST_SESSION"
        guidance[plan_exercise.id] = {
            "progression_status": progression_status,
            "rep_range": progression_data.get("rep_range", "8–12"),
            "rationale": _native_session_rationale(progression_data, progression_status),
        }
    return guidance


def _snapshot_plan_into_session(
    plan: ForgeTrainingPlan,
    session: ForgeWorkoutSession,
    guidance_by_plan_exercise: dict[UUID, dict] | None = None,
    last_used_profiles: dict[UUID, ForgeMachineProfile] | None = None,
) -> None:
    guidance_by_plan_exercise = guidance_by_plan_exercise or {}
    last_used_profiles = last_used_profiles or {}
    for exercise_position, plan_exercise in enumerate(plan.exercises):
        exercise = plan_exercise.exercise
        machine_profile = last_used_profiles.get(exercise.id) or plan_exercise.machine_profile
        session_exercise = ForgeSessionExercise(
            source_exercise_id=exercise.id,
            source_plan_exercise_id=plan_exercise.id,
            name=exercise.name,
            icon=exercise.icon,
            equipment=exercise.equipment,
            primary_muscle_group=exercise.primary_muscle_group,
            secondary_muscle_groups=exercise.secondary_muscle_groups or [],
            source_machine_profile_id=machine_profile.id if machine_profile else None,
            machine_profile_name=machine_profile.name if machine_profile else None,
            notes=plan_exercise.notes,
            coach_guidance=guidance_by_plan_exercise.get(plan_exercise.id),
            position=exercise_position,
        )
        for set_position, plan_set in enumerate(plan_exercise.sets):
            session_exercise.sets.append(ForgeSessionSet(
                position=set_position,
                set_type=plan_set.set_type,
                target_weight_kg=plan_set.coach_suggested_weight_kg,
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
        if _apply_last_used_profiles_to_session(db, current_user.id, active_session):
            db.commit()
            db.refresh(active_session)
        return _serialize_session(active_session)

    plan = _owned_plan(db, current_user.id, data.plan_id)
    if plan.plan_type == "course":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Courses are completed directly from the dashboard.")
    program = _owned_program(db, current_user.id, data.program_id) if data.program_id else None
    if program is not None and not any(link.plan_id == plan.id for link in program.routines):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This routine is not part of the selected program.")
    last_used_profiles = _last_used_machine_profiles(
        db,
        current_user.id,
        [plan_exercise.exercise_id for plan_exercise in plan.exercises],
    )
    progression, targets = _refresh_native_coach_targets(db, current_user.id, plan, last_used_profiles)
    guidance_by_plan_exercise = _session_guidance_by_plan_exercise(
        plan,
        progression,
        targets,
        last_used_profiles,
    )
    session = ForgeWorkoutSession(
        user_id=current_user.id,
        program_id=program.id if program else None,
        source_plan_id=plan.id,
        name=plan.name,
        status="active",
    )
    _snapshot_plan_into_session(plan, session, guidance_by_plan_exercise, last_used_profiles)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/start-coaching", response_model=ForgeSessionResponse)
async def generate_session_start_coaching(
    session_id: UUID,
    force: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the session briefing; force allows an active session to regenerate it."""
    session = _owned_session(db, current_user.id, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed sessions do not need a new start briefing.")
    profiles_backfilled = _apply_last_used_profiles_to_session(db, current_user.id, session)
    missing_warmup_targets = any(
        set_data.set_type == "warmup"
        and set_data.target_weight_kg is None
        and set_data.coach_suggested_weight_kg is None
        for exercise in session.exercises
        for set_data in exercise.sets
    )
    if session.start_coaching is None or force or profiles_backfilled or missing_warmup_targets:
        coaching_profile = await _forge_coaching_profile(current_user)
        context = _session_coaching_context(db, current_user, session, coaching_profile)
        try:
            coaching = await generate_forge_session_start_coaching(context, current_user.language or "de")
        except ForgeCoachingGenerationError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
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
    if session is not None and _apply_last_used_profiles_to_session(db, current_user.id, session):
        db.commit()
        db.refresh(session)
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


@router.get("/sessions/{session_id}/plan-changes", response_model=ForgePlanChangesResponse)
async def get_session_plan_changes(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _owned_session(db, current_user.id, session_id)
    payload, _ = _plan_changes(db, current_user.id, session)
    return payload


@router.get("/sessions/{session_id}", response_model=ForgeSessionResponse)
async def get_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = _owned_session(db, current_user.id, session_id)
    if session.status == "active" and _apply_last_used_profiles_to_session(db, current_user.id, session):
        db.commit()
        db.refresh(session)
    return _serialize_session(session)


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
    machine_profile = (
        _last_used_machine_profiles(db, current_user.id, [exercise.id]).get(exercise.id)
        if data.machine_profile_id is None and exercise is not None
        else _session_machine_profile(
            db,
            current_user.id,
            exercise.id if exercise else None,
            data.machine_profile_id,
        )
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


async def _apply_isolated_session_exercise_coaching(
    db: Session,
    user: User,
    session: ForgeWorkoutSession,
    exercise: ForgeSessionExercise,
) -> None:
    """Generate and persist coaching only for one session exercise/profile identity."""
    coaching_profile = await _forge_coaching_profile(user)
    context = _session_coaching_context(
        db, user, session, coaching_profile, only_exercise_id=exercise.id,
    )
    try:
        generated = await generate_forge_session_start_coaching(context, user.language or "de")
    except ForgeCoachingGenerationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    _apply_forge_set_proposals(session, generated)
    decision = next(
        (item for item in generated.get("exercise_decisions", []) if item.get("session_exercise_id") == str(exercise.id)),
        None,
    )
    if decision is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Exercise coaching could not be prepared safely.")
    exercise.addition_coaching = {
        "recommendation": decision["recommendation"],
        "first_set_focus": decision["first_set_focus"],
        "effort_hint": decision["effort_hint"],
    }


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
        await _apply_isolated_session_exercise_coaching(db, current_user, session, exercise)
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
    profile_changed = False
    library_exercise = None
    if "machine_profile_id" in updates:
        previous_profile_id = exercise.source_machine_profile_id
        machine_profile = _session_machine_profile(
            db,
            current_user.id,
            exercise.source_exercise_id,
            updates.pop("machine_profile_id"),
        )
        profile_changed = previous_profile_id != (machine_profile.id if machine_profile else None)
        exercise.source_machine_profile_id = machine_profile.id if machine_profile else None
        exercise.machine_profile_name = machine_profile.name if machine_profile else None
        library_exercise = db.query(ForgeExercise).filter(
            ForgeExercise.id == exercise.source_exercise_id,
            ForgeExercise.user_id == current_user.id,
        ).first()
        if library_exercise is not None and profile_changed:
            # Keep the previous snapshot as a first-use anchor only when this profile
            # has no history yet. Once a profile has history, that history wins and is
            # isolated by exercise + profile identity.
            existing_targets = {
                set_data.position: {
                    "target_weight_kg": set_data.target_weight_kg,
                    "target_reps": set_data.target_reps,
                }
                for set_data in exercise.sets
            }
            profile_targets = _last_profile_set_targets(
                db,
                current_user.id,
                exercise.source_exercise_id,
                machine_profile.id if machine_profile else None,
            )
            for set_data in exercise.sets:
                set_data.target_weight_kg = None
                set_data.target_reps = None
                set_data.coach_suggested_weight_kg = None
                set_data.coach_suggested_reps = None
                seed = (profile_targets.get(set_data.position) or existing_targets.get(set_data.position)) if machine_profile is not None else {}
                if seed.get("target_weight_kg") is not None:
                    set_data.target_weight_kg = seed["target_weight_kg"]
                if seed.get("target_reps") is not None:
                    set_data.target_reps = seed["target_reps"]

            if machine_profile is not None:
                profile_notes = "\n".join(part for part in [exercise.notes, machine_profile.notes] if part)
                documented_weights = _parse_available_weights(profile_notes)
                working_weights = [
                    set_data.target_weight_kg
                    for set_data in exercise.sets
                    if set_data.set_type == "working"
                    and isinstance(set_data.target_weight_kg, (int, float))
                    and set_data.target_weight_kg > 0
                ]
                warmup_weight = min(documented_weights) if documented_weights else None
                if warmup_weight is None and working_weights:
                    # A first use has no profile history yet. Use a conservative,
                    # editable half-load anchor so the AI can still return a real
                    # warm-up target instead of an em dash.
                    warmup_weight = max(0.5, round(min(working_weights) * 0.5 * 2) / 2)
                for set_data in exercise.sets:
                    if set_data.set_type == "warmup":
                        if set_data.target_weight_kg is None and warmup_weight is not None:
                            set_data.target_weight_kg = warmup_weight
                        if set_data.target_reps is None:
                            set_data.target_reps = 10

            _apply_live_session_exercise_guidance(db, current_user.id, exercise, library_exercise, machine_profile)
            exercise.addition_coaching = None
    for key, value in updates.items():
        setattr(exercise, key, value)
    if profile_changed and library_exercise is not None:
        await _apply_isolated_session_exercise_coaching(db, current_user, session, exercise)
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


async def _complete_session(
    db: Session,
    user: User,
    session: ForgeWorkoutSession,
    *,
    refresh_coach_targets: bool = True,
    clear_applied_plan_id: UUID | None = None,
) -> ForgeWorkoutSession:
    """Complete a session and run shared program/export side effects exactly once."""
    if session.status == "completed":
        return session
    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)
    if session.program and session.program.mode == "rotation" and session.program.routines:
        current = session.program.routines[session.program.rotation_cursor % len(session.program.routines)]
        if current.plan_id == session.source_plan_id:
            session.program.rotation_cursor = (session.program.rotation_cursor + 1) % len(session.program.routines)
    if refresh_coach_targets:
        for plan in db.query(ForgeTrainingPlan).filter(
            ForgeTrainingPlan.user_id == user.id,
            ForgeTrainingPlan.plan_type == "workout",
        ).all():
            _refresh_native_coach_targets(db, user.id, plan)
    if clear_applied_plan_id is not None:
        applied_plan = db.query(ForgeTrainingPlan).filter(
            ForgeTrainingPlan.id == clear_applied_plan_id,
            ForgeTrainingPlan.user_id == user.id,
        ).first()
        if applied_plan is not None:
            for plan_exercise in applied_plan.exercises:
                for plan_set in plan_exercise.sets:
                    plan_set.previous_weight_kg = None
                    plan_set.previous_reps = None
                    plan_set.current_weight_kg = None
                    plan_set.coach_suggested_weight_kg = None
                    plan_set.coach_suggested_reps = None
    db.commit()
    db.refresh(session)
    # The local workout must stay completed even if Google is unavailable.
    # Export state and any error are persisted by the integration service.
    await export_completed_session(db, session)
    return session


@router.post("/plans/{plan_id}/complete-course", response_model=ForgeSessionResponse, status_code=status.HTTP_201_CREATED)
async def complete_course(
    plan_id: UUID,
    data: ForgeCompleteCourseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a course immediately without opening a live exercise-tracking session."""
    active_session = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == current_user.id,
        ForgeWorkoutSession.status == "active",
    ).first()
    if active_session is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complete or discard your active session before completing a course.")

    plan = _owned_plan(db, current_user.id, plan_id)
    if plan.plan_type != "course" or plan.default_duration_minutes is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This routine is not a course with a default duration.")
    program = _owned_program(db, current_user.id, data.program_id) if data.program_id else None
    if program is not None and not any(link.plan_id == plan.id for link in program.routines):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="This routine is not part of the selected program.")

    completed_at = datetime.now(timezone.utc)
    session = ForgeWorkoutSession(
        user_id=current_user.id,
        program_id=program.id if program else None,
        source_plan_id=plan.id,
        name=plan.name,
        status="active",
        started_at=completed_at - timedelta(minutes=plan.default_duration_minutes),
    )
    db.add(session)
    db.flush()
    await _complete_session(db, current_user, session, refresh_coach_targets=False)
    return _serialize_session(session)


@router.post("/sessions/{session_id}/complete", response_model=ForgeSessionResponse)
async def complete_session(
    session_id: UUID,
    data: ForgeCompleteSessionRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _owned_session(db, current_user.id, session_id)
    applied_plan_id = None
    if session.status != "completed" and data is not None and data.apply_plan_changes:
        _apply_session_plan_changes(db, current_user.id, session)
        applied_plan_id = session.source_plan_id
    session = await _complete_session(
        db,
        current_user,
        session,
        clear_applied_plan_id=applied_plan_id,
    )
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


def _native_plan_template(
    plan: ForgeTrainingPlan,
    profile_overrides: dict[UUID, ForgeMachineProfile] | None = None,
) -> list[dict]:
    """Normalize a native routine into the deterministic progression template shape."""
    profile_overrides = profile_overrides or {}
    template = []
    for plan_exercise in plan.exercises:
        machine_profile = profile_overrides.get(plan_exercise.exercise.id) or plan_exercise.machine_profile
        note_parts = [part for part in [plan_exercise.notes, machine_profile.notes if machine_profile else None] if part]
        template.append({
            "title": plan_exercise.exercise.name,
            "progression_key": _native_progression_key(plan_exercise.exercise.id, machine_profile.id if machine_profile else None),
            "muscle_group": plan_exercise.exercise.primary_muscle_group,
            "notes": "\n".join(note_parts),
            "sets": [
                {
                    "type": plan_set.set_type,
                    # Preserve an explicitly configured warm-up load. Working-set loads still come
                    # exclusively from completed actual sets and the verified progression logic.
                    "weight_kg": (
                        plan_set.coach_suggested_weight_kg
                        if plan_set.set_type == "warmup" and plan_set.coach_suggested_weight_kg is not None
                        else plan_set.current_weight_kg
                        if plan_set.set_type == "warmup"
                        else None
                    ),
                    "reps": (
                        plan_set.coach_suggested_reps
                        if plan_set.set_type == "warmup" and plan_set.coach_suggested_reps is not None
                        else plan_set.current_reps
                    ),
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
                        if set_data.completed
                        and set_data.set_type == "working"
                        and set_data.actual_weight_kg is not None
                        and set_data.actual_reps is not None
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


def _refresh_native_coach_targets(
    db: Session,
    user_id: UUID,
    plan: ForgeTrainingPlan,
    profile_overrides: dict[UUID, ForgeMachineProfile] | None = None,
) -> tuple[dict, list[dict]]:
    """Persist targets using a distinct history bucket for every selected machine profile."""
    profile_overrides = profile_overrides or {}
    template = _native_plan_template(plan, profile_overrides)
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
        profile = profile_overrides.get(plan_exercise.exercise.id) or plan_exercise.machine_profile
        progression_key = _native_progression_key(plan_exercise.exercise.id, profile.id if profile else None)
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
    return _serialize_plan(plan, db)
