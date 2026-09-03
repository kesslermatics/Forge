"""Persistent monthly Forge challenges with deterministic, account-scoped progress."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.encryption import decrypt_value
from app.models import (
    ForgeSessionExercise, ForgeSessionSet, ForgeWorkoutSession,
    MonthlyChallenge, MonthlyChallengeCheckin, MonthlyChallengeCycle, User, WeightEntry,
)
from app.services.ai_service import generate_monthly_challenge_checkin
from app.services.yazio_service import fetch_yazio_summary, resolve_yazio_goal_context

MONTHLY_CATEGORIES = ("consistency", "strength", "weight", "nutrition", "quality")
CHALLENGE_FORMAT_VERSION = 3


def month_start_for(day: date | None = None) -> date:
    return (day or date.today()).replace(day=1)


def next_month_start(month_start: date) -> date:
    return (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)


def _session_query(db: Session, user_id, start: date | None = None, end: date | None = None):
    query = db.query(ForgeWorkoutSession).filter(
        ForgeWorkoutSession.user_id == user_id,
        ForgeWorkoutSession.status == "completed",
        ForgeWorkoutSession.completed_at.isnot(None),
    )
    if start:
        query = query.filter(ForgeWorkoutSession.completed_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
    if end:
        query = query.filter(ForgeWorkoutSession.completed_at < datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc))
    return query


def _completed_session_count(db: Session, user_id, start: date, end: date) -> int:
    return _session_query(db, user_id, start, end).count()


def _working_set_rows(db: Session, user_id, start: date | None = None, end: date | None = None):
    query = db.query(ForgeWorkoutSession, ForgeSessionExercise, ForgeSessionSet).join(
        ForgeSessionExercise, ForgeSessionExercise.session_id == ForgeWorkoutSession.id,
    ).join(ForgeSessionSet, ForgeSessionSet.session_exercise_id == ForgeSessionExercise.id).filter(
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
    if start:
        query = query.filter(ForgeWorkoutSession.completed_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc))
    if end:
        query = query.filter(ForgeWorkoutSession.completed_at < datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc))
    return query.all()


def _goal_direction(value: Any) -> str | None:
    text = str(value or "").strip().lower().replace("_", " ").replace("-", " ")
    if any(token in text for token in ("lose", "loss", "abnehm", "cut", "deficit", "fettverlust")):
        return "down"
    if any(token in text for token in ("gain", "bulk", "aufbau", "zunehm", "surplus")):
        return "up"
    if any(token in text for token in ("maintain", "erhalt", "recomp", "recomposition")):
        return "maintain"
    return None


async def _goal_context(user: User) -> dict[str, Any]:
    """Read the goal direction exclusively from the current Yazio profile."""
    if not user.yazio_email or not user.yazio_password:
        return {"direction": None, "source": "unavailable", "goal": None, "profile": {}, "nutrition": None}
    try:
        context = await resolve_yazio_goal_context(
            decrypt_value(user.yazio_email), decrypt_value(user.yazio_password), target_date=date.today(),
        )
    except Exception:
        return {"direction": None, "source": "unavailable", "goal": None, "profile": {}, "nutrition": None}
    return {
        "direction": _goal_direction(context["goal"]),
        "source": context["source"],
        "goal": context["goal"],
        "profile": context["profile"],
        "nutrition": context["nutrition"],
    }


def _base_rules(source: str, **extra: Any) -> dict[str, Any]:
    return {"format_version": CHALLENGE_FORMAT_VERSION, "source": source, **extra}


def _consistency_candidate(db: Session, user: User, start: date) -> dict[str, Any]:
    recent = _completed_session_count(db, user.id, start - timedelta(days=28), start)
    target = 8 if recent == 0 else max(6, min(12, round(recent)))
    return {"category": "consistency", "metric": "completed_sessions", "title": f"{target} Forge-Trainings abschließen", "description": "Jede abgeschlossene Forge-Session zählt direkt.", "icon": "CalendarCheck", "unit": "Trainings", "baseline_value": 0.0, "target_value": float(target), "rules": _base_rules("forge_completed_sessions")}


def _strength_candidate(db: Session, user: User, start: date) -> dict[str, Any]:
    grouped: dict[tuple[str, str], list[tuple[Any, Any, Any]]] = defaultdict(list)
    for session, exercise, set_data in _working_set_rows(db, user.id, end=start):
        if exercise.source_exercise_id is not None:
            grouped[(str(exercise.source_exercise_id), str(exercise.source_machine_profile_id or ""))].append((session, exercise, set_data))
    eligible = [sets for sets in grouped.values() if len(sets) >= 2]
    if not eligible:
        return {"category": "strength", "metric": "strength_baseline_sessions", "title": "Kraft-Baseline in 3 Sessions erfassen", "description": "Logge in drei Forge-Sessions mindestens einen echten Arbeitssatz mit Gewicht und Wiederholungen.", "icon": "Dumbbell", "unit": "Sessions", "baseline_value": 0.0, "target_value": 3.0, "rules": _base_rules("forge_completed_actual_working_sets", fallback="baseline")}
    eligible.sort(key=lambda sets: (len(sets), max(item[0].completed_at for item in sets)), reverse=True)
    selected = sorted(eligible[0], key=lambda item: item[0].completed_at, reverse=True)
    _, exercise, set_data = selected[0]
    weight = round(float(set_data.actual_weight_kg), 2)
    target_reps = min(20, int(set_data.actual_reps) + (2 if set_data.actual_reps <= 8 else 1))
    return {"category": "strength", "metric": "best_reps_at_or_above_weight", "title": f"{exercise.name}: {weight:g} kg × {target_reps} Wdh.", "description": "Nur echte, abgeschlossene Arbeitssätze derselben Übung und Maschinenvariante zählen.", "icon": exercise.icon or "Dumbbell", "unit": "Wdh.", "baseline_value": float(set_data.actual_reps), "target_value": float(target_reps), "rules": _base_rules("forge_completed_actual_working_sets", exercise_id=str(exercise.source_exercise_id), machine_profile_id=str(exercise.source_machine_profile_id or ""), minimum_weight_kg=weight)}


def _weight_candidate(db: Session, user: User, start: date, goal: dict[str, Any]) -> dict[str, Any]:
    baseline_entry = db.query(WeightEntry).filter(WeightEntry.user_id == user.id, WeightEntry.date < start).order_by(WeightEntry.date.desc()).first()
    profile_weight = (goal.get("profile") or {}).get("current_weight_kg")
    baseline = float(baseline_entry.weight_kg) if baseline_entry else (float(profile_weight) if profile_weight else None)
    direction = goal.get("direction")
    if baseline is None or direction not in {"down", "up"}:
        return {"category": "weight", "metric": "weight_logged_days", "title": "Gewicht an 12 Tagen erfassen", "description": "Erst ein verlässlicher Verlauf macht ein sinnvolles Trendziel möglich.", "icon": "Scale", "unit": "Tage", "baseline_value": 0.0, "target_value": 12.0, "rules": _base_rules("weight_entries", fallback="baseline", goal_source=goal.get("source"))}
    weekly_change = abs(float((goal.get("profile") or {}).get("weight_change_per_week_kg") or 0))
    monthly_step = min(1.0, max(0.2, weekly_change * 4 if weekly_change else 0.3))
    target = round(baseline + (monthly_step if direction == "up" else -monthly_step), 2)
    verb = "erhöhen" if direction == "up" else "senken"
    return {"category": "weight", "metric": "weight_trend_toward_target", "title": f"Gewichtstrend kontrolliert {verb}", "description": f"Ausgangspunkt {baseline:.1f} kg · Monats-Zwischenziel {target:.1f} kg. Der geglättete Trend zählt, nicht ein einzelner Tageswert.", "icon": "Scale", "unit": "kg", "baseline_value": baseline, "target_value": target, "rules": _base_rules("weight_entries", direction=direction, goal_source=goal.get("source"), goal_value=goal.get("goal"))}


def _nutrition_candidate(user: User, goal: dict[str, Any]) -> dict[str, Any]:
    nutrition = goal.get("nutrition") or {}
    protein_goal = float((nutrition.get("goals") or {}).get("protein") or 0)
    if protein_goal > 0:
        return {"category": "nutrition", "metric": "protein_goal_days", "title": "Protein-Ziel an 20 Tagen erreichen", "description": f"Dein aktuelles Yazio-Protein-Ziel von {protein_goal:g} g ist die Messlatte.", "icon": "Utensils", "unit": "Tage", "baseline_value": 0.0, "target_value": 20.0, "rules": _base_rules("daily_yazio_snapshots", protein_goal_g=protein_goal)}
    if user.yazio_email and user.yazio_password:
        return {"category": "nutrition", "metric": "logged_nutrition_days", "title": "Ernährung an 20 Tagen loggen", "description": "Ein Tag zählt bei echten Kalorien oder Makros aus Yazio.", "icon": "Utensils", "unit": "Tage", "baseline_value": 0.0, "target_value": 20.0, "rules": _base_rules("daily_yazio_snapshots")}
    return {"category": "nutrition", "metric": "nutrition_connection", "title": "Yazio verbinden", "description": "Verbinde Yazio, damit Forge Ernährung und Makros sinnvoll verfolgen kann.", "icon": "Utensils", "unit": "Schritt", "baseline_value": 0.0, "target_value": 1.0, "rules": _base_rules("yazio_connection", fallback="connection")}


def _quality_candidate(db: Session, user: User, consistency_target: int) -> dict[str, Any]:
    target = max(16, consistency_target * 2)
    return {"category": "quality", "metric": "logged_working_sets", "title": f"{target} Arbeitssätze vollständig loggen", "description": "Es zählen erledigte Forge-Arbeitssätze mit Gewicht und Wiederholungen.", "icon": "ClipboardCheck", "unit": "Sätze", "baseline_value": 0.0, "target_value": float(target), "rules": _base_rules("forge_completed_actual_working_sets")}


def _cycle_is_current_format(cycle: MonthlyChallengeCycle) -> bool:
    categories = {challenge.category for challenge in cycle.challenges}
    return categories == set(MONTHLY_CATEGORIES) and len(cycle.challenges) == 5 and all((challenge.rules or {}).get("format_version") == CHALLENGE_FORMAT_VERSION for challenge in cycle.challenges)


async def get_or_create_current_cycle(db: Session, user: User, today: date | None = None) -> MonthlyChallengeCycle:
    start = month_start_for(today)
    cycle = db.query(MonthlyChallengeCycle).filter(MonthlyChallengeCycle.user_id == user.id, MonthlyChallengeCycle.month_start == start).first()
    if cycle and _cycle_is_current_format(cycle):
        return cycle
    if cycle is None:
        cycle = MonthlyChallengeCycle(user_id=user.id, month_start=start, total_challenges=5, completed_challenges=0, completion_percent=0.0)
        db.add(cycle)
        db.flush()
    else:
        # Replace only the current legacy three-card format requested by the user; old daily text was based on those wrong goals.
        db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id).delete(synchronize_session=False)
        db.query(MonthlyChallenge).filter(MonthlyChallenge.cycle_id == cycle.id).delete(synchronize_session=False)
        cycle.total_challenges, cycle.completed_challenges, cycle.completion_percent = 5, 0, 0.0
        db.flush()
        db.expire(cycle, ["challenges", "checkins"])

    goal = await _goal_context(user)
    consistency = _consistency_candidate(db, user, start)
    candidates = [
        consistency,
        _strength_candidate(db, user, start),
        _weight_candidate(db, user, start, goal),
        _nutrition_candidate(user, goal),
        _quality_candidate(db, user, int(consistency["target_value"])),
    ]
    for slot, candidate in enumerate(candidates, start=1):
        db.add(MonthlyChallenge(cycle_id=cycle.id, slot=slot, **candidate))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(MonthlyChallengeCycle).filter(MonthlyChallengeCycle.user_id == user.id, MonthlyChallengeCycle.month_start == start).first()
        if existing is None:
            raise
        return existing
    db.refresh(cycle)
    return cycle


def _weight_progress(db: Session, user_id, cycle: MonthlyChallengeCycle, challenge: MonthlyChallenge) -> tuple[float, float]:
    current = db.query(WeightEntry).filter(WeightEntry.user_id == user_id, WeightEntry.date >= cycle.month_start).order_by(WeightEntry.date.desc()).first()
    if current is None:
        return float(challenge.baseline_value), 0.0
    current_value, baseline, target = float(current.weight_kg), float(challenge.baseline_value), float(challenge.target_value)
    wanted, achieved = target - baseline, current_value - baseline
    return current_value, 0.0 if wanted == 0 else max(0.0, min(100.0, achieved / wanted * 100))


def _challenge_progress(db: Session, user: User, cycle: MonthlyChallengeCycle, challenge: MonthlyChallenge) -> dict[str, Any]:
    end, target, current = next_month_start(cycle.month_start), float(challenge.target_value), 0.0
    if challenge.metric == "completed_sessions":
        current = float(_completed_session_count(db, user.id, cycle.month_start, end))
    elif challenge.metric == "logged_working_sets":
        current = float(len(_working_set_rows(db, user.id, cycle.month_start, end)))
    elif challenge.metric == "strength_baseline_sessions":
        current = float(len({session.id for session, _, _ in _working_set_rows(db, user.id, cycle.month_start, end)}))
    elif challenge.metric == "best_reps_at_or_above_weight":
        rules, minimum = challenge.rules or {}, 0.0
        minimum = float(rules.get("minimum_weight_kg") or 0)
        current = max((float(set_data.actual_reps) for _, exercise, set_data in _working_set_rows(db, user.id, cycle.month_start, end) if str(exercise.source_exercise_id or "") == str(rules.get("exercise_id") or "") and str(exercise.source_machine_profile_id or "") == str(rules.get("machine_profile_id") or "") and float(set_data.actual_weight_kg) >= minimum), default=0.0)
    elif challenge.metric == "weight_trend_toward_target":
        current, percent = _weight_progress(db, user.id, cycle, challenge)
        return _finalize_progress(challenge, current, percent)
    elif challenge.metric == "weight_logged_days":
        current = float(db.query(WeightEntry).filter(WeightEntry.user_id == user.id, WeightEntry.date >= cycle.month_start, WeightEntry.date < end).count())
    elif challenge.metric in {"logged_nutrition_days", "protein_goal_days"}:
        snapshots = db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id, MonthlyChallengeCheckin.date >= cycle.month_start, MonthlyChallengeCheckin.date < end).all()
        if challenge.metric == "protein_goal_days":
            protein_goal = float((challenge.rules or {}).get("protein_goal_g") or 0)
            current = float(sum(float((item.metrics_snapshot or {}).get("nutrition", {}).get("protein_g") or 0) >= protein_goal > 0 for item in snapshots))
        else:
            current = float(sum(bool((item.metrics_snapshot or {}).get("nutrition", {}).get("logged")) for item in snapshots))
    elif challenge.metric == "nutrition_connection":
        current = 1.0 if user.yazio_email and user.yazio_password else 0.0
    percent = 0.0 if target <= 0 else min(100.0, current / target * 100)
    return _finalize_progress(challenge, current, percent)


def _finalize_progress(challenge: MonthlyChallenge, current: float, percent: float) -> dict[str, Any]:
    if challenge.status == "active" and percent >= 100:
        challenge.status, challenge.completed_at = "completed", datetime.now(timezone.utc)
        challenge.completion_stats = {"current_value": current, "target_value": challenge.target_value, "progress_percent": 100.0}
    if challenge.status == "completed":
        percent = 100.0
    return {"id": str(challenge.id), "slot": challenge.slot, "category": challenge.category, "metric": challenge.metric, "title": challenge.title, "description": challenge.description, "icon": challenge.icon, "unit": challenge.unit, "baseline_value": challenge.baseline_value, "current_value": round(current, 2), "target_value": challenge.target_value, "progress_percent": round(percent, 1), "status": challenge.status, "completed_at": challenge.completed_at.isoformat() if challenge.completed_at else None, "completion_stats": challenge.completion_stats}


def serialize_cycle(db: Session, user: User, cycle: MonthlyChallengeCycle) -> dict[str, Any]:
    challenges = [_challenge_progress(db, user, cycle, challenge) for challenge in sorted(cycle.challenges, key=lambda item: item.slot)]
    cycle.total_challenges = len(challenges)
    cycle.completed_challenges = sum(item["status"] == "completed" for item in challenges)
    cycle.completion_percent = round((cycle.completed_challenges / cycle.total_challenges * 100) if cycle.total_challenges else 0.0, 1)
    today_checkin = db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id, MonthlyChallengeCheckin.date == date.today()).first()
    latest_checkin = today_checkin or db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id).order_by(MonthlyChallengeCheckin.date.desc()).first()
    return {"id": cycle.id, "month_start": cycle.month_start, "total_challenges": cycle.total_challenges, "completed_challenges": cycle.completed_challenges, "completion_percent": cycle.completion_percent, "challenges": challenges, "today_checkin": today_checkin.checkin_data if today_checkin else None, "today_checkin_date": today_checkin.date if today_checkin else None, "latest_checkin": latest_checkin.checkin_data if latest_checkin else None, "latest_checkin_date": latest_checkin.date if latest_checkin else None}


async def _nutrition_snapshot(user: User, db: Session, today: date) -> dict[str, Any]:
    snapshot: dict[str, Any] = {"available": False, "logged": False}
    if not user.yazio_email or not user.yazio_password:
        return snapshot
    try:
        data = await fetch_yazio_summary(decrypt_value(user.yazio_email), decrypt_value(user.yazio_password), target_date=today)
        totals, goals = (data or {}).get("totals") or {}, (data or {}).get("goals") or {}
        protein, calories = float(totals.get("protein") or 0), float(totals.get("calories") or 0)
        snapshot = {"available": bool(data), "logged": calories > 0 or protein > 0, "calories": calories, "protein_g": protein, "protein_goal_g": float(goals.get("protein") or 0)}
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
    existing = db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id, MonthlyChallengeCheckin.date == checkin_date).first()
    if existing:
        return existing
    nutrition = await _nutrition_snapshot(user, db, checkin_date)
    checkin = MonthlyChallengeCheckin(cycle_id=cycle.id, user_id=user.id, date=checkin_date, metrics_snapshot={"nutrition": nutrition}, progress_snapshot={}, checkin_data={})
    db.add(checkin)
    db.flush()
    live = serialize_cycle(db, user, cycle)
    yazio_goal = (await _goal_context(user))["goal"]
    checkin.progress_snapshot = {"completed_challenges": live["completed_challenges"], "completion_percent": live["completion_percent"], "challenges": live["challenges"]}
    checkin.checkin_data = await generate_monthly_challenge_checkin(challenges=live["challenges"], yazio_goal=yazio_goal, nutrition=nutrition, language=user.language or "de")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(MonthlyChallengeCheckin).filter(MonthlyChallengeCheckin.cycle_id == cycle.id, MonthlyChallengeCheckin.date == checkin_date).first()
        if existing:
            return existing
        raise
    db.refresh(checkin)
    return checkin
