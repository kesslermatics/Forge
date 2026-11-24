"""A meal idea that fits what is left of the day: "Was passt noch?".

The model gets the user's own foods (habits of this meal first, with nutrients per 100 g/ml), the
meals they actually ate in this slot, what they ate in the last days and the remaining budget. It
proposes one meal and sets the amounts itself: a rough fit is the goal, not an exact one.
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
from app.services import food_catalog, food_smart_track
from app.services.food_suggestions import BERLIN

logger = logging.getLogger(__name__)

MACROS = ("kcal", "protein", "carbs", "fat")
MAX_IDEAS = 1
MAX_ITEMS_PER_IDEA = 6
MAX_AMOUNT = 2000.0
MAX_WISH_ITEMS = 6

PROMPT = """Du bist ein pragmatischer Ernährungscoach in einer Tracking-App. Der Nutzer will wissen, was er zur genannten Mahlzeit
noch essen kann, damit er ungefähr in seinem Tagesbudget bleibt.

Antworte ausschließlich mit JSON:
{"ideas":[{"title":string,"reason":string,"items":[{"id":string,"amount":number}]}]}

Regeln:
- Genau 1 Idee: die eine Mahlzeit, die jetzt am besten passt. Sie besteht aus 1 bis 6 Lebensmitteln, nur aus der Liste "lebensmittel", angegeben über ihre id.
- amount ist die Menge in der Einheit des Lebensmittels (g oder ml). kcal eines Lebensmittels = kcal_100 * amount / 100.
- Rechne die Mengen so, dass die Idee ungefähr in das offene Budget passt (grob reicht, etwa ±10 %). Lieber etwas darunter als darüber.
  Ist noch viel Protein offen, bevorzuge proteinreiche Varianten.
- Bevorzuge Kombinationen, die der Nutzer schon so gegessen hat ("bisherige_mahlzeiten") und Lebensmittel, die er zu dieser Mahlzeit
  oft isst ("typisch_hier"). Passe dann vor allem die Mengen an. Die Mengenverhältnisse sollen realistisch bleiben.
- Realistische, runde Mengen (z. B. 5-g-Schritte; Getränke in 50-ml-Schritten). Ist "portion_g" angegeben, nimm wenn möglich ganze Portionen.
- Abwechslung: Was in den letzten Tagen ständig vorkam, nicht immer wieder vorschlagen, wenn es eine gute Alternative gibt.
- Lebensmittel mit "schon_getrackt" sind die Produkte, die der Nutzer wirklich zu Hause hat: nimm immer zuerst diese.
  Lebensmittel mit "neu": true kommen nur aus dem Katalog; nimm sie nur, wenn kein getracktes Produkt dieselbe Rolle erfüllt.
- Gibt es einen "wunsch", muss die Idee ihn erfüllen (verwende die Lebensmittel mit "wunsch": true), gern mit einer sinnvollen
  Ergänzung, wenn noch Budget oder Protein offen ist. Passt der Wunsch kaum ins Budget, schlage eine kleinere Portion vor und sag das im reason.
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
        if not self.tracked_count:
            row["neu"] = True
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
    tracked: list[dict[str, Any]] = field(default_factory=list)          # every tracked food as a catalog-like row


def _complete_per_100(per_100: dict[str, Any] | None) -> dict[str, float] | None:
    values = per_100 or {}
    if any(values.get(key) is None for key in MACROS):
        return None
    return {key: float(values[key]) for key in MACROS}


OWN_PICK_PROMPT = """Der Nutzer nennt ein Lebensmittel, das er essen möchte. Wähle aus SEINEN bisher getrackten Produkten das passende.
Antworte ausschließlich mit JSON: {"choice":number|null}

Regeln:
- choice ist der Index "i" des Produkts, das dieselbe Art Lebensmittel ist (z. B. "Schoko Müsli crunchy" -> ein Schoko-Crunchy-Müsli,
  "Whey" -> sein Whey-Proteinpulver, "griechischer Joghurt" -> sein griechischer Joghurt). Marke und genauer Name dürfen abweichen.
- Passen mehrere, nimm das, das er öfter oder zuletzt getrackt hat.
- null nur, wenn keins davon diese Art Lebensmittel ist (z. B. gesucht Müsli, vorhanden nur Haferflocken pur)."""

OWN_CANDIDATES = 8


def _own_candidates(item: dict[str, Any], tracked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The user's tracked foods sharing words with the wished item, best overlap and most tracked first."""
    variants = food_catalog.query_terms(item["name"])
    if item.get("brand"):
        variants = [variant + food_catalog._fold(item["brand"]).split() for variant in variants]
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for row in tracked:
        text = food_catalog._fold(f"{row['name']} {row.get('brand') or ''}")
        score = max((sum(1 for word in variant if len(word) >= 3 and food_catalog.fuzzy_contains(word, text)) for variant in variants), default=0)
        if score:
            scored.append((score, row.get("tracked_count") or 0, row))
    scored.sort(key=lambda entry: (-entry[0], -entry[1]))
    return [row for _, _, row in scored[:OWN_CANDIDATES]]


async def _pick_own(item: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not candidates:
        return None
    lines = [json.dumps({
        "i": index, "name": row["name"], "marke": row.get("brand"), "schon_getrackt": row.get("tracked_count") or 1,
        "kcal_100": row["kcal"], "protein_100": row["protein"],
    }, ensure_ascii=False) for index, row in enumerate(candidates)]
    user = json.dumps({"gesucht": item["name"], "marke": item.get("brand")}, ensure_ascii=False) + "\nProdukte des Nutzers:\n" + "\n".join(lines)
    try:
        data = await food_smart_track._complete(OWN_PICK_PROMPT, user, max_tokens=40)
    except Exception:
        logger.warning("Own-food pick failed for %r", item["name"], exc_info=True)
        return None
    choice = data.get("choice")
    if isinstance(choice, bool) or not isinstance(choice, int) or not 0 <= choice < len(candidates):
        return None
    return candidates[choice]


async def _resolve_wish_item(item: dict[str, Any], ctx: food_smart_track.UserContext, tracked: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The user's own product first; the catalog only when they never tracked anything of this kind."""
    try:
        own = await asyncio.to_thread(_own_candidates, item, tracked)
    except Exception:
        logger.warning("Own-food match failed for %r", item["name"], exc_info=True)
        own = []
    picked = await _pick_own(item, own)
    if picked is not None:
        return picked
    result = await food_smart_track._resolve(item, ctx)
    if not result["candidates"]:
        return None
    return result["candidates"][result["choice"] if result["choice"] is not None else 0]


async def resolve_wish(wish: str, ctx: food_smart_track.UserContext, tracked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows for the foods named in the wish. ``tracked``: every food the user tracked, as catalog-like rows."""
    try:
        items = (await food_smart_track.parse_text(wish, ctx.weigh_state))[:MAX_WISH_ITEMS]
    except Exception:
        logger.warning("Parsing meal wish failed", exc_info=True)
        return []
    resolved = await asyncio.gather(*(_resolve_wish_item(item, ctx, tracked) for item in items), return_exceptions=True)
    return [row for row in resolved if isinstance(row, dict)]


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
                "unit": food.unit, "amount": amount, "per_100": {key: food.per_100[key] for key in MACROS},
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
