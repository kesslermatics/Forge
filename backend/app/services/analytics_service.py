"""
Analytics service — computes macro-performance correlations, streaks,
weekly/monthly reports, achievements, and progressive overload data.

All computation happens on raw Hevy + Yazio data (no AI calls).
"""
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════
#  MACRO-PERFORMANCE CORRELATION
# ════════════════════════════════════════════════════════

def _extract_workout_date(workout: dict) -> Optional[str]:
    """Extract YYYY-MM-DD from a workout's start_time."""
    st = workout.get("start_time", "")
    return st[:10] if st and len(st) >= 10 else None


def _compute_workout_metrics(workout: dict) -> dict:
    """Compute total volume and best e1RM per workout."""
    total_volume = 0.0
    best_e1rm = 0.0
    exercise_count = 0

    for ex in workout.get("exercises", []):
        exercise_count += 1
        for s in ex.get("sets", []):
            w = s.get("weight_kg") or 0
            r = s.get("reps") or 0
            if w > 0 and r > 0:
                total_volume += w * r
                e1rm = w * (1 + r / 30.0)
                if e1rm > best_e1rm:
                    best_e1rm = e1rm

    return {
        "title": workout.get("title", "Workout"),
        "date": _extract_workout_date(workout),
        "total_volume_kg": round(total_volume, 1),
        "best_e1rm": round(best_e1rm, 1),
        "exercise_count": exercise_count,
        "duration_min": workout.get("duration_min"),
    }


def compute_macro_performance_correlation(
    workouts: list[dict],
    nutrition_by_date: dict,
) -> dict:
    """
    Correlate nutrition data from the day before each workout with performance.

    nutrition_by_date: {date_str: {calories, protein, carbs, fat, goals: {...}}}
    Returns correlation insights.
    """
    data_points = []

    for w in workouts:
        metrics = _compute_workout_metrics(w)
        workout_date = metrics["date"]
        if not workout_date:
            continue

        # Get previous day's nutrition
        try:
            wd = datetime.strptime(workout_date, "%Y-%m-%d").date()
            prev_day = (wd - timedelta(days=1)).isoformat()
        except Exception:
            continue

        nutrition = nutrition_by_date.get(prev_day)
        if not nutrition:
            continue

        data_points.append({
            "workout_date": workout_date,
            "workout_title": metrics["title"],
            "volume": metrics["total_volume_kg"],
            "best_e1rm": metrics["best_e1rm"],
            "duration_min": metrics["duration_min"],
            "prev_day_calories": nutrition.get("calories", 0),
            "prev_day_protein": nutrition.get("protein", 0),
            "prev_day_carbs": nutrition.get("carbs", 0),
            "prev_day_fat": nutrition.get("fat", 0),
            "calorie_goal": nutrition.get("goals", {}).get("calories", 0),
            "protein_goal": nutrition.get("goals", {}).get("protein", 0),
        })

    if len(data_points) < 2:
        return {
            "data_points": data_points,
            "insights": [],
            "has_enough_data": False,
            "total_correlated_workouts": len(data_points),
        }

    # Compute insights
    insights = []

    # Average volume & e1rm split by high/low carbs
    avg_carbs = sum(d["prev_day_carbs"] for d in data_points) / len(data_points)
    high_carb_sessions = [d for d in data_points if d["prev_day_carbs"] > avg_carbs]
    low_carb_sessions = [d for d in data_points if d["prev_day_carbs"] <= avg_carbs]

    if high_carb_sessions and low_carb_sessions:
        avg_vol_high = sum(d["volume"] for d in high_carb_sessions) / len(high_carb_sessions)
        avg_vol_low = sum(d["volume"] for d in low_carb_sessions) / len(low_carb_sessions)
        if avg_vol_low > 0:
            vol_diff_pct = round(((avg_vol_high - avg_vol_low) / avg_vol_low) * 100, 1)
            insights.append({
                "type": "carb_volume",
                "message_de": f"Bei >{ round(avg_carbs) }g Carbs am Vortag hebst du im Schnitt {abs(vol_diff_pct)}% {'mehr' if vol_diff_pct > 0 else 'weniger'} Volumen.",
                "message_en": f"With >{round(avg_carbs)}g carbs the day before, your volume is {abs(vol_diff_pct)}% {'higher' if vol_diff_pct > 0 else 'lower'} on average.",
                "diff_percent": vol_diff_pct,
                "threshold": round(avg_carbs),
            })

        avg_e1rm_high = sum(d["best_e1rm"] for d in high_carb_sessions) / len(high_carb_sessions)
        avg_e1rm_low = sum(d["best_e1rm"] for d in low_carb_sessions) / len(low_carb_sessions)
        if avg_e1rm_low > 0:
            e1rm_diff_pct = round(((avg_e1rm_high - avg_e1rm_low) / avg_e1rm_low) * 100, 1)
            insights.append({
                "type": "carb_strength",
                "message_de": f"Deine Maximalkraft ist im Schnitt {abs(e1rm_diff_pct)}% {'höher' if e1rm_diff_pct > 0 else 'niedriger'} nach carb-reichen Tagen (>{round(avg_carbs)}g).",
                "message_en": f"Your max strength is {abs(e1rm_diff_pct)}% {'higher' if e1rm_diff_pct > 0 else 'lower'} after high-carb days (>{round(avg_carbs)}g).",
                "diff_percent": e1rm_diff_pct,
            })

    # Protein impact
    avg_protein = sum(d["prev_day_protein"] for d in data_points) / len(data_points)
    high_protein = [d for d in data_points if d["prev_day_protein"] > avg_protein]
    low_protein = [d for d in data_points if d["prev_day_protein"] <= avg_protein]

    if high_protein and low_protein:
        avg_vol_hp = sum(d["volume"] for d in high_protein) / len(high_protein)
        avg_vol_lp = sum(d["volume"] for d in low_protein) / len(low_protein)
        if avg_vol_lp > 0:
            prot_diff = round(((avg_vol_hp - avg_vol_lp) / avg_vol_lp) * 100, 1)
            insights.append({
                "type": "protein_volume",
                "message_de": f"Bei >{round(avg_protein)}g Protein am Vortag ist dein Volumen {abs(prot_diff)}% {'höher' if prot_diff > 0 else 'niedriger'}.",
                "message_en": f"With >{round(avg_protein)}g protein the day before, your volume is {abs(prot_diff)}% {'higher' if prot_diff > 0 else 'lower'}.",
                "diff_percent": prot_diff,
                "threshold": round(avg_protein),
            })

    # Calorie surplus/deficit impact
    surplus_sessions = [d for d in data_points if d["prev_day_calories"] >= d["calorie_goal"] * 0.95]
    deficit_sessions = [d for d in data_points if d["prev_day_calories"] < d["calorie_goal"] * 0.95]

    if surplus_sessions and deficit_sessions:
        avg_vol_surplus = sum(d["volume"] for d in surplus_sessions) / len(surplus_sessions)
        avg_vol_deficit = sum(d["volume"] for d in deficit_sessions) / len(deficit_sessions)
        if avg_vol_deficit > 0:
            cal_diff = round(((avg_vol_surplus - avg_vol_deficit) / avg_vol_deficit) * 100, 1)
            insights.append({
                "type": "calorie_target",
                "message_de": f"Wenn du dein Kalorienziel erreichst, ist dein Trainingsvolumen {abs(cal_diff)}% {'höher' if cal_diff > 0 else 'niedriger'}.",
                "message_en": f"When you hit your calorie target, your training volume is {abs(cal_diff)}% {'higher' if cal_diff > 0 else 'lower'}.",
                "diff_percent": cal_diff,
            })

    return {
        "data_points": data_points,
        "insights": insights,
        "has_enough_data": len(data_points) >= 3,
        "total_correlated_workouts": len(data_points),
    }


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

def compute_weekly_streaks(
    workout_dates: list[str],
    nutrition_dates: list[str],
) -> dict:
    """
    Compute weekly streaks for both training and nutrition.
    A week counts as 'active' if there is at least 1 workout or tracked day in that week.
    Weeks are ISO weeks (Mon-Sun).
    """
    def _dates_to_iso_weeks(dates: list[str]) -> set:
        weeks = set()
        for d in dates:
            try:
                dt = datetime.strptime(d, "%Y-%m-%d").date()
                iso_year, iso_week, _ = dt.isocalendar()
                weeks.add((iso_year, iso_week))
            except Exception:
                continue
        return weeks

    workout_weeks = _dates_to_iso_weeks(workout_dates)
    nutrition_weeks = _dates_to_iso_weeks(nutrition_dates)

    def _compute_streak(active_weeks: set) -> dict:
        if not active_weeks:
            return {"current_streak": 0, "longest_streak": 0, "total_active_weeks": 0}

        today = date.today()
        current_iso = today.isocalendar()
        current_week = (current_iso[0], current_iso[1])

        # Sort weeks ascending
        sorted_weeks = sorted(active_weeks)

        # Current streak (counting backwards from this week)
        current_streak = 0
        check_year, check_week = current_week
        while True:
            if (check_year, check_week) in active_weeks:
                current_streak += 1
                # Go to previous week
                check_date = datetime.strptime(f"{check_year}-W{check_week:02d}-1", "%G-W%V-%u").date()
                prev_date = check_date - timedelta(weeks=1)
                prev_iso = prev_date.isocalendar()
                check_year, check_week = prev_iso[0], prev_iso[1]
            else:
                break

        # Longest streak
        longest = 0
        streak = 0
        for i, (y, w) in enumerate(sorted_weeks):
            if i == 0:
                streak = 1
            else:
                prev_y, prev_w = sorted_weeks[i - 1]
                # Check if this is the next ISO week
                prev_date = datetime.strptime(f"{prev_y}-W{prev_w:02d}-1", "%G-W%V-%u").date()
                next_date = prev_date + timedelta(weeks=1)
                next_iso = next_date.isocalendar()
                if (y, w) == (next_iso[0], next_iso[1]):
                    streak += 1
                else:
                    streak = 1
            longest = max(longest, streak)

        return {
            "current_streak": current_streak,
            "longest_streak": longest,
            "total_active_weeks": len(active_weeks),
        }

    # Combined streak (either training OR nutrition in a week)
    combined_weeks = workout_weeks | nutrition_weeks

    return {
        "training": _compute_streak(workout_weeks),
        "nutrition": _compute_streak(nutrition_weeks),
        "combined": _compute_streak(combined_weeks),
    }


# ════════════════════════════════════════════════════════
#  WEEKLY / MONTHLY REPORTS
# ════════════════════════════════════════════════════════

def compute_weekly_report(
    workouts: list[dict],
    nutrition_by_date: dict,
    weight_entries: list[dict],
    week_offset: int = 0,
) -> dict:
    """
    Compute a report for a given week (0 = current week, 1 = last week, etc.)
    """
    today = date.today()
    # Get the Monday of the target week
    current_monday = today - timedelta(days=today.weekday())
    target_monday = current_monday - timedelta(weeks=week_offset)
    target_sunday = target_monday + timedelta(days=6)

    date_range = [target_monday + timedelta(days=i) for i in range(7)]
    date_strs = [d.isoformat() for d in date_range]

    # Filter workouts in this week
    week_workouts = []
    for w in workouts:
        wd = _extract_workout_date(w)
        if wd and target_monday.isoformat() <= wd <= target_sunday.isoformat():
            week_workouts.append(w)

    # Total volume for the week
    total_volume = 0.0
    total_sets = 0
    total_duration = 0
    muscle_groups_trained = defaultdict(int)

    for w in week_workouts:
        if w.get("duration_min"):
            total_duration += w["duration_min"]
        for ex in w.get("exercises", []):
            mg = ex.get("muscle_group", "other")
            for s in ex.get("sets", []):
                weight = s.get("weight_kg") or 0
                reps = s.get("reps") or 0
                if weight > 0 and reps > 0:
                    total_volume += weight * reps
                    total_sets += 1
                    muscle_groups_trained[mg] += 1

    # Nutrition averages for the week
    week_nutrition = [nutrition_by_date[d] for d in date_strs if d in nutrition_by_date]
    avg_calories = round(sum(n.get("calories", 0) for n in week_nutrition) / max(1, len(week_nutrition)), 1) if week_nutrition else 0
    avg_protein = round(sum(n.get("protein", 0) for n in week_nutrition) / max(1, len(week_nutrition)), 1) if week_nutrition else 0
    avg_carbs = round(sum(n.get("carbs", 0) for n in week_nutrition) / max(1, len(week_nutrition)), 1) if week_nutrition else 0
    avg_fat = round(sum(n.get("fat", 0) for n in week_nutrition) / max(1, len(week_nutrition)), 1) if week_nutrition else 0
    days_tracked = len(week_nutrition)

    # Weight for the week
    week_weights = [we for we in weight_entries if target_monday.isoformat() <= we["date"] <= target_sunday.isoformat()]
    start_weight = week_weights[0]["weight_kg"] if week_weights else None
    end_weight = week_weights[-1]["weight_kg"] if week_weights else None
    weight_change = round(end_weight - start_weight, 2) if start_weight and end_weight else None

    return {
        "week_start": target_monday.isoformat(),
        "week_end": target_sunday.isoformat(),
        "week_offset": week_offset,
        "training": {
            "workouts_count": len(week_workouts),
            "total_volume_kg": round(total_volume, 1),
            "total_sets": total_sets,
            "total_duration_min": total_duration,
            "muscle_groups": dict(muscle_groups_trained),
            "workout_names": [w.get("title", "Workout") for w in week_workouts],
        },
        "nutrition": {
            "days_tracked": days_tracked,
            "avg_calories": avg_calories,
            "avg_protein": avg_protein,
            "avg_carbs": avg_carbs,
            "avg_fat": avg_fat,
            "calorie_goal": week_nutrition[0].get("goals", {}).get("calories", 0) if week_nutrition else 0,
            "protein_goal": week_nutrition[0].get("goals", {}).get("protein", 0) if week_nutrition else 0,
        },
        "weight": {
            "start": start_weight,
            "end": end_weight,
            "change": weight_change,
        },
    }


def compute_monthly_report(
    workouts: list[dict],
    nutrition_by_date: dict,
    weight_entries: list[dict],
    month_offset: int = 0,
) -> dict:
    """
    Compute a report for a given month (0 = current month, 1 = last month, etc.)
    """
    today = date.today()
    # Get target month start
    target_month = today.month - month_offset
    target_year = today.year
    while target_month <= 0:
        target_month += 12
        target_year -= 1

    month_start = date(target_year, target_month, 1)
    if target_month == 12:
        month_end = date(target_year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(target_year, target_month + 1, 1) - timedelta(days=1)

    # Filter workouts in this month
    month_workouts = []
    total_volume = 0.0
    total_sets = 0
    total_duration = 0
    muscle_groups_trained = defaultdict(int)
    best_e1rms = {}

    for w in workouts:
        wd = _extract_workout_date(w)
        if wd and month_start.isoformat() <= wd <= month_end.isoformat():
            month_workouts.append(w)
            if w.get("duration_min"):
                total_duration += w["duration_min"]
            for ex in w.get("exercises", []):
                name = ex.get("title", "Unknown")
                mg = ex.get("muscle_group", "other")
                for s in ex.get("sets", []):
                    weight = s.get("weight_kg") or 0
                    reps = s.get("reps") or 0
                    if weight > 0 and reps > 0:
                        total_volume += weight * reps
                        total_sets += 1
                        muscle_groups_trained[mg] += 1
                        e1rm = weight * (1 + reps / 30.0)
                        if name not in best_e1rms or e1rm > best_e1rms[name]:
                            best_e1rms[name] = round(e1rm, 1)

    # Nutrition
    month_dates = [(month_start + timedelta(days=i)).isoformat()
                   for i in range((month_end - month_start).days + 1)]
    month_nutrition = [nutrition_by_date[d] for d in month_dates if d in nutrition_by_date]
    days_tracked = len(month_nutrition)
    avg_calories = round(sum(n.get("calories", 0) for n in month_nutrition) / max(1, days_tracked)) if month_nutrition else 0
    avg_protein = round(sum(n.get("protein", 0) for n in month_nutrition) / max(1, days_tracked)) if month_nutrition else 0

    # Weight
    month_weights = [we for we in weight_entries if month_start.isoformat() <= we["date"] <= month_end.isoformat()]
    start_weight = month_weights[0]["weight_kg"] if month_weights else None
    end_weight = month_weights[-1]["weight_kg"] if month_weights else None

    return {
        "month": f"{target_year}-{target_month:02d}",
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "month_offset": month_offset,
        "training": {
            "workouts_count": len(month_workouts),
            "total_volume_kg": round(total_volume, 1),
            "total_sets": total_sets,
            "total_duration_min": total_duration,
            "muscle_groups": dict(muscle_groups_trained),
            "best_e1rms": best_e1rms,
        },
        "nutrition": {
            "days_tracked": days_tracked,
            "avg_calories": avg_calories,
            "avg_protein": avg_protein,
        },
        "weight": {
            "start": start_weight,
            "end": end_weight,
            "change": round(end_weight - start_weight, 2) if start_weight and end_weight else None,
        },
    }


# ════════════════════════════════════════════════════════
#  ACHIEVEMENTS / BADGES
# ════════════════════════════════════════════════════════

def compute_achievements(
    workouts: list[dict],
    nutrition_dates: list[str],
    workout_dates: list[str],
    weight_entries: list[dict],
    nutrition_by_date: dict,
) -> list[dict]:
    """
    Personalised achievements for Robert (172cm / 67kg).
    Strength targets are relative to bodyweight — realistic and motivating.
    """

    achievements = []
    BW = 67.0  # bodyweight in kg

    # ── Pre-computation pass ──
    all_exercises: dict = defaultdict(list)
    total_workouts = len(workouts)
    total_volume_all_time = 0.0

    for w in workouts:
        wd = _extract_workout_date(w) or ""
        for ex in w.get("exercises", []):
            name = ex.get("title", "Unknown")
            for s in ex.get("sets", []):
                weight = s.get("weight_kg") or 0
                reps = s.get("reps") or 0
                if weight > 0 and reps > 0:
                    total_volume_all_time += weight * reps
                    e1rm = weight * (1 + reps / 30.0)
                    all_exercises[name].append({"date": wd, "e1rm": e1rm, "weight": weight, "reps": reps})

    total_nutrition_days = len(nutrition_dates)
    unique_exercises = len(all_exercises)

    def _max_weight(keyword: str) -> float:
        best = 0.0
        for ename, data_list in all_exercises.items():
            if keyword.lower() in ename.lower():
                for d in data_list:
                    if d["weight"] > best:
                        best = d["weight"]
        return best

    def _max_e1rm(keyword: str) -> float:
        best = 0.0
        for ename, data_list in all_exercises.items():
            if keyword.lower() in ename.lower():
                for d in data_list:
                    if d["e1rm"] > best:
                        best = d["e1rm"]
        return best

    def badge(aid, name_de, name_en, desc_de, desc_en, icon, category, unlocked, progress, target):
        achievements.append({
            "id": aid,
            "name_de": name_de, "name_en": name_en,
            "desc_de": desc_de, "desc_en": desc_en,
            "icon": icon,
            "category": category,
            "unlocked": unlocked,
            "unlocked_date": None,
            "progress": min(progress, target),
            "target": target,
        })

    # ════════════════════════════════════════════
    #  TRAINING — Session count
    # ════════════════════════════════════════════
    for target, aid, n_de, n_en, d_de, d_en, ico in [
        (1,   "first_workout",  "Erste Session",  "First Session",   "Du hast angefangen. Das zählt.",              "You started. That counts.",                    "🔨"),
        (10,  "10_workouts",    "10 Sessions",     "10 Sessions",     "10 Workouts in den Knochen.",                 "10 workouts in the books.",                    "💪"),
        (25,  "25_workouts",    "25 Sessions",     "25 Sessions",     "Kein Zufall mehr — das ist Gewohnheit.",      "Not a coincidence anymore — it's a habit.",    "🔥"),
        (50,  "50_workouts",    "50 Sessions",     "50 Sessions",     "Halbe Hundert. Du meinst es ernst.",          "Fifty sessions. You mean business.",           "⚡"),
        (100, "100_workouts",   "Century",         "Century",         "100 Sessions. Die meisten hören vorher auf.", "100 sessions. Most people quit before this.",  "🏆"),
        (200, "200_workouts",   "200 Sessions",    "200 Sessions",    "200 Workouts. Das Gym ist dein Zuhause.",     "200 workouts. The gym is home.",               "👑"),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, ico, "training",
              total_workouts >= target, min(total_workouts, target), target)

    # ════════════════════════════════════════════
    #  TRAINING — Total volume
    # ════════════════════════════════════════════
    for target, aid, n_de, n_en, d_de, d_en, ico in [
        (10_000,   "vol_10k",  "10 Tonnen",       "10 Tons",        "10.000 kg bewegt. Gut warm.",             "10,000 kg moved. Just warming up.",         "⚡"),
        (50_000,   "vol_50k",  "50 Tonnen",       "50 Tons",        "50.000 kg — einen LKW gehoben.",          "50,000 kg — you lifted a truck.",           "🚛"),
        (150_000,  "vol_150k", "150 Tonnen",      "150 Tons",       "150.000 kg Volumen. Nachhaltig.",          "150,000 kg volume. Consistent work.",       "💎"),
        (500_000,  "vol_500k", "500 Tonnen",      "500 Tons",       "500.000 kg. Absolute Hingabe.",            "500,000 kg. Absolute dedication.",          "🌟"),
        (1_000_000,"vol_1m",   "Eine Million kg", "One Million kg", "1.000.000 kg. Respekt, kein anderes Wort.","1,000,000 kg. Respect, no other word.",     "🔱"),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, ico, "training",
              total_volume_all_time >= target, min(round(total_volume_all_time), target), target)

    # ════════════════════════════════════════════
    #  STRENGTH — Relative to bodyweight (67 kg)
    #  Using actual heaviest set weight lifted
    # ════════════════════════════════════════════

    # Bench Press — 0.75×BW → 1×BW → 1.25×BW → 1.5×BW → 1.75×BW
    bench_w = _max_weight("bench press")
    for target_kg, aid, n_de, n_en, d_de, d_en in [
        (round(BW * 0.75), "bench_75bw",  "Bank 0.75× KG",  "Bench 0.75× BW",  f"{round(BW*0.75)}kg Bankdrücken — guter Einstieg.",         f"{round(BW*0.75)}kg bench — solid start."),
        (round(BW * 1.0),  "bench_1bw",   "Körpergewicht Bank", "Bodyweight Bench", f"{round(BW)}kg Bankdrücken — das eigene Gewicht. Benchmark.",f"{round(BW)}kg bench — your own bodyweight."),
        (round(BW * 1.25), "bench_125bw", "Bank 1.25× KG",  "Bench 1.25× BW",  f"{round(BW*1.25)}kg Bank — du drückst ordentlich.",         f"{round(BW*1.25)}kg bench — you're pressing seriously."),
        (round(BW * 1.5),  "bench_150bw", "Bank 1.5× KG",   "Bench 1.5× BW",   f"{round(BW*1.5)}kg Bank — Top 15% weltweit für dein Gewicht.",f"{round(BW*1.5)}kg bench — top 15% for your weight class."),
        (round(BW * 1.75), "bench_175bw", "Bank 1.75× KG",  "Bench 1.75× BW",  f"{round(BW*1.75)}kg Bank — Elite-Niveau.",                  f"{round(BW*1.75)}kg bench — elite level."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "🏋️", "strength",
              bench_w >= target_kg, min(round(bench_w), target_kg), target_kg)

    # Squat — 1×BW → 1.5×BW → 2×BW → 2.25×BW
    squat_w = _max_weight("squat")
    for target_kg, aid, n_de, n_en, d_de, d_en in [
        (round(BW * 1.0),  "squat_1bw",   "Kniebeuge KG",    "Bodyweight Squat", f"{round(BW)}kg Kniebeuge — eigenes Gewicht gesquattet.",    f"{round(BW)}kg squat — your bodyweight."),
        (round(BW * 1.5),  "squat_15bw",  "Kniebeuge 1.5× KG","Squat 1.5× BW",  f"{round(BW*1.5)}kg Kniebeuge — stärker als 70% der Gym-Nutzer.", f"{round(BW*1.5)}kg squat — stronger than 70%."),
        (round(BW * 2.0),  "squat_2bw",   "Kniebeuge 2× KG", "Squat 2× BW",     f"{round(BW*2.0)}kg Kniebeuge — Advanced-Niveau.",           f"{round(BW*2.0)}kg squat — advanced level."),
        (round(BW * 2.25), "squat_225bw", "Kniebeuge 2.25× KG","Squat 2.25× BW", f"{round(BW*2.25)}kg Kniebeuge — Elite-Quads.",              f"{round(BW*2.25)}kg squat — elite quads."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "🦵", "strength",
              squat_w >= target_kg, min(round(squat_w), target_kg), target_kg)

    # Deadlift — 1.5×BW → 2×BW → 2.5×BW → 3×BW
    dl_w = _max_weight("deadlift")
    for target_kg, aid, n_de, n_en, d_de, d_en in [
        (round(BW * 1.5),  "dl_15bw",  "Kreuzheben 1.5× KG", "Deadlift 1.5× BW",  f"{round(BW*1.5)}kg Kreuzheben — solide Basis.",               f"{round(BW*1.5)}kg deadlift — solid foundation."),
        (round(BW * 2.0),  "dl_2bw",   "Doppeltes KG",        "Double Bodyweight",  f"{round(BW*2.0)}kg Kreuzheben — doppeltes Körpergewicht.",     f"{round(BW*2.0)}kg deadlift — double bodyweight."),
        (round(BW * 2.5),  "dl_25bw",  "Kreuzheben 2.5× KG", "Deadlift 2.5× BW",  f"{round(BW*2.5)}kg Kreuzheben — Top 10% für dein Gewicht.",    f"{round(BW*2.5)}kg deadlift — top 10% for your weight."),
        (round(BW * 3.0),  "dl_3bw",   "Dreifaches KG",       "Triple Bodyweight",  f"{round(BW*3.0)}kg Kreuzheben — das ist Kraftsport auf höchstem Niveau.", f"{round(BW*3.0)}kg deadlift — elite powerlifting territory."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "💀", "strength",
              dl_w >= target_kg, min(round(dl_w), target_kg), target_kg)

    # OHP — 0.5×BW → 0.75×BW → 1×BW → 1.2×BW
    ohp_w = _max_weight("overhead press")
    for target_kg, aid, n_de, n_en, d_de, d_en in [
        (round(BW * 0.5),  "ohp_05bw",  "OHP 0.5× KG",  "OHP 0.5× BW",  f"{round(BW*0.5)}kg OHP — die halbe Miete.",                  f"{round(BW*0.5)}kg OHP — halfway there."),
        (round(BW * 0.75), "ohp_075bw", "OHP 0.75× KG", "OHP 0.75× BW", f"{round(BW*0.75)}kg OHP — starke Schultern.",                f"{round(BW*0.75)}kg OHP — strong shoulders."),
        (round(BW * 1.0),  "ohp_1bw",   "OHP Körpergewicht","OHP Bodyweight",f"{round(BW)}kg OHP — das eigene Gewicht über den Kopf. Respekt.", f"{round(BW)}kg OHP — bodyweight overhead. Respect."),
        (round(BW * 1.2),  "ohp_12bw",  "OHP 1.2× KG",  "OHP 1.2× BW",  f"{round(BW*1.2)}kg OHP — Elite-Schultern.",                  f"{round(BW*1.2)}kg OHP — elite shoulders."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "🙌", "strength",
              ohp_w >= target_kg, min(round(ohp_w), target_kg), target_kg)

    # Pull-ups — bodyweight reps milestones
    pullup_max_reps = 0
    for ename, data_list in all_exercises.items():
        if "pull" in ename.lower() and ("up" in ename.lower() or "chin" in ename.lower()):
            for d in data_list:
                if d["weight"] == 0 or d["weight"] < 5:  # bodyweight or near
                    if d["reps"] > pullup_max_reps:
                        pullup_max_reps = d["reps"]

    for target_reps, aid, n_de, n_en, d_de, d_en in [
        (5,  "pullup_5",  "5 Klimmzüge",  "5 Pull-ups",  "5 saubere Klimmzüge am Stück.",              "5 clean pull-ups in a row."),
        (10, "pullup_10", "10 Klimmzüge", "10 Pull-ups", "10 Klimmzüge — das ist Rückenpower.",        "10 pull-ups — that's back strength."),
        (15, "pullup_15", "15 Klimmzüge", "15 Pull-ups", "15 Klimmzüge am Stück — Elite-Calisthenics.", "15 pull-ups in a row — elite."),
        (20, "pullup_20", "20 Klimmzüge", "20 Pull-ups", "20 Klimmzüge — absoluter Ausnahmeathlet.",   "20 pull-ups — exceptional athlete."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "🐒", "strength",
              pullup_max_reps >= target_reps, min(pullup_max_reps, target_reps), target_reps)

    # ════════════════════════════════════════════
    #  NUTRITION — Days tracked
    # ════════════════════════════════════════════
    for target, aid, n_de, n_en, d_de, d_en, ico in [
        (7,   "tracked_7",   "Eine Woche",    "One Week",      "7 Tage durchgezogen.",              "7 days straight.",                      "🥗"),
        (30,  "tracked_30",  "Ein Monat",     "One Month",     "30 Tage getrackt. Disziplin.",      "30 days tracked. Discipline.",          "📊"),
        (90,  "tracked_90",  "3 Monate",      "3 Months",      "90 Tage — das wird zur Routine.",   "90 days — becoming routine.",           "📈"),
        (180, "tracked_180", "Halbes Jahr",   "Half a Year",   "180 Tage Tracking. Konsequent.",    "180 days of tracking. Consistent.",     "🌟"),
        (365, "tracked_365", "Ein ganzes Jahr","Full Year",    "365 Tage getrackt. Das ist selten.", "365 days tracked. That's rare.",        "👑"),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, ico, "nutrition",
              total_nutrition_days >= target, min(total_nutrition_days, target), target)

    # ── Protein target days ──
    protein_target_days = sum(
        1 for nutr in nutrition_by_date.values()
        if nutr.get("goals", {}).get("protein", 0) > 0
        and nutr.get("protein", 0) >= nutr["goals"]["protein"] * 0.95
    )
    for target, aid, n_de, n_en, d_de, d_en, ico in [
        (7,   "prot_7",   "Protein-Woche",    "Protein Week",    "7× Protein-Ziel getroffen.",           "7 days hitting protein target.",      "🥩"),
        (30,  "prot_30",  "Protein-Monat",    "Protein Month",   "30× Protein-Ziel — Muskeln sagen Danke.", "30 days — muscles say thanks.",    "🥩"),
        (100, "prot_100", "Protein-Maschine", "Protein Machine", "100 Tage Protein-Ziel. Konsequent.",  "100 days hitting protein. Consistent.", "🥩"),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, ico, "nutrition",
              protein_target_days >= target, min(protein_target_days, target), target)

    # ════════════════════════════════════════════
    #  CONSISTENCY — Weekly training streaks
    # ════════════════════════════════════════════
    training_streak = compute_weekly_streaks(workout_dates, nutrition_dates)
    longest_training = training_streak["training"]["longest_streak"]

    for target, aid, n_de, n_en, d_de, d_en, ico in [
        (2,  "streak_2",  "2 Wochen",        "2 Weeks",          "2 Wochen am Stück. Anlauf genommen.",     "2 weeks straight. Momentum building.",    "🔥"),
        (4,  "streak_4",  "4 Wochen",        "4 Weeks",          "4 Wochen — ein Monat ohne Pause.",        "4 weeks — a full month without missing.", "🔥"),
        (8,  "streak_8",  "8 Wochen",        "8 Weeks",          "8 Wochen — Gewohnheit ist geformt.",      "8 weeks — habit is formed.",              "💫"),
        (12, "streak_12", "12 Wochen",       "12 Weeks",         "12 Wochen Streak. Nichts hält dich auf.", "12 week streak. Nothing stops you.",      "⭐"),
        (26, "streak_26", "Halbes Jahr",     "Half Year",        "26 Wochen — Fitness als Lebensweise.",    "26 weeks — fitness as a lifestyle.",      "🌟"),
        (52, "streak_52", "52 Wochen",       "52 Weeks",         "Ein Jahr durchgezogen. Das ist selten.",  "A full year. That's rare.",               "👑"),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, ico, "consistency",
              longest_training >= target, min(longest_training, target), target)

    # ════════════════════════════════════════════
    #  BODY — Weight tracking milestones
    # ════════════════════════════════════════════
    if weight_entries and len(weight_entries) >= 2:
        first_w = weight_entries[0]["weight_kg"]
        last_w = weight_entries[-1]["weight_kg"]
        total_change = abs(round(last_w - first_w, 1))
        for target, aid, n_de, n_en, d_de, d_en in [
            (1,  "body_1kg",  "1kg bewegt",      "1kg Changed",    "1kg Körpergewicht verändert.",          "1kg body weight change."),
            (3,  "body_3kg",  "3kg Transformation","3kg Transform", "3kg — der Körper formt sich.",          "3kg — the body is changing."),
            (5,  "body_5kg",  "5kg Transformation","5kg Transform", "5kg Veränderung — sichtbarer Fortschritt.", "5kg — visible progress."),
            (8,  "body_8kg",  "8kg Transformation","8kg Transform", "8kg — das ist eine echte Transformation.", "8kg — that's a real transformation."),
        ]:
            badge(aid, n_de, n_en, d_de, d_en, "⚖️", "body",
                  total_change >= target, min(round(total_change, 1), target), target)

    # ── Consistency in weighing: days with weight entries ──
    weight_tracked_days = len(weight_entries)
    for target, aid, n_de, n_en, d_de, d_en in [
        (14, "weigh_14", "14× gewogen",    "14 Weigh-ins",   "14 Tage Gewicht getrackt.",          "14 days of weight tracking."),
        (60, "weigh_60", "60× gewogen",    "60 Weigh-ins",   "60 Tage Gewicht eingetragen. Daten.", "60 days of weight data. Solid."),
        (180,"weigh_180","180× gewogen",   "180 Weigh-ins",  "180 Tage Waage. Konsequent.",        "180 weigh-ins. Consistent."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "📏", "body",
              weight_tracked_days >= target, min(weight_tracked_days, target), target)

    # ════════════════════════════════════════════
    #  TRAINING — Exercise variety
    # ════════════════════════════════════════════
    for target, aid, n_de, n_en, d_de, d_en in [
        (10, "var_10", "10 Übungen",  "10 Exercises", "10 verschiedene Übungen. Vielseitig.",       "10 different exercises. Versatile."),
        (25, "var_25", "25 Übungen",  "25 Exercises", "25 Übungen — du kennst dich aus.",           "25 exercises — you know your stuff."),
        (50, "var_50", "50 Übungen",  "50 Exercises", "50 Übungen — kein blinder Fleck mehr.",      "50 exercises — no blind spots left."),
    ]:
        badge(aid, n_de, n_en, d_de, d_en, "🎯", "training",
              unique_exercises >= target, min(unique_exercises, target), target)

    return achievements


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
