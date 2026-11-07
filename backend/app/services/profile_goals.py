"""The user's goals: body-weight goal with dates, daily nutrition targets and free-text nutrition rules.

One service for the profile page, the API and the MCP tools, so every entry point validates and
stores the same way. All dates are Europe/Berlin calendar days.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models import ProfileGoal, User, WeightEntry
from app.services import nutrition_native
from app.services.nutrition_native import berlin_today

WEIGHT_RANGE = (20.0, 400.0)
NUTRITION_RANGES = {
    "kcal": (800.0, 10000.0), "protein": (0.0, 600.0), "carbs": (0.0, 1500.0),
    "fat": (0.0, 600.0), "sugar": (0.0, 500.0), "salt": (0.0, 50.0),
}
REQUIRED_NUTRITION = ("kcal", "protein", "carbs", "fat")
OPTIONAL_NUTRITION = ("sugar", "salt")
WEIGHT_FIELDS = ("start_weight_kg", "start_date", "target_weight_kg", "target_date")
MAX_RULES_LENGTH = 2000
MAX_HISTORY_DAYS = 3650


class GoalError(ValueError):
    """A goal value is invalid; the message is shown to the user (German)."""


def _check_weight(value: float | None, label: str) -> float | None:
    if value is None:
        return None
    low, high = WEIGHT_RANGE
    if not low <= value <= high:
        raise GoalError(f"{label}: bitte einen Wert zwischen {low:g} und {high:g} kg angeben.")
    return round(float(value), 1)


# ── body weight entries ──────────────────────────────────────────────────────────

def save_weight(db: Session, user: User, weight_kg: float, day: date | None = None) -> dict[str, Any]:
    """Store the body weight of one day (one entry per day; saving again overwrites)."""
    today = berlin_today()
    day = day or today
    weight = _check_weight(weight_kg, "Gewicht")
    if day > today:
        raise GoalError("Das Datum liegt in der Zukunft.")
    if (today - day).days > MAX_HISTORY_DAYS:
        raise GoalError("Das Datum liegt zu weit zurück.")
    entry = db.query(WeightEntry).filter(WeightEntry.user_id == user.id, WeightEntry.date == day).first()
    if entry is None:
        db.add(WeightEntry(user_id=user.id, date=day, weight_kg=weight))
    else:
        entry.weight_kg = weight
    db.commit()
    return {"date": day.isoformat(), "weight_kg": weight}


def latest_weight(db: Session, user_id) -> WeightEntry | None:
    return db.query(WeightEntry).filter(WeightEntry.user_id == user_id).order_by(WeightEntry.date.desc()).first()


# ── reading ──────────────────────────────────────────────────────────────────────

def _profile(db: Session, user_id) -> ProfileGoal | None:
    return db.query(ProfileGoal).filter(ProfileGoal.user_id == user_id).first()


def weight_goal(db: Session, user: User) -> dict[str, Any]:
    """Weight goal with progress: where the user stands, what is left, and the pace the deadline needs."""
    profile = _profile(db, user.id)
    latest = latest_weight(db, user.id)
    result: dict[str, Any] = {
        "start_kg": profile.start_weight_kg if profile else None,
        "start_date": profile.start_date.isoformat() if profile and profile.start_date else None,
        "target_kg": profile.target_weight_kg if profile else None,
        "target_date": profile.target_date.isoformat() if profile and profile.target_date else None,
        "current_kg": round(latest.weight_kg, 1) if latest else None,
        "current_date": latest.date.isoformat() if latest else None,
        "kg_to_go": None,
        "days_left": None,
        "required_rate_kg_per_week": None,
    }
    if profile and profile.target_weight_kg is not None and latest is not None:
        result["kg_to_go"] = round(profile.target_weight_kg - latest.weight_kg, 1)
    if profile and profile.target_date is not None:
        days_left = (profile.target_date - berlin_today()).days
        result["days_left"] = days_left
        if days_left > 0 and result["kg_to_go"] is not None:
            result["required_rate_kg_per_week"] = round(result["kg_to_go"] / (days_left / 7), 2)
    return result


def get_goals(db: Session, user: User) -> dict[str, Any]:
    goal = nutrition_native.goal_for_day(nutrition_native.load_goals(db, user.id), berlin_today())
    nutrition = nutrition_native.goals_native(goal)
    if nutrition is not None and goal is not None:
        nutrition["valid_from"] = goal.valid_from.isoformat()
    profile = _profile(db, user.id)
    return {
        "weight": weight_goal(db, user),
        "nutrition": nutrition,
        "nutrition_rules": profile.nutrition_rules if profile else None,
    }


# ── writing ──────────────────────────────────────────────────────────────────────

def set_goals(db: Session, user: User, fields: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial update. Only keys present in ``fields`` change; ``None`` clears optional values.

    Keys: start_weight_kg, start_date, target_weight_kg, target_date (body weight goal),
    kcal, protein, carbs, fat, sugar, salt (daily targets, valid from today) and nutrition_rules.
    """
    today = berlin_today()
    profile = _profile(db, user.id)

    # ── weight goal ──
    weight_patch = {key: fields[key] for key in WEIGHT_FIELDS if key in fields}
    if weight_patch:
        start_weight = _check_weight(weight_patch["start_weight_kg"], "Startgewicht") if "start_weight_kg" in weight_patch else (profile.start_weight_kg if profile else None)
        target_weight = _check_weight(weight_patch["target_weight_kg"], "Zielgewicht") if "target_weight_kg" in weight_patch else (profile.target_weight_kg if profile else None)
        start_date = weight_patch["start_date"] if "start_date" in weight_patch else (profile.start_date if profile else None)
        target_date = weight_patch["target_date"] if "target_date" in weight_patch else (profile.target_date if profile else None)
        if start_date is not None and start_date > today:
            raise GoalError("Das Startdatum darf nicht in der Zukunft liegen.")
        if start_date is not None and (today - start_date).days > MAX_HISTORY_DAYS:
            raise GoalError("Das Startdatum liegt zu weit zurück.")
        if start_date is not None and target_date is not None and target_date <= start_date:
            raise GoalError("Das Zieldatum muss nach dem Startdatum liegen.")
        if profile is None:
            profile = ProfileGoal(user_id=user.id)
            db.add(profile)
        profile.start_weight_kg, profile.start_date = start_weight, start_date
        profile.target_weight_kg, profile.target_date = target_weight, target_date
        # The start weight is also the weight of that day, so the chart begins exactly there.
        if ("start_weight_kg" in weight_patch or "start_date" in weight_patch) and start_weight is not None and start_date is not None:
            entry = db.query(WeightEntry).filter(WeightEntry.user_id == user.id, WeightEntry.date == start_date).first()
            if entry is None:
                db.add(WeightEntry(user_id=user.id, date=start_date, weight_kg=start_weight))
            else:
                entry.weight_kg = start_weight

    # ── nutrition rules ──
    if "nutrition_rules" in fields:
        if profile is None:
            profile = ProfileGoal(user_id=user.id)
            db.add(profile)
        text = (fields["nutrition_rules"] or "").strip()
        profile.nutrition_rules = text[:MAX_RULES_LENGTH] or None

    # ── daily targets ──
    nutrition_patch = {key: fields[key] for key in (*REQUIRED_NUTRITION, *OPTIONAL_NUTRITION) if key in fields}
    if nutrition_patch:
        current = nutrition_native.goal_for_day(nutrition_native.load_goals(db, user.id), today)
        merged: dict[str, float | None] = {
            key: (getattr(current, key) if current is not None else None) for key in (*REQUIRED_NUTRITION, *OPTIONAL_NUTRITION)
        }
        merged.update(nutrition_patch)
        missing = [key for key in REQUIRED_NUTRITION if merged.get(key) is None]
        if missing:
            raise GoalError("Für die Tagesziele brauche ich Kalorien, Protein, Kohlenhydrate und Fett zusammen.")
        for key, value in merged.items():
            if value is None:
                continue
            low, high = NUTRITION_RANGES[key]
            if not low <= float(value) <= high:
                raise GoalError(f"{key}: bitte einen Wert zwischen {low:g} und {high:g} angeben.")
        nutrition_native.save_goals(
            db, user, round(merged["kcal"]), round(merged["protein"]), round(merged["carbs"]), round(merged["fat"]),
            None if merged["sugar"] is None else round(merged["sugar"]), None if merged["salt"] is None else round(merged["salt"], 1),
        )

    db.commit()
    return get_goals(db, user)
