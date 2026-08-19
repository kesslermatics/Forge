"""Provider-neutral projections of completed native Forge sessions."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models import ForgeSessionExercise, ForgeTrainingPlan, ForgeWorkoutSession


def completed_forge_workouts(
    db: Session,
    user_id: UUID,
    limit: Optional[int] = None,
) -> list[dict]:
    """Return completed Forge sessions in the workout shape used by AI and analytics.

    Only completed sets are included. Target values are deliberately never mapped to
    actual values: a completed session with unlogged sets represents attendance, not
    fabricated performance.
    """
    query = (
        db.query(ForgeWorkoutSession)
        .options(joinedload(ForgeWorkoutSession.exercises).joinedload(ForgeSessionExercise.sets))
        .filter(
            ForgeWorkoutSession.user_id == user_id,
            ForgeWorkoutSession.status == "completed",
        )
        .order_by(
            ForgeWorkoutSession.completed_at.desc(),
            ForgeWorkoutSession.started_at.desc(),
        )
    )
    if limit is not None:
        query = query.limit(limit)

    return [_serialize_completed_session(session) for session in query.all()]


def completed_forge_workout_dates(db: Session, user_id: UUID) -> list[dict]:
    """Return the date projection expected by the activity heatmap."""
    return [
        {
            "date": (workout.get("start_time") or "")[:10],
            "title": workout["title"],
            "duration_min": workout.get("duration_min"),
        }
        for workout in completed_forge_workouts(db, user_id)
        if workout.get("start_time")
    ]


def forge_training_plan_context(db: Session, user_id: UUID) -> list[dict]:
    """Return native plan names and exercise names for the global coach chat."""
    plans = (
        db.query(ForgeTrainingPlan)
        .filter(ForgeTrainingPlan.user_id == user_id)
        .order_by(ForgeTrainingPlan.position, ForgeTrainingPlan.name)
        .all()
    )
    return [
        {
            "name": plan.name,
            "exercises": [plan_exercise.exercise.name for plan_exercise in plan.exercises],
        }
        for plan in plans
    ]


def forge_plan_template(
    db: Session,
    user_id: UUID,
    workout_name: str,
    source_plan_id: UUID | str | None = None,
) -> list[dict] | None:
    """Project the originating native plan into the workout-tips template shape.

    Session plan IDs are authoritative. Name lookup is only a fallback when it has
    one unambiguous match, so two plans with the same display name cannot cross-wire
    targets.
    """
    plan_query = db.query(ForgeTrainingPlan).filter(ForgeTrainingPlan.user_id == user_id)
    if source_plan_id:
        try:
            source_plan_uuid = UUID(str(source_plan_id))
        except (TypeError, ValueError):
            source_plan_uuid = None
        if source_plan_uuid is not None:
            plan = plan_query.filter(ForgeTrainingPlan.id == source_plan_uuid).first()
            if plan is not None:
                return _serialize_plan_template(plan)

    matching_plans = (
        plan_query
        .filter(ForgeTrainingPlan.name.ilike(workout_name.strip()))
        .order_by(ForgeTrainingPlan.position)
        .all()
    )
    if len(matching_plans) != 1:
        return None
    return _serialize_plan_template(matching_plans[0])


def _serialize_plan_template(plan: ForgeTrainingPlan) -> list[dict]:
    return [
        {
            "title": plan_exercise.exercise.name,
            "muscle_group": plan_exercise.exercise.primary_muscle_group,
            "notes": plan_exercise.notes or "",
            "sets": [
                {
                    "type": plan_set.set_type,
                    "weight_kg": plan_set.current_weight_kg,
                    "reps": plan_set.current_reps,
                }
                for plan_set in plan_exercise.sets
            ],
        }
        for plan_exercise in plan.exercises
    ]


def _serialize_completed_session(session: ForgeWorkoutSession) -> dict:
    completed_at = session.completed_at or session.started_at
    duration_min = None
    if session.started_at and completed_at:
        duration_min = round(max(0, (completed_at - session.started_at).total_seconds()) / 60, 1)

    return {
        "id": str(session.id),
        "source_plan_id": str(session.source_plan_id) if session.source_plan_id else None,
        "title": session.name,
        "start_time": session.started_at.isoformat() if session.started_at else "",
        "end_time": completed_at.isoformat() if completed_at else "",
        "duration_min": duration_min,
        "exercises": [
            {
                "title": exercise.name,
                "muscle_group": exercise.primary_muscle_group or "other",
                "notes": exercise.notes or "",
                "sets": [
                    {
                        "type": set_data.set_type,
                        "weight_kg": set_data.actual_weight_kg,
                        "reps": set_data.actual_reps,
                    }
                    for set_data in exercise.sets
                    if set_data.completed
                ],
            }
            for exercise in session.exercises
        ],
    }
