"""Plan, program and exercise tools for external agents (MCP).

These functions reuse the validated persistence helpers that back the Forge web UI
(``app.routes.forge``) so an agent edit and a UI edit follow exactly the same rules.
They are deliberately not part of the internal Coach agent: the Coach stays read-only.

Every function takes the authenticated ``User`` and a ``Session``; nothing here accepts a
user id from the caller, so all reads and writes are scoped to the token owner.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    ForgeExercise,
    ForgeMachineProfile,
    ForgeTrainingPlan,
    ForgeTrainingProgram,
    User,
)
from app.schemas import (
    ForgeExerciseInput,
    ForgePlanExerciseInput,
    ForgePlanInput,
    ForgePlanSetInput,
    ForgeProgramInput,
    ForgeProgramRoutineInput,
)
from app.services.ai_service import (
    FORGE_ICON_NAMES,
    FORGE_MUSCLE_GROUPS,
    _canonical_forge_muscle,
)

logger = logging.getLogger(__name__)

EQUIPMENT_OPTIONS = ("none", "barbell", "dumbbell", "kettlebell", "cable", "machine", "other")
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_WEEKDAY_ALIASES = {
    "mon": 0, "monday": 0, "mo": 0, "montag": 0,
    "tue": 1, "tuesday": 1, "di": 1, "dienstag": 1,
    "wed": 2, "wednesday": 2, "mi": 2, "mittwoch": 2,
    "thu": 3, "thursday": 3, "do": 3, "donnerstag": 3,
    "fri": 4, "friday": 4, "fr": 4, "freitag": 4,
    "sat": 5, "saturday": 5, "sa": 5, "samstag": 5,
    "sun": 6, "sunday": 6, "so": 6, "sonntag": 6,
}


class ForgePlanToolError(Exception):
    """A validation or lookup problem whose message is safe to show to the agent."""


# ── Input models (also used as MCP tool parameter types) ──────────────────────────

class PlanSetSpec(BaseModel):
    set_type: Literal["warmup", "working"] = "working"
    target_reps: int | None = Field(None, ge=0, le=200, description="Planned repetitions for this set.")
    target_weight_kg: float | None = Field(None, ge=0, le=1000, description="Planned weight in kg.")
    note: str | None = Field(None, max_length=300)


class PlanExerciseSpec(BaseModel):
    exercise_id: UUID | None = Field(None, description="ID from list_exercises. Alternatively pass exercise_name.")
    exercise_name: str | None = Field(None, max_length=255, description="Exact exercise name (case-insensitive).")
    warmup_sets: int | None = Field(None, ge=0, le=6, description="Number of warm-up sets.")
    working_sets: int | None = Field(None, ge=1, le=12, description="Number of working sets.")
    sets: list[PlanSetSpec] | None = Field(
        None, max_length=12,
        description="Explicit ordered sets. Overrides warmup_sets/working_sets.",
    )
    machine_profile_id: UUID | None = Field(None, description="Machine profile ID (machine/cable exercises only).")
    clear_machine_profile: bool = False
    notes: str | None = Field(None, max_length=500, description="Plan note for this exercise. Empty string clears it.")


class ProgramRoutineSpec(BaseModel):
    plan_id: UUID | None = Field(None, description="Plan ID from list_plans. Alternatively pass plan_name.")
    plan_name: str | None = Field(None, max_length=255)
    weekdays: list[int | str] = Field(
        default_factory=list, max_length=7,
        description="Weekly mode only. Monday=0 ... Sunday=6, or names such as 'mon' / 'Montag'.",
    )


# ── Helpers ───────────────────────────────────────────────────────────────────────

def _forge():
    # Imported lazily: the route module is heavy and imports most of the backend.
    from app.routes import forge
    return forge


def _guard(db: Session, action):
    """Run ``action`` and turn framework errors into ForgePlanToolError after rollback."""
    try:
        return action()
    except ForgePlanToolError:
        db.rollback()
        raise
    except HTTPException as exc:
        db.rollback()
        raise ForgePlanToolError(str(exc.detail)) from exc
    except ValidationError as exc:
        db.rollback()
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()))
        raise ForgePlanToolError(f"Invalid input ({location}): {first.get('msg', 'validation failed')}") from exc
    except IntegrityError as exc:
        db.rollback()
        raise ForgePlanToolError("The change conflicts with existing data (for example a duplicate name or an exercise still used in a plan).") from exc
    except Exception:
        db.rollback()
        raise


def _clean(value: dict) -> dict:
    return {key: item for key, item in value.items() if item is not None and item != []}


def _owned_plan(db: Session, user: User, plan_id: UUID | None, plan_name: str | None = None) -> ForgeTrainingPlan:
    query = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.user_id == user.id)
    if plan_id is not None:
        plan = query.filter(ForgeTrainingPlan.id == plan_id).first()
        if plan is None:
            raise ForgePlanToolError("Plan not found. Use list_plans to get valid IDs.")
        return plan
    if plan_name and plan_name.strip():
        matches = query.filter(func.lower(ForgeTrainingPlan.name) == plan_name.strip().lower()).all()
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise ForgePlanToolError(f"No plan named '{plan_name}'. Use list_plans to see the available plans.")
        raise ForgePlanToolError(f"Several plans are named '{plan_name}'. Use plan_id instead.")
    raise ForgePlanToolError("Provide plan_id (or plan_name).")


def _resolve_exercise(db: Session, user: User, exercise_id: UUID | None, exercise_name: str | None) -> ForgeExercise:
    query = db.query(ForgeExercise).filter(ForgeExercise.user_id == user.id)
    if exercise_id is not None:
        exercise = query.filter(ForgeExercise.id == exercise_id).first()
        if exercise is None:
            raise ForgePlanToolError("Exercise not found. Use list_exercises to get valid IDs.")
        return exercise
    if exercise_name and exercise_name.strip():
        matches = query.filter(func.lower(ForgeExercise.name) == exercise_name.strip().lower()).all()
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise ForgePlanToolError(f"No exercise named '{exercise_name}'. Use list_exercises, or create_exercise first.")
        raise ForgePlanToolError(f"Several exercises are named '{exercise_name}'. Use exercise_id instead.")
    raise ForgePlanToolError("Each plan exercise needs exercise_id or exercise_name.")


# ── Plans ─────────────────────────────────────────────────────────────────────────

def _set_dict(plan_set) -> dict:
    return _clean({
        "position": plan_set.position,
        "set_type": plan_set.set_type,
        "target_reps": plan_set.current_reps,
        "target_weight_kg": plan_set.current_weight_kg,
        "last_reps": plan_set.previous_reps,
        "last_weight_kg": plan_set.previous_weight_kg,
        "coach_suggested_reps": plan_set.coach_suggested_reps,
        "coach_suggested_weight_kg": plan_set.coach_suggested_weight_kg,
        "note": plan_set.note,
    })


def _plan_dict(plan: ForgeTrainingPlan) -> dict:
    exercises = []
    for plan_exercise in plan.exercises:
        sets = list(plan_exercise.sets)
        profile = plan_exercise.machine_profile
        exercises.append(_clean({
            "position": plan_exercise.position,
            "exercise_id": str(plan_exercise.exercise_id),
            "exercise_name": plan_exercise.exercise.name,
            "primary_muscle_group": plan_exercise.exercise.primary_muscle_group,
            "equipment": plan_exercise.exercise.equipment,
            "machine_profile": {"id": str(profile.id), "name": profile.name} if profile else None,
            "notes": plan_exercise.notes,
            "warmup_sets": sum(1 for item in sets if item.set_type == "warmup"),
            "working_sets": sum(1 for item in sets if item.set_type != "warmup"),
            "sets": [_set_dict(item) for item in sets],
        }))
    return _clean({
        "id": str(plan.id),
        "name": plan.name,
        "description": plan.description,
        "plan_type": plan.plan_type,
        "default_duration_minutes": plan.default_duration_minutes,
        "position": plan.position,
        "exercises": exercises,
    })


def list_plans(db: Session, user: User) -> dict[str, Any]:
    plans = db.query(ForgeTrainingPlan).filter(
        ForgeTrainingPlan.user_id == user.id,
    ).order_by(ForgeTrainingPlan.position, ForgeTrainingPlan.created_at).all()
    return {"plans": [_plan_dict(plan) for plan in plans]}


def _capture_existing(plan: ForgeTrainingPlan) -> list[dict]:
    """Snapshot current plan rows; the persistence helper rebuilds them from scratch."""
    captured = []
    for plan_exercise in plan.exercises:
        captured.append({
            "exercise_id": plan_exercise.exercise_id,
            "machine_profile_id": plan_exercise.machine_profile_id,
            "notes": plan_exercise.notes,
            "sets": [
                ForgePlanSetInput(
                    set_type=item.set_type if item.set_type in ("warmup", "working") else "working",
                    previous_weight_kg=item.previous_weight_kg,
                    previous_reps=item.previous_reps,
                    current_weight_kg=item.current_weight_kg,
                    current_reps=item.current_reps,
                    coach_suggested_weight_kg=item.coach_suggested_weight_kg,
                    coach_suggested_reps=item.coach_suggested_reps,
                    note=item.note,
                )
                for item in plan_exercise.sets
            ],
        })
    return captured


def _sets_from_counts(existing: list[ForgePlanSetInput], warmup: int, working: int) -> list[ForgePlanSetInput]:
    pools = {
        "warmup": [item for item in existing if item.set_type == "warmup"],
        "working": [item for item in existing if item.set_type == "working"],
    }
    built: list[ForgePlanSetInput] = []
    for set_type, count in (("warmup", warmup), ("working", working)):
        pool = pools[set_type]
        for index in range(count):
            if index < len(pool):
                built.append(pool[index].model_copy())
            elif pool:
                # New sets inherit the target of the last set of the same type.
                template = pool[-1]
                built.append(ForgePlanSetInput(
                    set_type=set_type,
                    current_reps=template.current_reps,
                    current_weight_kg=template.current_weight_kg,
                ))
            else:
                built.append(ForgePlanSetInput(set_type=set_type))
    return built


def _build_entries(
    db: Session,
    user: User,
    specs: list[PlanExerciseSpec],
    existing: list[dict],
) -> list[ForgePlanExerciseInput]:
    unused = list(existing)
    entries: list[ForgePlanExerciseInput] = []
    for spec in specs:
        exercise = _resolve_exercise(db, user, spec.exercise_id, spec.exercise_name)
        base = next((item for item in unused if item["exercise_id"] == exercise.id), None)
        if base is not None:
            unused.remove(base)
        base_sets: list[ForgePlanSetInput] = list(base["sets"]) if base else []

        if spec.sets is not None:
            sets = [
                ForgePlanSetInput(
                    set_type=item.set_type,
                    current_reps=item.target_reps,
                    current_weight_kg=item.target_weight_kg,
                    note=item.note,
                )
                for item in spec.sets
            ]
        elif spec.warmup_sets is not None or spec.working_sets is not None:
            current_warmup = sum(1 for item in base_sets if item.set_type == "warmup")
            current_working = sum(1 for item in base_sets if item.set_type == "working")
            warmup = spec.warmup_sets if spec.warmup_sets is not None else current_warmup
            working = spec.working_sets if spec.working_sets is not None else (current_working or 3)
            sets = _sets_from_counts(base_sets, warmup, working)
        elif base is not None:
            sets = base_sets
        else:
            sets = _sets_from_counts([], 0, 3)

        if spec.clear_machine_profile:
            profile_id = None
        elif spec.machine_profile_id is not None:
            profile_id = spec.machine_profile_id
        else:
            profile_id = base["machine_profile_id"] if base else None

        if spec.notes is not None:
            notes = spec.notes.strip() or None
        else:
            notes = base["notes"] if base else None

        entries.append(ForgePlanExerciseInput(
            exercise_id=exercise.id,
            machine_profile_id=profile_id,
            notes=notes,
            sets=sets,
        ))
    return entries


def _finish_plan_write(db: Session, user: User, plan: ForgeTrainingPlan) -> dict[str, Any]:
    forge = _forge()
    db.commit()
    db.refresh(plan)
    if plan.plan_type == "workout" and plan.exercises:
        try:
            # Restores last-performance and coach-suggestion columns that the rebuild reset.
            forge._refresh_native_coach_targets(db, user.id, plan)
            db.commit()
            db.refresh(plan)
        except Exception:
            db.rollback()
            logger.exception("Coach target refresh failed after an MCP plan write")
    return _plan_dict(plan)


def create_plan(
    db: Session,
    user: User,
    *,
    name: str,
    description: str | None = None,
    plan_type: Literal["workout", "course"] = "workout",
    default_duration_minutes: int | None = None,
    position: int | None = None,
    exercises: list[PlanExerciseSpec] | None = None,
) -> dict[str, Any]:
    def action():
        forge = _forge()
        if position is None:
            highest = db.query(func.max(ForgeTrainingPlan.position)).filter(ForgeTrainingPlan.user_id == user.id).scalar()
            resolved_position = min(100, (highest + 1) if highest is not None else 0)
        else:
            resolved_position = position
        entries = _build_entries(db, user, exercises or [], [])
        data = ForgePlanInput(
            name=name,
            description=(description or "").strip() or None,
            plan_type=plan_type,
            default_duration_minutes=default_duration_minutes,
            position=resolved_position,
            exercises=entries,
        )
        forge._validate_plan_input(data)
        plan = ForgeTrainingPlan(
            user_id=user.id,
            name=data.name.strip(),
            description=data.description,
            plan_type=data.plan_type,
            default_duration_minutes=data.default_duration_minutes,
            position=data.position,
        )
        db.add(plan)
        db.flush()
        forge._replace_plan_exercises(db, plan, data, user.id)
        return {"plan": _finish_plan_write(db, user, plan)}

    return _guard(db, action)


def update_plan(
    db: Session,
    user: User,
    *,
    plan_id: UUID,
    name: str | None = None,
    description: str | None = None,
    default_duration_minutes: int | None = None,
    position: int | None = None,
    exercises: list[PlanExerciseSpec] | None = None,
) -> dict[str, Any]:
    def action():
        forge = _forge()
        plan = _owned_plan(db, user, plan_id)
        existing = _capture_existing(plan)
        entries = (
            _build_entries(db, user, exercises, existing)
            if exercises is not None
            else [
                ForgePlanExerciseInput(
                    exercise_id=item["exercise_id"],
                    machine_profile_id=item["machine_profile_id"],
                    notes=item["notes"],
                    sets=item["sets"],
                )
                for item in existing
            ]
        )
        data = ForgePlanInput(
            name=name if name is not None else plan.name,
            description=((description or "").strip() or None) if description is not None else plan.description,
            plan_type=plan.plan_type,
            default_duration_minutes=(
                default_duration_minutes if default_duration_minutes is not None else plan.default_duration_minutes
            ),
            position=position if position is not None else plan.position,
            exercises=entries,
        )
        forge._validate_plan_input(data)
        plan.name = data.name.strip()
        plan.description = data.description
        plan.default_duration_minutes = data.default_duration_minutes
        plan.position = data.position
        forge._replace_plan_exercises(db, plan, data, user.id)
        return {"plan": _finish_plan_write(db, user, plan)}

    return _guard(db, action)


def delete_plan(db: Session, user: User, *, plan_id: UUID, confirm: bool) -> dict[str, Any]:
    if confirm is not True:
        raise ForgePlanToolError("Deleting a plan is permanent. Call delete_plan again with confirm=true to proceed.")

    def action():
        plan = _owned_plan(db, user, plan_id)
        plan_name = plan.name
        image_key = plan.image_storage_key
        from app.models import ForgeProgramRoutine
        affected = [
            program.name
            for program in db.query(ForgeTrainingProgram).join(
                ForgeProgramRoutine, ForgeProgramRoutine.program_id == ForgeTrainingProgram.id,
            ).filter(
                ForgeTrainingProgram.user_id == user.id,
                ForgeProgramRoutine.plan_id == plan.id,
            ).distinct().all()
        ]
        db.delete(plan)
        db.commit()
        if image_key:
            try:
                from app.services.progress_photo_storage import delete_progress_photo
                delete_progress_photo(image_key)
            except Exception:
                logger.warning("Plan image cleanup failed after plan deletion", exc_info=True)
        return {
            "deleted": True,
            "plan_name": plan_name,
            "removed_from_programs": affected,
            "note": "Completed workouts that used this plan are kept in the history.",
        }

    return _guard(db, action)


# ── Programs (split / rhythm) ─────────────────────────────────────────────────────

def _program_dict(program: ForgeTrainingProgram) -> dict:
    routines = list(program.routines)
    routine_rows = [
        _clean({
            "slot": index,
            "plan_id": str(link.plan_id),
            "plan_name": link.plan.name,
            "weekdays": list(link.weekdays or []) if program.mode == "weekly" else None,
            "weekday_names": [WEEKDAY_NAMES[day] for day in sorted(link.weekdays or []) if 0 <= day <= 6]
            if program.mode == "weekly" else None,
        })
        for index, link in enumerate(routines)
    ]
    next_routine = None
    if routines:
        if program.mode == "rotation":
            slot = program.rotation_cursor % len(routines)
            next_routine = {"slot": slot, "plan_id": str(routines[slot].plan_id), "plan_name": routines[slot].plan.name}
        else:
            weekday = datetime.now(ZoneInfo("Europe/Berlin")).weekday()
            today = [link for link in routines if weekday in (link.weekdays or [])]
            next_routine = (
                {"plan_id": str(today[0].plan_id), "plan_name": today[0].plan.name, "for": "today"}
                if today else {"for": "today", "message": "Rest day: no routine scheduled today."}
            )
    return _clean({
        "id": str(program.id),
        "name": program.name,
        "mode": program.mode,
        "is_active": program.is_active,
        "rotation_cursor": program.rotation_cursor if program.mode == "rotation" else None,
        "next_routine": next_routine,
        "routines": routine_rows,
        "explanation": (
            "rotation: routines run in slot order and repeat; the same plan may occupy several slots."
            if program.mode == "rotation"
            else "weekly: each routine is tied to weekdays (Monday=0 ... Sunday=6); other days are rest days."
        ),
    })


def get_training_program(db: Session, user: User) -> dict[str, Any]:
    programs = db.query(ForgeTrainingProgram).filter(
        ForgeTrainingProgram.user_id == user.id,
    ).order_by(ForgeTrainingProgram.created_at).all()
    return {
        "programs": [_program_dict(program) for program in programs],
        "active_program_id": next((str(program.id) for program in programs if program.is_active), None),
    }


def _parse_weekdays(values: list[int | str]) -> list[int]:
    days: list[int] = []
    for value in values:
        if isinstance(value, bool):
            raise ForgePlanToolError("Weekdays must be 0-6 (Monday=0) or day names.")
        if isinstance(value, int):
            day = value
        else:
            text = str(value).strip().casefold()
            if text.isdigit():
                day = int(text)
            elif text in _WEEKDAY_ALIASES:
                day = _WEEKDAY_ALIASES[text]
            else:
                raise ForgePlanToolError(f"Unknown weekday '{value}'. Use 0-6 (Monday=0) or names like 'mon', 'Montag'.")
        if not 0 <= day <= 6:
            raise ForgePlanToolError("Weekdays must be between Monday (0) and Sunday (6).")
        days.append(day)
    return sorted(set(days))


def update_training_program(
    db: Session,
    user: User,
    *,
    program_id: UUID | None = None,
    name: str | None = None,
    mode: Literal["rotation", "weekly"] | None = None,
    is_active: bool | None = None,
    routines: list[ProgramRoutineSpec] | None = None,
) -> dict[str, Any]:
    def action():
        forge = _forge()
        query = db.query(ForgeTrainingProgram).filter(ForgeTrainingProgram.user_id == user.id)
        if program_id is not None:
            program = query.filter(ForgeTrainingProgram.id == program_id).first()
        else:
            program = query.filter(ForgeTrainingProgram.is_active.is_(True)).order_by(ForgeTrainingProgram.created_at).first()
        if program is None:
            raise ForgePlanToolError("No matching training program found. Use get_training_program to see the available programs.")

        if routines is None:
            routine_inputs = [
                ForgeProgramRoutineInput(plan_id=link.plan_id, weekdays=list(link.weekdays or []))
                for link in program.routines
            ]
        else:
            routine_inputs = []
            for spec in routines:
                plan = _owned_plan(db, user, spec.plan_id, spec.plan_name)
                routine_inputs.append(ForgeProgramRoutineInput(plan_id=plan.id, weekdays=_parse_weekdays(spec.weekdays)))

        data = ForgeProgramInput(
            name=name if name is not None else program.name,
            mode=mode if mode is not None else program.mode,
            is_active=is_active if is_active is not None else program.is_active,
            routines=routine_inputs,
        )
        forge._apply_program_input(db, program, data, user.id)
        db.commit()
        db.refresh(program)
        return {"program": _program_dict(program)}

    return _guard(db, action)


# ── Exercises ─────────────────────────────────────────────────────────────────────

def _exercise_dict(exercise: ForgeExercise) -> dict:
    return _clean({
        "id": str(exercise.id),
        "name": exercise.name,
        "icon": exercise.icon,
        "equipment": exercise.equipment,
        "primary_muscle_group": exercise.primary_muscle_group,
        "secondary_muscle_groups": list(exercise.secondary_muscle_groups or []),
        "machine_profiles": [
            {"id": str(profile.id), "name": profile.name}
            for profile in exercise.machine_profiles
            if not profile.is_archived
        ],
    })


def list_exercises(db: Session, user: User) -> dict[str, Any]:
    exercises = db.query(ForgeExercise).filter(ForgeExercise.user_id == user.id).order_by(ForgeExercise.name).all()
    profiles = db.query(ForgeMachineProfile).filter(
        ForgeMachineProfile.user_id == user.id,
        ForgeMachineProfile.is_archived.is_(False),
    ).order_by(ForgeMachineProfile.name).all()
    return {
        "exercises": [_exercise_dict(item) for item in exercises],
        "machine_profiles": [
            _clean({
                "id": str(profile.id),
                "name": profile.name,
                "model": profile.model,
                "loading_system": profile.loading_system,
                "load_basis": profile.load_basis,
                "available_weights_kg": list(profile.available_weights_kg or []),
            })
            for profile in profiles
        ],
        "options": {
            "muscle_groups": list(FORGE_MUSCLE_GROUPS),
            "equipment": list(EQUIPMENT_OPTIONS),
            "icons": list(FORGE_ICON_NAMES),
        },
    }


def _muscle(value: str, label: str) -> str:
    canonical = _canonical_forge_muscle(value, fallback="")
    if not canonical:
        raise ForgePlanToolError(f"Unknown {label} '{value}'. Allowed: {', '.join(FORGE_MUSCLE_GROUPS)}.")
    return canonical


def _icon(value: str) -> str:
    match = next((name for name in FORGE_ICON_NAMES if name.casefold() == value.strip().casefold()), None)
    if match is None:
        raise ForgePlanToolError(f"Unknown icon '{value}'. Allowed: {', '.join(FORGE_ICON_NAMES)}.")
    return match


def _secondary(values: list[str], primary: str) -> list[str]:
    result: list[str] = []
    for value in values:
        canonical = _muscle(value, "secondary muscle group")
        if canonical != primary and canonical not in result:
            result.append(canonical)
    return result


def create_exercise(
    db: Session,
    user: User,
    *,
    name: str,
    primary_muscle_group: str,
    equipment: Literal["none", "barbell", "dumbbell", "kettlebell", "cable", "machine", "other"] = "other",
    icon: str = "Dumbbell",
    secondary_muscle_groups: list[str] | None = None,
    machine_profile_ids: list[UUID] | None = None,
) -> dict[str, Any]:
    def action():
        forge = _forge()
        primary = _muscle(primary_muscle_group, "primary_muscle_group")
        data = ForgeExerciseInput(
            name=name,
            icon=_icon(icon),
            equipment=equipment,
            primary_muscle_group=primary,
            secondary_muscle_groups=_secondary(secondary_muscle_groups or [], primary),
            machine_profile_ids=machine_profile_ids,
        )
        if db.query(ForgeExercise.id).filter(
            ForgeExercise.user_id == user.id,
            func.lower(ForgeExercise.name) == data.name.strip().lower(),
        ).first():
            raise ForgePlanToolError(f"An exercise named '{data.name.strip()}' already exists.")
        exercise = ForgeExercise(user_id=user.id)
        forge._apply_exercise_input(db, exercise, data)
        db.add(exercise)
        db.commit()
        db.refresh(exercise)
        return {"exercise": _exercise_dict(exercise)}

    return _guard(db, action)


def update_exercise(
    db: Session,
    user: User,
    *,
    exercise_id: UUID,
    name: str | None = None,
    primary_muscle_group: str | None = None,
    equipment: Literal["none", "barbell", "dumbbell", "kettlebell", "cable", "machine", "other"] | None = None,
    icon: str | None = None,
    secondary_muscle_groups: list[str] | None = None,
    machine_profile_ids: list[UUID] | None = None,
) -> dict[str, Any]:
    def action():
        forge = _forge()
        exercise = _resolve_exercise(db, user, exercise_id, None)
        primary = _muscle(primary_muscle_group, "primary_muscle_group") if primary_muscle_group else exercise.primary_muscle_group
        if secondary_muscle_groups is not None:
            secondary = _secondary(secondary_muscle_groups, primary)
        else:
            # Untouched values are kept as stored, so legacy values never block an unrelated edit.
            secondary = [group for group in (exercise.secondary_muscle_groups or []) if group != primary]
        new_name = (name if name is not None else exercise.name).strip()
        if db.query(ForgeExercise.id).filter(
            ForgeExercise.user_id == user.id,
            ForgeExercise.id != exercise.id,
            func.lower(ForgeExercise.name) == new_name.lower(),
        ).first():
            raise ForgePlanToolError(f"Another exercise is already named '{new_name}'.")
        data = ForgeExerciseInput(
            name=new_name,
            icon=_icon(icon) if icon else exercise.icon,
            equipment=equipment if equipment is not None else exercise.equipment,
            primary_muscle_group=primary,
            secondary_muscle_groups=secondary,
            machine_profile_ids=machine_profile_ids,
        )
        forge._apply_exercise_input(db, exercise, data)
        db.commit()
        db.refresh(exercise)
        return {"exercise": _exercise_dict(exercise)}

    return _guard(db, action)
