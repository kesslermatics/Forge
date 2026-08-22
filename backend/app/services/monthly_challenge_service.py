"""Persistent, account-scoped monthly Forge challenges.

Training facts are derived only from completed native Forge sessions and actual,
completed working sets. The AI may select from conservative candidates and write a
check-in, but it never calculates or changes numeric progress.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.encryption import decrypt_value
from app.models import (
    ForgeSessionExercise,
    ForgeSessionSet,
    ForgeWorkoutSession,
    MonthlyChallenge,
    MonthlyChallengeCheckin,
    MonthlyChallengeCycle,
    User,
    WeightEntry,
)
from app.services.ai_service import (
    generate_monthly_challenge_checkin,
    select_monthly_challenge_categories,
)
from app.services.yazio_service import fetch_yazio_summary


MONTHLY_CATEGORIES = {"consistency", "strength", "weight", "nutrition", "quality"}


def month_start_for(day: date | None = None) -> date:
    value = day or date.today()
    return value.replace(day=1)


def next_month_start(month_start: date) -> date:
    return (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)


def _session_query(db: Session, user_id, start: date | None = None, end: date | None = None):
    query = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeWorkoutSession.completed_at.isnot(None),
    )
    if start is not None:
        query = query.filter(ForgeWorkoutSession.completed_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
    if end is not None:
        query = query.filter(ForgeWorkoutSession.completed_at < datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc))
    return query


def _completed_session_count(db: Session, user_id, start: date, end: date) -> int:
    return _session_query(db, user_id, start, end).count()


def _working_set_rows(db: Session, user_id, start: date | None = None, end: date | None = None):
    query = db.query(ForgeWorkoutSession, ForgeSessionExercise, ForgeSessionSet).join(
        ForgeSessionExercise, ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
    ).join(
        ForgeSessionSet, ForgeSessionSet.session_exercise_id == ForgeSessionExercise.id,
    ).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeWorkoutSession.completed_at.isnot(None),
        ForgeSessionSet.completed.is_(True),
        ForgeSessionSet.set_type == "working",
        ForgeSessionSet.actual_weight_kg.isnot(None),
        ForgeSessionSet.actual_reps.isnot(None),
        ForgeSessionSet.actual_weight_kg >= 0,
        ForgeSessionSet.actual_reps > 0,
    )
    if start is not None:
        query = query.filter(ForgeWorkoutSession.completed_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
    if end is not None:
        query = query.filter(ForgeWorkoutSession.completed_at < datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc))
    return query.all()


def _consistency_candidate(db: Session, user: User, start: date) -> dict[str, Any]:
    recent_start = start - timedelta(days=28)
    recent_sessions = _completed_session_count(db, user.id, recent_start, start)
    target = 8 if recent_sessions == 0 else max(6, min(12, round(recent_sessions)))
    return {
        "category": "consistency",
        "metric": "completed_sessions",
        "title": f"{target} Forge-Trainings abschließen",
        "description": "Jede vollständig abgeschlossene Forge-Session zählt direkt in deinen Monatsfortschritt.",
        "icon": "CalendarCheck",
        "unit": "Trainings",
        "baseline_value": 0.0,
        "target_value": float(target),
        "rules": {"source": "forge_completed_sessions", "month_start": start.isoformat()},
    }


def _quality_candidate(db: Session, user: User, start: date, consistency_target: int) -> dict[str, Any]:
    target = max(24, consistency_target * 3)
    return {
        "category": "quality",
        "metric": "logged_working_sets",
        "title": f"{target} Arbeitssätze sauber loggen",
        "description": "Es zählen nur erledigte Forge-Arbeitssätze mit eingetragenem Gewicht und Wiederholungen.",
        "icon": "ClipboardCheck",
        "unit": "Sätze",
        "baseline_value": 0.0,
        "target_value": float(target),
        "rules": {"source": "forge_completed_actual_working_sets", "month_start": start.isoformat()},
    }


def _strength_candidate(db: Session, user: User, start: date) -> dict[str, Any] | None:
    rows = _working_set_rows(db, user.id, end=start)
    grouped: dict[tuple[str, str], list[tuple[Any, Any, Any]]] = defaultdict(list)
    for session, exercise, set_data in rows:
        if exercise.source_exercise_id is None:
            continue
        key = (str(exercise.source_exercise_id), str(exercise.source_machine_profile_id or ""))
        grouped[key].append((session, exercise, set_data))
    eligible = [items for items in grouped.values() if len(items) >= 2]
    if not eligible:
        return None
    eligible.sort(key=lambda items: (len(items), max(item[0].completed_at for item in items)), reverse=True)
    selected = eligible[0]
    selected.sort(key=lambda item: item[0].completed_at, reverse=True)
    _, exercise, set_data = selected[0]
    weight = round(float(set_data.actual_weight_kg), 2)
    target_reps = min(20, int(set_data.actual_reps) + (2 if set_data.actual_reps <= 8 else 1))
    profile_id = str(exercise.source_machine_profile_id) if exercise.source_machine_profile_id else None
    return {
        "category": "strength",
        "metric": "best_reps_at_or_above_weight",
        "title": f"{exercise.name}: {weight:g} kg × {target_reps} Wdh.",
        "description": "Forge bewertet nur echte, abgeschlossene Arbeitssätze derselben Übung und Maschinenvariante.",
        "icon": exercise.icon or "Dumbbell",
        "unit": "Wdh.",
        "baseline_value": float(set_data.actual_reps),
        "target_value": float(target_reps),
        "rules": {
            "source": "forge_completed_actual_working_sets",
            "exercise_id": str(exercise.source_exercise_id),
            "machine_profile_id": profile_id,
            "minimum_weight_kg": weight,
        },
    }


def _weight_candidate(db: Session, user: User, start: date) -> dict[str, Any] | None:
    if user.target_weight is None:
        return None
    baseline = db.query(WeightEntry).filter(
        WeightEntry.user_id == user.id,
        WeightEntry.date < start,
    ).order_by(WeightEntry.date.desc()).first()
    if baseline is None:
        return None
    difference = float(user.target_weight) - float(baseline.weight_kg)
    if abs(difference) < 0.2:
        return None
    monthly_step = min(1.0, max(0.2, abs(difference) * 0.15))
    target = round(float(baseline.weight_kg) + (monthly_step if difference > 0 else -monthly_step), 2)
    direction = "erhöhen" if difference > 0 else "senken"
    return {
        "category": "weight",
        "metric": "weight_trend_toward_target",
        "title": f"Gewichtstrend kontrolliert {direction}",
        "description": f"Ausgangspunkt {baseline.weight_kg:.1f} kg · Monats-Zwischenziel {target:.1f} kg. Entscheidend ist der Trend, nicht ein einzelner Tageswert.",
        "icon": "Scale",
        "unit": "kg",
        "baseline_value": float(baseline.weight_kg),
        "target_value": target,
        "rules": {"source": "weight_entries", "direction": "up" if difference > 0 else "down"},
    }


def _nutrition_candidate(user: User) -> dict[str, Any] | None:
    if not user.yazio_email or not user.yazio_password:
        return None
    return {
        "category": "nutrition",
        "metric": "logged_nutrition_days",
        "title": "Ernährung an 20 Tagen loggen",
        "description": "Ein Tag zählt, wenn die tägliche Yazio-Zusammenfassung echte Kalorien oder Makros enthält.",
        "icon": "Utensils",
        "unit": "Tage",
        "baseline_value": 0.0,
        "target_value": 20.0,
        "rules": {"source": "daily_yazio_snapshots", "logged_requires_nutrition": True},
    }


async def get_or_create_current_cycle(db: Session, user: User, today: date | None = None) -> MonthlyChallengeCycle:
    start = month_start_for(today)
    existing = db.query(MonthlyChallengeCycle).filter(
        MonthlyChallengeCycle.user_id == user.id,
        MonthlyChallengeCycle.month_start == start,
    ).first()
    if existing:
        return existing

    consistency = _consistency_candidate(db, user, start)
    candidates = [consistency, _quality_candidate(db, user, start, int(consistency["target_value"]))]
    for candidate in (_strength_candidate(db, user, start), _weight_candidate(db, user, start), _nutrition_candidate(user)):
        if candidate is not None:
            candidates.append(candidate)

    selected_categories = await select_monthly_challenge_categories(
        candidates=candidates,
        user_context={
            "current_goal": user.current_goal,
            "target_weight_kg": user.target_weight,
            "available_categories": [candidate["category"] for candidate in candidates],
        },
        language=user.language or "de",
    )
    selected = [candidate for candidate in candidates if candidate["category"] in selected_categories]
    if not selected:
        selected = candidates[:3]
    selected = selected[:3]

    cycle = MonthlyChallengeCycle(
        user_id=user.id,
        month_start=start,
        total_challenges=len(selected),
        completed_challenges=0,
        completion_percent=0.0,
    )
    db.add(cycle)
    db.flush()
    for slot, candidate in enumerate(selected, start=1):
        db.add(MonthlyChallenge(cycle_id=cycle.id, slot=slot, **candidate))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(MonthlyChallengeCycle).filter(
            MonthlyChallengeCycle.user_id == user.id,
            MonthlyChallengeCycle.month_start == start,
        ).first()
        if existing is None:
            raise
        return existing
    db.refresh(cycle)
    return cycle


def _weight_progress(db: Session, user_id, cycle: MonthlyChallengeCycle, challenge: MonthlyChallenge) -> tuple[float, float]:
    current = db.query(WeightEntry).filter(
        WeightEntry.user_id == user_id,
        WeightEntry.date >= cycle.month_start,
    ).order_by(WeightEntry.date.desc()).first()
    if current is None:
        return float(challenge.baseline_value), 0.0
    current_value = float(current.weight_kg)
    baseline = float(challenge.baseline_value)
    target = float(challenge.target_value)
    wanted = target - baseline
    achieved = current_value - baseline
    percent = 0.0 if wanted == 0 else max(0.0, min(100.0, achieved / wanted * 100))
    return current_value, percent


def _challenge_progress(db: Session, user: User, cycle: MonthlyChallengeCycle, challenge: MonthlyChallenge) -> dict[str, Any]:
    end = next_month_start(cycle.month_start)
    target = float(challenge.target_value)
    current = 0.0
    if challenge.metric == "completed_sessions":
        current = float(_completed_session_count(db, user.id, cycle.month_start, end))
    elif challenge.metric == "logged_working_sets":
        current = float(len(_working_set_rows(db, user.id, cycle.month_start, end)))
    elif challenge.metric == "best_reps_at_or_above_weight":
        rules = challenge.rules or {}
        exercise_id = str(rules.get("exercise_id") or "")
        profile_id = str(rules.get("machine_profile_id") or "")
        minimum_weight = float(rules.get("minimum_weight_kg") or 0)
        reps = [
            float(set_data.actual_reps)
            for _, exercise, set_data in _working_set_rows(db, user.id, cycle.month_start, end)
            if str(exercise.source_exercise_id or "") == exercise_id
            and str(exercise.source_machine_profile_id or "") == profile_id
            and float(set_data.actual_weight_kg) >= minimum_weight
        ]
        current = max(reps, default=0.0)
    elif challenge.metric == "weight_trend_toward_target":
        current, percent = _weight_progress(db, user.id, cycle, challenge)
        return _finalize_progress(challenge, current, percent)
    elif challenge.metric == "logged_nutrition_days":
        snapshots = db.query(MonthlyChallengeCheckin).filter(
            MonthlyChallengeCheckin.cycle_id == cycle.id,
            MonthlyChallengeCheckin.date >= cycle.month_start,
            MonthlyChallengeCheckin.date < end,
        ).all()
        current = float(sum(bool((snapshot.metrics_snapshot or {}).get("nutrition", {}).get("logged")) for snapshot in snapshots))
    percent = 0.0 if target <= 0 else min(100.0, current / target * 100)
    return _finalize_progress(challenge, current, percent)


def _finalize_progress(challenge: MonthlyChallenge, current: float, percent: float) -> dict[str, Any]:
    if challenge.status == "active" and percent >= 100:
        challenge.status = "completed"
        challenge.completed_at = datetime.now(timezone.utc)
        challenge.completion_stats = {"current_value": current, "target_value": challenge.target_value, "progress_percent": 100.0}
    if challenge.status == "completed":
        percent = 100.0
    return {
        "id": challenge.id,
        "slot": challenge.slot,
        "category": challenge.category,
        "metric": challenge.metric,
        "title": challenge.title,
        "description": challenge.description,
        "icon": challenge.icon,
        "unit": challenge.unit,
        "baseline_value": challenge.baseline_value,
        "current_value": round(current, 2),
        "target_value": challenge.target_value,
        "progress_percent": round(percent, 1),
        "status": challenge.status,
        "completed_at": challenge.completed_at,
        "completion_stats": challenge.completion_stats,
    }


def serialize_cycle(db: Session, user: User, cycle: MonthlyChallengeCycle) -> dict[str, Any]:
    challenges = [_challenge_progress(db, user, cycle, challenge) for challenge in sorted(cycle.challenges, key=lambda item: item.slot)]
    cycle.total_challenges = len(challenges)
    cycle.completed_challenges = sum(challenge["status"] == "completed" for challenge in challenges)
    cycle.completion_percent = round((cycle.completed_challenges / cycle.total_challenges * 100) if cycle.total_challenges else 0.0, 1)
    latest_checkin = db.query(MonthlyChallengeCheckin).filter(
        MonthlyChallengeCheckin.cycle_id == cycle.id,
    ).order_by(MonthlyChallengeCheckin.date.desc()).first()
    return {
        "id": cycle.id,
        "month_start": cycle.month_start,
        "total_challenges": cycle.total_challenges,
        "completed_challenges": cycle.completed_challenges,
        "completion_percent": cycle.completion_percent,
        "challenges": challenges,
        "latest_checkin": latest_checkin.checkin_data if latest_checkin else None,
        "latest_checkin_date": latest_checkin.date if latest_checkin else None,
    }


async def _nutrition_snapshot(user: User, db: Session, today: date) -> dict[str, Any]:
    snapshot: dict[str, Any] = {"available": False, "logged": False}
    if not user.yazio_email or not user.yazio_password:
        return snapshot
    try:
        data = await fetch_yazio_summary(
            decrypt_value(user.yazio_email),
            decrypt_value(user.yazio_password),
            target_date=today,
        )
        totals = (data or {}).get("totals") or {}
        goals = (data or {}).get("goals") or {}
        protein = float(totals.get("protein") or 0)
        calories = float(totals.get("calories") or 0)
        snapshot = {
            "available": bool(data),
            "logged": calories > 0 or protein > 0,
            "calories": calories,
            "protein_g": protein,
            "protein_goal_g": float(goals.get("protein") or 0),
        }
        weight = ((data or {}).get("profile") or {}).get("current_weight_kg")
        if weight and float(weight) > 0:
            entry = db.query(WeightEntry).filter(WeightEntry.user_id == user.id, WeightEntry.date == today).first()
            if entry is None:
                db.add(WeightEntry(user_id=user.id, date=today, weight_kg=round(float(weight), 2)))
            else:
                entry.weight_kg = round(float(weight), 2)
        return snapshot
    except Exception:
        return snapshot


async def generate_daily_challenge_checkin(db: Session, user: User, today: date | None = None) -> MonthlyChallengeCheckin:
    checkin_date = today or date.today()
    cycle = await get_or_create_current_cycle(db, user, checkin_date)
    existing = db.query(MonthlyChallengeCheckin).filter(
        MonthlyChallengeCheckin.cycle_id == cycle.id,
        MonthlyChallengeCheckin.date == checkin_date,
    ).first()
    if existing:
        return existing

    nutrition = await _nutrition_snapshot(user, db, checkin_date)
    checkin = MonthlyChallengeCheckin(
        cycle_id=cycle.id,
        user_id=user.id,
        date=checkin_date,
        metrics_snapshot={"nutrition": nutrition},
        progress_snapshot={},
        checkin_data={},
    )
    db.add(checkin)
    db.flush()
    live = serialize_cycle(db, user, cycle)
    checkin.progress_snapshot = {"completed_challenges": live["completed_challenges"], "completion_percent": live["completion_percent"], "challenges": live["challenges"]}
    checkin.checkin_data = await generate_monthly_challenge_checkin(
        challenges=live["challenges"],
        current_goal=user.current_goal,
        nutrition=nutrition,
        language=user.language or "de",
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(MonthlyChallengeCheckin).filter(
            MonthlyChallengeCheckin.cycle_id == cycle.id,
            MonthlyChallengeCheckin.date == checkin_date,
        ).first()
        if existing is not None:
            return existing
        raise
    db.refresh(checkin)
    return checkin
