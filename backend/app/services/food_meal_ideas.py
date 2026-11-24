"""Meal ideas that fit what is left of the day: "Was passt noch?".

The model gets the user's own foods (habits of this meal first, with nutrients per 100 g/ml), the
meals they actually ate in this slot, what they ate in the last days and the remaining budget. It
proposes three meals and sets the amounts itself: a rough fit is the goal, not an exact one.
An optional wish ("Müsli mit dem griechischen Joghurt") is resolved to catalog foods first with the
smart-track pipeline, so the ideas can use products the user has not tracked before.

Totals shown to the user are recomputed here from the chosen amounts and the real nutrients.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.config import settings
from app.services import food_smart_track
from app.services.food_suggestions import BERLIN

logger = logging.getLogger(__name__)

MACROS = ("kcal", "protein", "carbs", "fat")
MAX_IDEAS = 3
MAX_ITEMS_PER_IDEA = 6
MAX_AMOUNT = 2000.0
MAX_WISH_ITEMS = 6

PROMPT = """Du bist ein pragmatischer Ernährungscoach in einer Tracking-App. Der Nutzer will wissen, was er zur genannten Mahlzeit
noch essen kann, damit er ungefähr in seinem Tagesbudget bleibt.

Antworte ausschließlich mit JSON:
{"ideas":[{"title":string,"reason":string,"items":[{"id":string,"amount":number}]}]}

Regeln:
- Genau 3 Ideen. Jede Idee besteht aus 1 bis 6 Lebensmitteln, nur aus der Liste "lebensmittel", angegeben über ihre id.
- amount ist die Menge in der Einheit des Lebensmittels (g oder ml). kcal eines Lebensmittels = kcal_100 * amount / 100.
- Rechne die Mengen so, dass jede Idee ungefähr in das offene Budget passt (grob reicht, etwa ±10 %). Lieber etwas darunter als darüber.
  Ist noch viel Protein offen, bevorzuge proteinreiche Varianten.
- Bevorzuge Kombinationen, die der Nutzer schon so gegessen hat ("bisherige_mahlzeiten") und Lebensmittel, die er zu dieser Mahlzeit
  oft isst ("typisch_hier"). Passe dann vor allem die Mengen an. Die Mengenverhältnisse sollen realistisch bleiben.
- Realistische, runde Mengen (z. B. 5-g-Schritte; Getränke in 50-ml-Schritten). Ist "portion_g" angegeben, nimm wenn möglich ganze Portionen.
- Abwechslung: Die 3 Ideen sollen sich unterscheiden. Was in den letzten Tagen ständig vorkam, nicht in allen 3 Ideen wiederholen.
- Gibt es einen "wunsch", müssen alle 3 Ideen ihn erfüllen (verwende die Lebensmittel mit "wunsch": true). Variiere dann Mengen und
  sinnvolle Ergänzungen. Passt der Wunsch kaum ins Budget, schlage eine kleinere Portion vor und sag das im reason.
- Ist kaum noch Budget offen (unter ca. 150 kcal) oder ist es schon überschritten, schlage kleine, leichte Snacks vor und sag das ehrlich im reason.
- title: kurzer Name der Mahlzeit (max. 40 Zeichen). reason: ein kurzer Satz auf Deutsch, warum die Idee passt (z. B. Protein, wie sonst auch)."""


@dataclass
class PoolFood:
    """A food the model may use; ``id`` is the short key it answers with."""
    id: str
    source: str
    source_id: str
    name: str
    brand: str | None
    unit: str
    per_100: dict[str, float]
    typical_amount: float | None = None
    tracked_count: int = 0
    habit: bool = False
    wished: bool = False
    serving_g: float | None = None

    def prompt_row(self) -> dict[str, Any]:
        row: dict[str, Any] = {
            "id": self.id, "name": self.name, "marke": self.brand, "einheit": self.unit,
            **{f"{key}_100": round(self.per_100[key], 1) for key in MACROS},
        }
        if self.typical_amount:
            row["übliche_menge"] = round(self.typical_amount)
        if self.tracked_count:
            row["schon_getrackt"] = self.tracked_count
        if self.habit:
            row["typisch_hier"] = True
        if self.wished:
            row["wunsch"] = True
        if self.serving_g:
            row["portion_g"] = round(self.serving_g)
        return row


@dataclass
class IdeaContext:
    day: date
    slot_name: str
    remaining: dict[str, float]
    goals: dict[str, float]
    eaten_today: dict[str, float]
    pool: list[PoolFood]
    past_meals: list[list[dict[str, Any]]] = field(default_factory=list)  # [{"id", "amount"}] per meal, newest first
    recent_days: list[dict[str, Any]] = field(default_factory=list)      # {"datum", "lebensmittel": [names]}


def _complete_per_100(per_100: dict[str, Any] | None) -> dict[str, float] | None:
    values = per_100 or {}
    if any(values.get(key) is None for key in MACROS):
        return None
    return {key: float(values[key]) for key in MACROS}


async def resolve_wish(wish: str, ctx: food_smart_track.UserContext) -> list[dict[str, Any]]:
    """Catalog rows for the foods named in the wish; the user's own foods win through the smart-track search."""
    try:
        items = (await food_smart_track.parse_text(wish, ctx.weigh_state))[:MAX_WISH_ITEMS]
    except Exception:
        logger.warning("Parsing meal wish failed", exc_info=True)
        return []
    resolved = await asyncio.gather(*(food_smart_track._resolve(item, ctx) for item in items), return_exceptions=True)
    rows: list[dict[str, Any]] = []
    for result in resolved:
        if isinstance(result, BaseException) or not result["candidates"]:
            continue
        choice = result["choice"] if result["choice"] is not None else 0
        rows.append(result["candidates"][choice])
    return rows


def _prompt(context: IdeaContext, wish: str | None) -> str:
    def rounded(values: dict[str, float]) -> dict[str, int]:
        return {key: round(values.get(key, 0)) for key in MACROS}

    payload: dict[str, Any] = {
        "mahlzeit": context.slot_name,
        "datum": context.day.isoformat(),
        "uhrzeit": datetime.now(BERLIN).strftime("%H:%M"),
        "tagesziel": rounded(context.goals),
        "heute_gegessen": rounded(context.eaten_today),
        "offen": rounded(context.remaining),
        "wunsch": wish or None,
        "lebensmittel": [food.prompt_row() for food in context.pool],
        "bisherige_mahlzeiten": context.past_meals,
        "letzte_tage": context.recent_days,
    }
    return json.dumps(payload, ensure_ascii=False)


def _clean_ideas(data: dict[str, Any], pool: list[PoolFood]) -> list[dict[str, Any]]:
    by_id = {food.id: food for food in pool}
    ideas: list[dict[str, Any]] = []
    for raw in data.get("ideas") or []:
        if not isinstance(raw, dict):
            continue
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in raw.get("items") or []:
            if not isinstance(item, dict):
                continue
            food = by_id.get(str(item.get("id")))
            amount = item.get("amount")
            if food is None or food.id in seen or isinstance(amount, bool) or not isinstance(amount, (int, float)):
                continue
            amount = round(float(amount), 1)
            if not 0 < amount <= MAX_AMOUNT:
                continue
            seen.add(food.id)
            items.append({
                "source": food.source, "source_id": food.source_id, "name": food.name, "brand": food.brand,
                "unit": food.unit, "amount": amount,
                **{key: round(food.per_100[key] * amount / 100, 1) for key in MACROS},
            })
        if not items:
            continue
        items = items[:MAX_ITEMS_PER_IDEA]
        ideas.append({
            "title": str(raw.get("title") or "Vorschlag").strip()[:60],
            "reason": str(raw.get("reason") or "").strip()[:240],
            "items": items,
            "totals": {key: round(sum(item[key] for item in items), 1) for key in MACROS},
        })
        if len(ideas) >= MAX_IDEAS:
            break
    return ideas


async def generate(context: IdeaContext, wish: str | None) -> list[dict[str, Any]]:
    data = await food_smart_track._complete(
        PROMPT, _prompt(context, wish), max_tokens=2500, model=settings.meal_ideas_model,
    )
    return _clean_ideas(data, context.pool)
