"""Everything the Ernährung tab shows, in one response: today, the week band, streak, the daily series,
weekly calories next to body weight, and the meal split and favourite foods for 7 and 30 days.

All dates are Europe/Berlin calendar days. A day counts as "logged" when it has tracked calories.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import NutritionEntry, NutritionMealSlot, User
from app.services import profile_goals
from app.services.nutrition_native import UNASSIGNED, berlin_today, goal_for_day, goals_native, load_goals

SERIES_DAYS = 30
RANGES = (7, 30)
WEEKS = 8
TOP_FOODS = 5
STREAK_LOOKBACK_DAYS = 400
TOTAL_KEYS = ("kcal", "protein", "carbs", "fat", "fiber", "sugar", "salt")


def _daily_totals(db: Session, user_id, start: date, end: date) -> dict[date, dict[str, float]]:
    columns = [func.coalesce(func.sum(getattr(NutritionEntry, key)), 0.0) for key in TOTAL_KEYS]
    rows = db.query(NutritionEntry.date, *columns).filter(
        NutritionEntry.user_id == user_id, NutritionEntry.date >= start, NutritionEntry.date <= end,
    ).group_by(NutritionEntry.date).all()
    return {row[0]: dict(zip(TOTAL_KEYS, row[1:])) for row in rows}


def _streak(db: Session, user_id, today: date) -> int:
    """Consecutive logged days up to today; a still empty today does not break the streak."""
    rows = db.query(NutritionEntry.date).filter(
        NutritionEntry.user_id == user_id, NutritionEntry.date >= today - timedelta(days=STREAK_LOOKBACK_DAYS),
        NutritionEntry.kcal > 0,
    ).distinct().all()
    logged = {row[0] for row in rows}
    cursor = today if today in logged else today - timedelta(days=1)
    streak = 0
    while cursor in logged:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _meals(db: Session, user: User, start: date) -> list[dict[str, Any]]:
    slots = db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == user.id).order_by(
        NutritionMealSlot.position, NutritionMealSlot.created_at).all()
    rows = db.query(NutritionEntry.slot_id, func.coalesce(func.sum(NutritionEntry.kcal), 0.0)).filter(
        NutritionEntry.user_id == user.id, NutritionEntry.date >= start,
    ).group_by(NutritionEntry.slot_id).all()
    kcal_by_slot = {slot_id: float(kcal) for slot_id, kcal in rows}
    meals = [{"name": slot.name, "kcal": round(kcal_by_slot.get(slot.id, 0.0))} for slot in slots]
    meals.append({"name": UNASSIGNED, "kcal": round(kcal_by_slot.get(None, 0.0))})
    return [meal for meal in meals if meal["kcal"] > 0]


def _top_foods(db: Session, user_id, start: date) -> list[dict[str, Any]]:
    count = func.count(NutritionEntry.id)
    rows = db.query(
        NutritionEntry.source, NutritionEntry.source_id, func.max(NutritionEntry.name), func.max(NutritionEntry.brand),
        count, func.avg(NutritionEntry.kcal), func.max(NutritionEntry.unit),
    ).filter(NutritionEntry.user_id == user_id, NutritionEntry.date >= start).group_by(
        NutritionEntry.source, NutritionEntry.source_id,
    ).order_by(count.desc(), func.sum(NutritionEntry.kcal).desc()).limit(TOP_FOODS).all()
    return [
        {"source": source, "source_id": source_id, "name": name, "brand": brand, "count": int(times), "avg_kcal": round(float(avg_kcal or 0))}
        for source, source_id, name, brand, times, avg_kcal, _unit in rows
    ]


def _weeks(
    totals: dict[date, dict[str, float]], weights: list[tuple[date, float]], monday: date,
) -> list[dict[str, Any]]:
    """Average calories (logged days only) and average body weight per Monday-based week, oldest first."""
    weeks = []
    for index in range(WEEKS):
        start = monday - timedelta(weeks=WEEKS - 1 - index)
        days = [start + timedelta(days=offset) for offset in range(7)]
        kcal = [totals[day]["kcal"] for day in days if day in totals and totals[day]["kcal"] > 0]
        kilos = [kg for day, kg in weights if start <= day <= start + timedelta(days=6)]
        weeks.append({
            "start": start.isoformat(),
            "avg_kcal": round(sum(kcal) / len(kcal)) if kcal else None,
            "logged_days": len(kcal),
            "avg_weight_kg": round(sum(kilos) / len(kilos), 2) if kilos else None,
        })
    return weeks


def overview(db: Session, user: User) -> dict[str, Any]:
    today = berlin_today()
    monday = today - timedelta(days=today.weekday())
    weeks_start = monday - timedelta(weeks=WEEKS - 1)
    series_start = today - timedelta(days=SERIES_DAYS - 1)
    first = min(weeks_start, series_start)

    totals = _daily_totals(db, user.id, first, today)
    goals = load_goals(db, user.id)
    weights = [(row.date, row.weight_kg) for row in profile_goals.daily_weights(db, user.id, weeks_start)]
    latest = profile_goals.latest_weight(db, user.id)

    def goal_of(day: date) -> dict[str, Any] | None:
        return goals_native(goal_for_day(goals, day))

    def day_row(day: date) -> dict[str, Any]:
        values = totals.get(day, {})
        goal = goal_of(day)
        return {
            "date": day.isoformat(),
            "kcal": round(values.get("kcal", 0.0)),
            "protein": round(values.get("protein", 0.0), 1),
            "carbs": round(values.get("carbs", 0.0), 1),
            "fat": round(values.get("fat", 0.0), 1),
            "fiber": round(values.get("fiber", 0.0), 1),
            "logged": values.get("kcal", 0.0) > 0,
            "goal_kcal": goal["kcal"] if goal else None,
            "goal_protein": goal["protein"] if goal else None,
            "goal_fiber": goal["fiber"] if goal else None,
        }

    today_values = totals.get(today, {})
    return {
        "today": {
            "date": today.isoformat(),
            "totals": {key: round(today_values.get(key, 0.0), 2 if key == "salt" else 1) for key in TOTAL_KEYS},
            "goals": goal_of(today),
        },
        "week": [
            {**{k: v for k, v in day_row(day).items() if k in ("date", "kcal", "logged", "goal_kcal")}, "future": day > today}
            for day in (monday + timedelta(days=offset) for offset in range(7))
        ],
        "streak_days": _streak(db, user.id, today),
        "days": [day_row(series_start + timedelta(days=offset)) for offset in range(SERIES_DAYS)],
        "weeks": _weeks(totals, weights, monday),
        "weight_kg": round(latest.weight_kg, 1) if latest else None,
        "meals": {str(days): _meals(db, user, today - timedelta(days=days - 1)) for days in RANGES},
        "top_foods": {str(days): _top_foods(db, user.id, today - timedelta(days=days - 1)) for days in RANGES},
    }
