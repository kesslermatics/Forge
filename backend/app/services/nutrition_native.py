"""Nutrition data from Forge's own tracking (NutritionEntry, NutritionGoal).

This is what the Coach tools, the MCP server and the analytics read. Keys are ``calories``, ``totals``
and ``goals`` so prompts and clients stay stable. All dates are Europe/Berlin calendar days.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import NutritionEntry, NutritionGoal, NutritionMealSlot, User
from app.services import day_notes

BERLIN = ZoneInfo("Europe/Berlin")
UNASSIGNED = "Ohne Mahlzeit"
MAX_ITEMS_PER_MEAL = 25


def berlin_today() -> date:
    return datetime.now(BERLIN).date()


# ── goals ────────────────────────────────────────────────────────────────────────

def load_goals(db: Session, user_id) -> list[NutritionGoal]:
    """All target sets of a user, oldest first (a handful of rows at most)."""
    return db.query(NutritionGoal).filter(NutritionGoal.user_id == user_id).order_by(NutritionGoal.valid_from.asc()).all()


def goal_for_day(goals: list[NutritionGoal], day: date) -> NutritionGoal | None:
    """The target set that applied on ``day``; the oldest one also covers earlier days."""
    if not goals:
        return None
    chosen = goals[0]
    for goal in goals:
        if goal.valid_from <= day:
            chosen = goal
        else:
            break
    return chosen


def _opt(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def goals_native(goal: NutritionGoal | None) -> dict[str, float | None] | None:
    """Keys used by the tracking API and the app: kcal, protein, carbs, fat, sugar, salt (limits may be null)."""
    if goal is None:
        return None
    return {
        "kcal": round(goal.kcal), "protein": round(goal.protein), "carbs": round(goal.carbs), "fat": round(goal.fat),
        "sugar": _opt(goal.sugar), "salt": _opt(goal.salt),
    }


def goals_coach(goal: NutritionGoal | None) -> dict[str, float]:
    """Keys used by the coach tools; zeros mean "no target set"."""
    if goal is None:
        return {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "sugar": 0, "salt": 0}
    return {
        "calories": round(goal.kcal), "protein": round(goal.protein), "carbs": round(goal.carbs), "fat": round(goal.fat),
        "sugar": goal.sugar or 0, "salt": goal.salt or 0,
    }


def save_goals(
    db: Session, user: User, kcal: float, protein: float, carbs: float, fat: float,
    sugar: float | None = None, salt: float | None = None,
) -> NutritionGoal:
    """Set the targets from today on (saving again today overwrites).

    A save that changes nothing relative to the targets already in force does not add a row.
    """
    today = berlin_today()
    current = goal_for_day(load_goals(db, user.id), today)
    values = (kcal, protein, carbs, fat, sugar, salt)
    if current is not None and (current.kcal, current.protein, current.carbs, current.fat, current.sugar, current.salt) == values:
        return current
    goal = db.query(NutritionGoal).filter(NutritionGoal.user_id == user.id, NutritionGoal.valid_from == today).first()
    if goal is None:
        goal = NutritionGoal(user_id=user.id, valid_from=today, kcal=kcal, protein=protein, carbs=carbs, fat=fat, sugar=sugar, salt=salt)
        db.add(goal)
    else:
        goal.kcal, goal.protein, goal.carbs, goal.fat, goal.sugar, goal.salt = kcal, protein, carbs, fat, sugar, salt
    db.commit()
    db.refresh(goal)
    return goal


# ── one day ──────────────────────────────────────────────────────────────────────

def day_summary(db: Session, user: User, day: date, include_items: bool = False) -> dict[str, Any]:
    """Totals, targets, per-meal split and optionally every tracked food of one day."""
    slots = db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == user.id).order_by(
        NutritionMealSlot.position, NutritionMealSlot.created_at).all()
    names = {slot.id: slot.name for slot in slots}
    entries = db.query(NutritionEntry).filter(NutritionEntry.user_id == user.id, NutritionEntry.date == day).order_by(
        NutritionEntry.logged_at).all()

    totals = {key: 0.0 for key in ("calories", "protein", "carbs", "fat", "sugar", "fiber", "saturated", "salt")}
    meals: dict[str, dict[str, Any]] = {}
    items: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        meal = names.get(entry.slot_id, UNASSIGNED) if entry.slot_id else UNASSIGNED
        block = meals.setdefault(meal, {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "entries": 0})
        block["entries"] += 1
        for key, value in (("calories", entry.kcal), ("protein", entry.protein), ("carbs", entry.carbs), ("fat", entry.fat)):
            block[key] += value or 0.0
            totals[key] += value or 0.0
        for key in ("sugar", "fiber", "saturated", "salt"):
            totals[key] += getattr(entry, key) or 0.0
        if include_items:
            bucket = items.setdefault(meal, [])
            if len(bucket) < MAX_ITEMS_PER_MEAL:
                bucket.append({
                    "name": entry.name, "brand": entry.brand, "amount": round(entry.amount, 1), "unit": entry.unit,
                    "calories": round(entry.kcal or 0, 1), "protein": round(entry.protein or 0, 1),
                    "carbs": round(entry.carbs or 0, 1), "fat": round(entry.fat or 0, 1),
                    "time": entry.logged_at.astimezone(BERLIN).strftime("%H:%M") if entry.logged_at else None,
                })

    order = [slot.name for slot in slots] + [UNASSIGNED]
    ordered_meals = {name: {k: round(v, 1) if isinstance(v, float) else v for k, v in meals[name].items()} for name in order if name in meals}
    goal = goal_for_day(load_goals(db, user.id), day)
    result: dict[str, Any] = {
        "available": True,
        "source": "forge",
        "date": day.isoformat(),
        "logged": bool(entries),
        "entry_count": len(entries),
        "totals": {key: round(value, 2 if key == "salt" else 1) for key, value in totals.items()},
        "goals": goals_coach(goal) if goal else None,
        "meals": ordered_meals,
    }
    if goal is None:
        result["note"] = "Es sind noch keine Tagesziele hinterlegt (Dashboard, Kachel Ernährung heute)."
    if include_items:
        result["food_items"] = {name: items[name] for name in order if name in items}
    note = day_notes.get_note(db, user.id, day)
    if note:
        result["day_note"] = note
    return result


# ── date range ───────────────────────────────────────────────────────────────────

def nutrition_range(db: Session, user: User, start: date, end: date) -> dict[str, Any]:
    """Per-day totals and targets for an inclusive range, one row for every day.

    Returns ``days`` + ``failed_days``; steps come from Google Health.
    """
    if end < start:
        return {"days": [], "failed_days": 0}
    rows = db.query(
        NutritionEntry.date,
        func.coalesce(func.sum(NutritionEntry.kcal), 0.0),
        func.coalesce(func.sum(NutritionEntry.protein), 0.0),
        func.coalesce(func.sum(NutritionEntry.carbs), 0.0),
        func.coalesce(func.sum(NutritionEntry.fat), 0.0),
        func.coalesce(func.sum(NutritionEntry.fiber), 0.0),
        func.coalesce(func.sum(NutritionEntry.sugar), 0.0),
    ).filter(
        NutritionEntry.user_id == user.id, NutritionEntry.date >= start, NutritionEntry.date <= end,
    ).group_by(NutritionEntry.date).all()
    by_day = {row[0]: row[1:] for row in rows}
    goals = load_goals(db, user.id)
    notes = day_notes.notes_between(db, user.id, start, end)

    days = []
    cursor = start
    while cursor <= end:
        calories, protein, carbs, fat, fiber, sugar = by_day.get(cursor, (0.0,) * 6)
        row = {
            "date": cursor.isoformat(),
            "logged": calories > 0,
            "calories": round(calories, 1), "protein": round(protein, 1), "carbs": round(carbs, 1), "fat": round(fat, 1),
            "fiber": round(fiber, 1), "sugar": round(sugar, 1),
            "goals": goals_coach(goal_for_day(goals, cursor)),
        }
        if cursor in notes:
            row["day_note"] = notes[cursor]
        days.append(row)
        cursor += timedelta(days=1)
    return {"days": days, "failed_days": 0}
