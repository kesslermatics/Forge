"""
Analytics service — computes progressive overload and the consistency timeline.

All computation happens on Forge data (no AI calls).
"""
import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════
#  MACRO-PERFORMANCE CORRELATION
# ════════════════════════════════════════════════════════

def _extract_workout_date(workout: dict) -> Optional[str]:
    """Extract YYYY-MM-DD from a workout's start_time."""
    st = workout.get("start_time", "")
    return st[:10] if st and len(st) >= 10 else None






# ════════════════════════════════════════════════════════
#  PROGRESSIVE OVERLOAD — per exercise history
# ════════════════════════════════════════════════════════

def compute_progressive_overload(workouts: list[dict]) -> list[dict]:
    """
    Build per-exercise progression data across all workouts.
    Returns: [{name, muscle_group, data_points: [{date, best_set, e1rm, volume, sets, reps}]}]
    """
    exercise_history = defaultdict(list)

    for w in workouts:
        workout_date = _extract_workout_date(w) or ""
        for ex in w.get("exercises", []):
            name = ex.get("title", "Unknown")
            muscle = ex.get("muscle_group", "")
            sets = ex.get("sets", [])

            best_e1rm = 0.0
            best_set_str = ""
            total_volume = 0.0
            total_sets = 0
            total_reps = 0

            for s in sets:
                weight = s.get("weight_kg") or 0
                reps = s.get("reps") or 0
                if weight > 0 and reps > 0:
                    total_volume += weight * reps
                    total_sets += 1
                    total_reps += reps
                    e1rm = weight * (1 + reps / 30.0)
                    if e1rm > best_e1rm:
                        best_e1rm = e1rm
                        best_set_str = f"{weight}kg × {reps}"

            if best_e1rm > 0:
                exercise_history[name].append({
                    "date": workout_date,
                    "best_set": best_set_str,
                    "e1rm": round(best_e1rm, 1),
                    "volume": round(total_volume, 1),
                    "sets": total_sets,
                    "reps": total_reps,
                    "muscle_group": muscle,
                })

    result = []
    for name, data_points in exercise_history.items():
        # Sort by date ascending
        data_points.sort(key=lambda d: d["date"])
        muscle = data_points[0].get("muscle_group", "") if data_points else ""

        # Compute trend
        if len(data_points) >= 2:
            first_e1rm = data_points[0]["e1rm"]
            last_e1rm = data_points[-1]["e1rm"]
            change_pct = round(((last_e1rm - first_e1rm) / first_e1rm) * 100, 1) if first_e1rm > 0 else 0
        else:
            change_pct = 0

        result.append({
            "name": name,
            "muscle_group": muscle,
            "data_points": data_points,
            "sessions_count": len(data_points),
            "first_e1rm": data_points[0]["e1rm"] if data_points else 0,
            "latest_e1rm": data_points[-1]["e1rm"] if data_points else 0,
            "peak_e1rm": max(d["e1rm"] for d in data_points) if data_points else 0,
            "change_percent": change_pct,
        })

    # Sort by number of sessions (most trained first)
    result.sort(key=lambda x: x["sessions_count"], reverse=True)
    return result


# ════════════════════════════════════════════════════════
#  WEEKLY STREAKS
# ════════════════════════════════════════════════════════



# ════════════════════════════════════════════════════════
#  WEEKLY / MONTHLY REPORTS
# ════════════════════════════════════════════════════════





# ════════════════════════════════════════════════════════
#  ACHIEVEMENTS / BADGES
# ════════════════════════════════════════════════════════



def compute_consistency_timeline(
    workout_dates: list[str],
    nutrition_dates: list[str],
    *,
    today: date | None = None,
    timeline_days: int = 14,
    weekly_training_goal: int = 2,
) -> dict:
    """Build dashboard consistency data from completed-workout and tracked-nutrition dates.

    Nutrition is a consecutive daily streak. Training is a consecutive weekly streak
    with at least ``weekly_training_goal`` completed sessions per calendar week.
    An unfinished current week retains the prior qualifying streak until Sunday.
    """
    today = today or date.today()

    def _parse_dates(values: list[str]) -> set[date]:
        parsed: set[date] = set()
        for value in values:
            try:
                parsed.add(date.fromisoformat(value[:10]))
            except (TypeError, ValueError):
                continue
        return parsed

    workout_days = _parse_dates(workout_dates)
    nutrition_days = _parse_dates(nutrition_dates)
    first_day = today - timedelta(days=timeline_days - 1)
    timeline = [
        {
            "date": (first_day + timedelta(days=offset)).isoformat(),
            "training": first_day + timedelta(days=offset) in workout_days,
            "nutrition": first_day + timedelta(days=offset) in nutrition_days,
        }
        for offset in range(timeline_days)
    ]

    nutrition_streak = 0
    cursor = today
    while cursor in nutrition_days:
        nutrition_streak += 1
        cursor -= timedelta(days=1)

    current_monday = today - timedelta(days=today.weekday())

    def _sessions_in_week(monday: date) -> int:
        return sum(monday <= day < monday + timedelta(days=7) for day in workout_days)

    current_week_sessions = _sessions_in_week(current_monday)
    training_streak = 0
    # Do not reset a successful previous-week streak merely because the current
    # week is still in progress. On Sunday, an unmet weekly goal ends the streak.
    if current_week_sessions >= weekly_training_goal:
        cursor = current_monday
    elif today.weekday() == 6:
        cursor = None
    else:
        cursor = current_monday - timedelta(weeks=1)
    while cursor is not None and _sessions_in_week(cursor) >= weekly_training_goal:
        training_streak += 1
        cursor -= timedelta(weeks=1)

    return {
        "days": timeline,
        "nutrition_streak_days": nutrition_streak,
        "training_streak_weeks": training_streak,
        "training_sessions_this_week": current_week_sessions,
        "training_weekly_goal": weekly_training_goal,
    }
