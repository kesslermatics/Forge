"""Which foods to offer first on a meal page, from the user's own diary.

People eat the same things at the same meal: oats at breakfast, a shake after training. A food's
weight for a meal is the sum of its past entries in that meal, each halving in weight every
three weeks, so a new habit takes over within a few weeks. Meals without any history (a new slot,
"Ohne Mahlzeit") fall back to what the user tracked around the same time of day.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable
from uuid import UUID
from zoneinfo import ZoneInfo

from app.models import NutritionEntry

BERLIN = ZoneInfo("Europe/Berlin")
HALF_LIFE_DAYS = 21.0
TIME_WINDOW_HOURS = 1.5
MAX_SUGGESTIONS = 12

FoodKey = tuple[str, str]


@dataclass
class FoodUsage:
    latest: NutritionEntry          # newest entry of this food (any meal)
    order: int                      # 0 = most recently tracked food
    score: float = 0.0              # habit weight for the requested meal
    meal_amount: float | None = None  # last amount tracked in the requested meal
    in_meal_on_day: bool = False    # already in the requested meal on the requested day

    @property
    def default_amount(self) -> float:
        return round(self.meal_amount or self.latest.amount, 1)


def _hour(moment: datetime | None) -> float | None:
    if moment is None:
        return None
    local = moment.astimezone(BERLIN) if moment.tzinfo else moment
    return local.hour + local.minute / 60


def _hour_distance(a: float, b: float) -> float:
    diff = abs(a - b) % 24
    return min(diff, 24 - diff)


def food_usage(
    entries: Iterable[NutritionEntry],
    *,
    slot_id: UUID | None,
    day: date,
    today: date,
    now: datetime,
) -> dict[FoodKey, FoodUsage]:
    """Usage per food for the meal ``slot_id`` (None = "Ohne Mahlzeit") on ``day``.

    ``entries`` must be ordered newest first (by logged_at).
    """
    usage: dict[FoodKey, FoodUsage] = {}
    by_time: dict[FoodKey, float] = {}
    now_hour = _hour(now)
    for entry in entries:
        key = (entry.source, entry.source_id)
        item = usage.get(key)
        if item is None:
            item = usage[key] = FoodUsage(latest=entry, order=len(usage))
        weight = 0.5 ** (max((today - entry.date).days, 0) / HALF_LIFE_DAYS)
        if entry.slot_id == slot_id:
            item.score += weight
            if item.meal_amount is None:
                item.meal_amount = entry.amount
            if entry.date == day:
                item.in_meal_on_day = True
        # Time of day only means something while tracking today.
        hour = _hour(entry.logged_at)
        if day == today and hour is not None and now_hour is not None and _hour_distance(hour, now_hour) <= TIME_WINDOW_HOURS:
            by_time[key] = by_time.get(key, 0.0) + weight

    if slot_id is None or not any(item.score for item in usage.values()):
        # No habit for this meal yet: what the user eats around this time of day is the best guess.
        for key, weight in by_time.items():
            usage[key].score = max(usage[key].score, weight)
    return usage


def suggestion_order(usage: dict[FoodKey, FoodUsage]) -> tuple[list[FoodKey], list[FoodKey]]:
    """(suggested, rest): habit foods first, the ones already in this meal today after the others,
    then everything else by recency."""
    habits = sorted((key for key, item in usage.items() if item.score > 0),
                    key=lambda key: (usage[key].in_meal_on_day, -usage[key].score, usage[key].order))
    suggested = habits[:MAX_SUGGESTIONS]
    chosen = set(suggested)
    rest = sorted((key for key in usage if key not in chosen), key=lambda key: usage[key].order)
    return suggested, rest
