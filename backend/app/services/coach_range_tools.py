"""Range-aware read tools (workouts, exercise history, nutrition) with bounded output.

The caller picks the window (``start_date`` / ``end_date`` or ``days``). The size of the
response never depends on the window length alone: long windows are aggregated, lists are
paged, and the final payload is trimmed to a character budget.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.encryption import decrypt_value
from app.models import ForgeWorkoutSession, User
from app.services.forge_session_adapter import completed_forge_workouts, local_day_bounds
from app.services.range_tools import (
    bucket_bounds,
    bucket_key,
    choose_granularity,
    enforce_budget,
    mean,
    range_info,
    resolve_range,
)
from app.services.yazio_service import fetch_nutrition_range

WORKOUT_MAX_DAYS = 730
NUTRITION_MAX_DAYS = 180
FULL_DETAIL_MAX_WORKOUTS = 15
SUMMARY_DETAIL_MAX_WORKOUTS = 60
EXERCISE_HISTORY_MAX_SESSIONS = 60


def _bounded(value: object, default: int, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(minimum, min(maximum, int(value)))


def _is_working(set_data: dict) -> bool:
    return set_data.get("type") != "warmup"


def _epley(weight: float | None, reps: int | None) -> float | None:
    if not isinstance(weight, (int, float)) or not isinstance(reps, int) or weight <= 0 or reps <= 0:
        return None
    return weight if reps == 1 else weight * (1 + reps / 30)


def _workout_digest(workout: dict) -> dict:
    """One compact line per exercise: set count, top set, tonnage. No individual sets."""
    exercises = []
    for exercise in workout.get("exercises", [])[:30]:
        working = [item for item in exercise.get("sets", []) if _is_working(item)]
        loaded = [item for item in working if isinstance(item.get("weight_kg"), (int, float)) and isinstance(item.get("reps"), int)]
        top = max(loaded, key=lambda item: (item["weight_kg"], item["reps"]), default=None)
        entry: dict[str, Any] = {
            "name": exercise.get("title"),
            "muscle_group": exercise.get("muscle_group"),
            "working_sets": len(working),
            "volume_kg": round(sum(item["weight_kg"] * item["reps"] for item in loaded), 1),
        }
        if top is not None:
            entry["top_set"] = {"weight_kg": top["weight_kg"], "reps": top["reps"]}
        note = (exercise.get("session_note") or "").strip()
        if note:
            entry["session_note"] = note[:200]
        exercises.append(entry)
    return {
        "id": workout.get("id"),
        "date": workout.get("local_date") or str(workout.get("start_time", ""))[:10],
        "title": workout.get("title"),
        "duration_min": workout.get("duration_min"),
        "exercises": exercises,
    }


def workouts_in_range(
    db: Session,
    user: User,
    args: dict,
    full_formatter: Callable[[dict], dict],
) -> dict[str, Any]:
    window = resolve_range(args, default_days=365, max_days=WORKOUT_MAX_DAYS)
    notes = list(window["notes"])
    detail = args.get("detail") if args.get("detail") in ("auto", "summary", "full") else "auto"
    limit = _bounded(args.get("limit"), 20, 1, SUMMARY_DETAIL_MAX_WORKOUTS)
    offset = _bounded(args.get("offset"), 0, 0, 100_000)

    if detail == "full" and limit > FULL_DETAIL_MAX_WORKOUTS:
        limit = FULL_DETAIL_MAX_WORKOUTS
        notes.append(f"detail 'full' returns at most {FULL_DETAIL_MAX_WORKOUTS} workouts per call; use offset to page or detail 'summary' for more.")

    lower = local_day_bounds(window["start"], window["start"])[0]
    upper = local_day_bounds(window["end"], window["end"])[1]
    total = db.query(func.count(ForgeWorkoutSession.id)).filter(
        ForgeWorkoutSession.user_id == user.id,
        ForgeWorkoutSession.status == "completed",
        ForgeWorkoutSession.started_at >= lower,
        ForgeWorkoutSession.started_at < upper,
    ).scalar() or 0

    workouts = completed_forge_workouts(
        db, user.id, limit=limit, since=window["start"], until=window["end"], offset=offset,
    )
    if detail == "auto":
        detail = "full" if len(workouts) <= 10 else "summary"
    if detail == "full" and len(workouts) > FULL_DETAIL_MAX_WORKOUTS:
        workouts = workouts[:FULL_DETAIL_MAX_WORKOUTS]

    items = [full_formatter(item) | {"date": item.get("local_date")} if detail == "full" else _workout_digest(item) for item in workouts]
    returned_end = offset + len(items)
    payload: dict[str, Any] = {
        "range": range_info(window),
        "detail": detail,
        "total_matching": total,
        "returned": len(items),
        "offset": offset,
        "has_more": returned_end < total,
        "workouts": items,
    }
    if returned_end < total:
        payload["next_offset"] = returned_end
    if notes:
        payload["notes"] = notes
    return enforce_budget(payload, ["workouts"])


def exercise_history_in_range(db: Session, user: User, args: dict) -> dict[str, Any]:
    window = resolve_range(args, default_days=365, max_days=WORKOUT_MAX_DAYS)
    limit = _bounded(args.get("limit"), 20, 1, EXERCISE_HISTORY_MAX_SESSIONS)
    name = str(args.get("exercise_name", "")).strip()
    wanted = name.casefold()

    workouts = completed_forge_workouts(db, user.id, since=window["start"], until=window["end"])
    sessions: list[dict[str, Any]] = []
    for workout in workouts:
        for exercise in workout.get("exercises", []):
            if str(exercise.get("title", "")).strip().casefold() != wanted:
                continue
            sets = exercise.get("sets", [])
            best = max(
                (_epley(item.get("weight_kg"), item.get("reps")) for item in sets if _is_working(item)),
                default=None,
                key=lambda value: value or 0,
            )
            sessions.append({
                "date": workout.get("local_date"),
                "workout_title": workout.get("title"),
                "machine_profile": exercise.get("machine_profile") or "",
                "notes": (exercise.get("notes") or "")[:300],
                "session_note": (exercise.get("session_note") or "")[:1000],
                "best_e1rm_kg": round(best, 1) if best else None,
                "sets": [
                    {key: item.get(key) for key in ("type", "weight_kg", "reps", "note") if item.get(key) not in (None, "")}
                    for item in sets[:20]
                ],
            })

    total = len(sessions)
    e1rms = [item["best_e1rm_kg"] for item in sessions if item["best_e1rm_kg"]]
    summary: dict[str, Any] = {"sessions": total}
    if sessions:
        chronological = sorted(sessions, key=lambda item: item["date"] or "")
        summary.update({
            "first_date": chronological[0]["date"],
            "last_date": chronological[-1]["date"],
            "best_e1rm_kg": max(e1rms) if e1rms else None,
            "latest_e1rm_kg": next((s["best_e1rm_kg"] for s in reversed(chronological) if s["best_e1rm_kg"]), None),
        })
    payload: dict[str, Any] = {
        "exercise_name": name,
        "range": range_info(window),
        "summary": summary,
        "returned": min(total, limit),
        "has_more": total > limit,
        "sessions": sessions[:limit],
    }
    if total > limit:
        payload["notes"] = [f"Only the {limit} most recent sessions are listed; raise limit (max {EXERCISE_HISTORY_MAX_SESSIONS}) or narrow the date range."]
    return enforce_budget(payload, ["sessions"])


async def nutrition_in_range(user: User, args: dict) -> dict[str, Any]:
    if not user.yazio_email or not user.yazio_password:
        return {"available": False, "reason": "Yazio ist nicht verbunden."}
    try:
        email, password = decrypt_value(user.yazio_email), decrypt_value(user.yazio_password)
    except Exception:
        return {"available": False, "reason": "Yazio ist nicht verbunden."}

    window = resolve_range(args, default_days=7, max_days=NUTRITION_MAX_DAYS)
    granularity, granularity_note = choose_granularity(args.get("granularity"), window["days"])
    notes = list(window["notes"])
    if granularity_note:
        notes.append(granularity_note)

    fetched = await fetch_nutrition_range(email, password, window["start"], window["end"])
    if fetched is None:
        return {"available": False, "reason": "Yazio-Daten konnten nicht geladen werden."}

    days = fetched["days"]
    logged = [item for item in days if item["logged"]]

    def averages(rows: list[dict]) -> dict[str, Any]:
        calories = mean(r["calories"] for r in rows)
        protein = mean(r["protein"] for r in rows)
        goal_cal = mean(r["goals"]["calories"] for r in rows if r["goals"]["calories"] > 0)
        goal_prot = mean(r["goals"]["protein"] for r in rows if r["goals"]["protein"] > 0)
        result: dict[str, Any] = {
            "logged_days": len(rows),
            "avg_calories": calories,
            "avg_protein_g": protein,
            "avg_carbs_g": mean(r["carbs"] for r in rows),
            "avg_fat_g": mean(r["fat"] for r in rows),
            "avg_calorie_goal": goal_cal,
            "avg_protein_goal_g": goal_prot,
        }
        if calories is not None and goal_cal:
            result["avg_calorie_goal_attainment_pct"] = round(calories / goal_cal * 100, 1)
        if protein is not None and goal_prot:
            result["avg_protein_goal_attainment_pct"] = round(protein / goal_prot * 100, 1)
        return result

    payload: dict[str, Any] = {
        "available": True,
        "range": range_info(window),
        "granularity": granularity,
        "summary": {"days_in_range": window["days"], **averages(logged)},
    }
    if fetched["failed_days"]:
        payload["failed_days"] = fetched["failed_days"]
        notes.append(f"{fetched['failed_days']} day(s) could not be loaded from Yazio and are missing.")

    if granularity == "day":
        payload["days"] = [
            {
                "date": item["date"],
                "logged": item["logged"],
                "totals": {k: item[k] for k in ("calories", "protein", "carbs", "fat")},
                "goals": item["goals"],
            }
            for item in days
        ]
        list_keys = ["days"]
    else:
        buckets: dict[str, list[dict]] = {}
        for item in days:
            buckets.setdefault(bucket_key(date.fromisoformat(item["date"]), granularity), []).append(item)
        periods = []
        for key in sorted(buckets):
            first, last = bucket_bounds(key, granularity, window["start"], window["end"])
            rows = buckets[key]
            logged_rows = [r for r in rows if r["logged"]]
            periods.append({
                "period_start": first.isoformat(),
                "period_end": last.isoformat(),
                "days": (last - first).days + 1,
                **averages(logged_rows),
            })
        payload["periods"] = periods
        list_keys = ["periods"]

    if notes:
        payload["notes"] = notes
    return enforce_budget(payload, list_keys)
