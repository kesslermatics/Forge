"""Free-text food tracking: "100g Hähnchen von Lidl, 200g Kartoffeln und bisschen Öl".

Pipeline (small model, see settings.food_parse_model):
  1. One call splits the text into items. Each item has an amount in g/ml (stated or estimated) and,
     for packages and pieces ("eine Mozzarella", "halbe Dose Mais", "2 Riegel"), how many of them.
     For a photo, a vision call (settings.food_vision_model) produces the same items instead.
  2. Per item the hybrid catalog search collects candidates (with and without the brand), led by
     the user's own renamed foods; every candidate carries the user's name/brand overrides.
  3. Per item one small call picks the best candidate and says whether it is confident.
  4. The amount is fixed per candidate only now: packages and pieces use the product's package or
     serving size, so "eine Mozzarella" becomes the 125 g of that product instead of a guess.
Searches and picks of all items run in parallel; results are emitted in the order of the text so the
UI can play them back one after another. Confident items are tracked right away through the
``store`` callback, unsure ones are handed back with alternatives so the user can choose.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Literal

from openai import AsyncOpenAI

from app.config import settings
from app.services import food_catalog

logger = logging.getLogger(__name__)

MAX_AMOUNT = 10000.0
CANDIDATES_BRANDED = 5  # from the "name + brand" query; the plain query fills up to MAX_CANDIDATES
MAX_CANDIDATES = 9
MAX_ALTERNATIVES = 5
MAX_ITEMS = 25
MAX_COUNT = 20.0
MAX_PORTION = 3000.0  # larger "packages" are bulk packs, not something eaten at once
# A package or serving size this far from the model's own estimate is the wrong kind of package
# (a 6-pack instead of one bar); the estimate is the better answer then.
PORTION_RATIO = 4.0
OWN_CANDIDATES = 3

WeighState = Literal["raw", "cooked"]


@dataclass
class UserContext:
    """What the pipeline knows about the user (all keyed by (source, source_id))."""
    history: dict[tuple[str, str], int] = field(default_factory=dict)     # how often tracked
    recency: dict[tuple[str, str], int] = field(default_factory=dict)     # days since last tracked
    last_amounts: dict[tuple[str, str], float] = field(default_factory=dict)
    overrides: dict[tuple[str, str], tuple[str, str | None]] = field(default_factory=dict)  # own name, brand
    own_foods: list[dict[str, Any]] = field(default_factory=list)          # renamed foods as search rows
    weigh_state: WeighState = "raw"

    def rename(self, row: dict[str, Any]) -> dict[str, Any]:
        own = self.overrides.get((row["source"], row["source_id"]))
        return {**row, "name": own[0], "brand": own[1]} if own else row

ITEM_SCHEMA = (
    '{"items":[{"name":string,"brand":string|null,"amount":number,"unit":"g"|"ml","estimated":boolean,'
    '"portion":"packung"|"portion"|null,"count":number|null}]}'
)

PARSE_PROMPT = """Du zerlegst deutsche Beschreibungen von Mahlzeiten in einzelne Lebensmittel für ein Ernährungstagebuch.
Antworte ausschließlich mit JSON: __SCHEMA__

Regeln:
- name: gängiger deutscher Produktname, ohne Marke und ohne Mengenangabe (z. B. "Hähnchenbrust", "Kartoffeln", "Olivenöl").
- brand: nur wenn ausdrücklich genannt (z. B. Lidl, Rewe, Alpro), sonst null.
- unit: "ml" nur für Getränke und Flüssigkeiten wie Milch oder Saft, sonst "g".
- Genannte Mengen in g, kg, ml oder l: übernehmen (kg und l umrechnen), estimated=false, portion=null, count=null.
- Ganze Packungen oder Teile davon ("eine Mozzarella", "ein Joghurt", "halbe Dose Mais", "eine Flasche Cola", "ein Glas Pesto"):
  portion="packung", count=Anzahl der Packungen (z. B. 0.5 für eine halbe). amount: deine Schätzung der Gesamtmenge, estimated=true.
  Die genaue Packungsgröße wird danach aus den Produktdaten übernommen.
- Einzelne Stücke oder Portionen aus einer Packung ("ein Riegel", "2 Scheiben Käse", "3 Kekse", "ein Messlöffel Whey"):
  portion="portion", count=Anzahl, amount: deine Schätzung der Gesamtmenge, estimated=true.
- Alles andere ohne exakte Menge ("eine Banane", "2 Eier", "ein Teller Nudeln", "eine Handvoll Nüsse", "bisschen Öl"):
  schätze selbst eine realistische Gesamtmenge in g bzw. ml, estimated=true, portion=null, count=null.
- Zusammengesetzte Speisen ohne Marke zerlegst du in ihre Bestandteile, jeden mit eigener geschätzter Menge
  (z. B. "Butterbrezel" -> "Laugenbrezel" + "Butter"; "Käsebrot" -> "Brot" + "Butter" + "Käse"; "Spaghetti Bolognese" -> "Spaghetti gekocht" + "Bolognesesoße").
  Ein Fertigprodukt mit Markenangabe bleibt ein Eintrag.
- Zustand: Wird ein Zustand genannt (roh, gekocht, gebraten, ...), steht er im Namen. __STATE__
- Jedes Lebensmittel ist ein eigener Eintrag. Alles, was kein Lebensmittel oder Getränk ist, weglassen."""

STATE_RULES: dict[str, str] = {
    "raw": (
        "Fehlt er bei einer genannten Grammzahl von etwas, das vor dem Essen gegart wird (Reis, Nudeln, Kartoffeln, "
        "Hülsenfrüchte, Getreide, Fleisch, Fisch), ist das Rohgewicht gemeint: schreibe \"roh\" in den Namen (z. B. \"Reis roh\"). "
        "Schätzt du selbst eine Portion vom Teller, schätze das gegarte Gewicht und benenne es so (z. B. \"Nudeln gekocht\")."
    ),
    "cooked": (
        "Fehlt er bei etwas, das vor dem Essen gegart wird (Reis, Nudeln, Kartoffeln, Hülsenfrüchte, Getreide, Fleisch, "
        "Fisch), ist das gegarte Gewicht gemeint: schreibe den gegarten Zustand in den Namen (z. B. \"Reis gekocht\", "
        "\"Hähnchenbrust gebraten\")."
    ),
}


def parse_prompt(weigh_state: WeighState) -> str:
    return PARSE_PROMPT.replace("__SCHEMA__", ITEM_SCHEMA).replace("__STATE__", STATE_RULES.get(weigh_state, STATE_RULES["raw"]))


PHOTO_PROMPT = """Du siehst ein Foto von Essen oder Getränken und erstellst daraus die Einträge für ein Ernährungstagebuch.
Antworte ausschließlich mit JSON: __SCHEMA__

Regeln:
- Jedes erkennbare Lebensmittel ist ein eigener Eintrag (z. B. auf einem Teller Reis, Hähnchen und Brokkoli einzeln). Nur aufnehmen, was zu sehen ist; nichts dazuerfinden.
- name: gängiger deutscher Produktname ohne Marke und Menge, bei Zubereitungen mit Zustand ("Reis gekocht", "Hähnchenbrust gebraten").
- brand: nur wenn der Markenname auf einer Verpackung lesbar ist, sonst null.
- amount: Gewicht in Gramm (unit "g") bzw. Milliliter (unit "ml", nur Getränke und Flüssigkeiten) der sichtbaren Portion. Schätze es aus der Größe im Vergleich zu Teller, Besteck, Hand oder Verpackung.
- Steht eine Mengenangabe lesbar auf der Verpackung und wird offensichtlich die ganze Packung gegessen, nimm sie mit estimated=false. Alles andere ist geschätzt: estimated=true.
- Verpackte Produkte als konkretes Produkt benennen (z. B. "Magerquark", "Haferdrink"), nicht nur als "Verpackung".
- portion und count: "packung" mit der Anzahl, wenn offensichtlich eine ganze Packung (oder ein Teil davon) gegessen wird, sonst null.
- Ist kein Lebensmittel zu sehen, antworte mit {"items":[]}.""".replace("__SCHEMA__", ITEM_SCHEMA)

PICK_PROMPT = """Du wählst für ein Ernährungstagebuch das passende Produkt aus einer Kandidatenliste.
Antworte ausschließlich mit JSON: {"choice":number|null,"confident":boolean}

Regeln:
- choice ist der Index "i" des besten Kandidaten, oder null wenn kein Kandidat sinnvoll passt.
- Ohne Markenangabe: bevorzuge das einfache Grundnahrungsmittel (quelle "Grundnahrungsmittel") im üblichen Zustand, es sei denn, ein Markenprodukt passt klar besser.
- Mit Markenangabe: nimm das Produkt dieser Marke. Trägt kein Kandidat die Marke, nimm das beste allgemeine Produkt; die Marke ist dann nur Zusatzinfo.
- Achte auf den Zubereitungszustand (roh, gekocht, gebraten), wenn er genannt wird.
- Gewohnheit des Nutzers: "schon_getrackt" sagt, wie oft er das Produkt bereits getrackt hat, "zuletzt_vor_tagen" wie lange das her ist. Wenn die Wahl eng ist, nimm das Produkt, das er oft oder erst kürzlich getrackt hat. Ein klar besser passendes Produkt (Name, Marke, Zustand) schlägt die Gewohnheit aber.
- confident=true, wenn die Wahl eindeutig ist, die gängigste Variante klar ist, die Alternativen ähnliche Nährwerte haben oder ein bereits getracktes Produkt des Nutzers gut passt.
- confident=false, wenn mehrere sehr unterschiedliche Produkte (deutlich andere kcal) gleich gut passen und keines davon schon getrackt wurde, oder nichts wirklich passt."""


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, max_retries=1, timeout=25.0)


def _loads(raw: str) -> dict[str, Any]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("Model answer is not a JSON object")
    return data


async def _complete(system: str, user: Any, max_tokens: int, model: str | None = None) -> dict[str, Any]:
    response = await _client().chat.completions.create(
        model=model or settings.food_parse_model,
        temperature=0,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    return _loads(response.choices[0].message.content or "")


# ── step 1: split text ───────────────────────────────────────────────────────────

def _clean_item(raw: Any) -> dict[str, Any] | None:
    """Normalise one model item. ``amount`` is None when the model gave no usable amount."""
    if not isinstance(raw, dict):
        return None
    name = " ".join(str(raw.get("name") or "").split())[:120]
    if not name:
        return None
    brand = " ".join(str(raw.get("brand") or "").split())[:60] or None
    try:
        amount: float | None = float(raw.get("amount"))
    except (TypeError, ValueError):
        amount = None
    if amount is not None and not 0 < amount <= MAX_AMOUNT:
        amount = None
    portion = raw.get("portion") if raw.get("portion") in ("packung", "portion") else None
    count: float | None = None
    if portion:
        try:
            count = float(raw.get("count"))
        except (TypeError, ValueError):
            count = None
        if count is None or not 0 < count <= MAX_COUNT:
            count = 1.0
    unit = "ml" if raw.get("unit") == "ml" else "g"
    return {
        "name": name, "brand": brand, "amount": None if amount is None else round(amount, 1), "unit": unit,
        # A package or piece count without product data is always the model's guess.
        "estimated": amount is None or portion is not None or raw.get("estimated") is True, "portion": portion, "count": count,
    }


async def parse_text(text: str, weigh_state: WeighState = "raw") -> list[dict[str, Any]]:
    data = await _complete(parse_prompt(weigh_state), text, max_tokens=1600)
    items = [_clean_item(raw) for raw in data.get("items") or []]
    return [item for item in items if item][:MAX_ITEMS]


async def parse_image(image: str) -> list[dict[str, Any]]:
    """``image`` is a ``data:image/...;base64,`` URL."""
    user = [
        {"type": "text", "text": "Welche Lebensmittel sind auf dem Foto?"},
        {"type": "image_url", "image_url": {"url": image}},
    ]
    data = await _complete(PHOTO_PROMPT, user, max_tokens=1600, model=settings.food_vision_model)
    items = [_clean_item(raw) for raw in data.get("items") or []]
    return [item for item in items if item][:MAX_ITEMS]


# ── step 2: candidates ───────────────────────────────────────────────────────────

def _trackable(row: dict[str, Any]) -> bool:
    return None not in (row.get("kcal"), row.get("protein"), row.get("carbs"), row.get("fat"))


def _own_matches(item: dict[str, Any], ctx: UserContext) -> list[dict[str, Any]]:
    """Foods the user renamed whose own name matches the item; the catalog search only knows catalog names."""
    if not ctx.own_foods:
        return []
    terms = food_catalog.query_terms(item["name"])
    return [row for row in ctx.own_foods
            if food_catalog.matches_terms(terms, f"{row['name']} {row['brand'] or ''}")][:OWN_CANDIDATES]


def _collect_candidates(item: dict[str, Any], ctx: UserContext) -> list[dict[str, Any]]:
    queries = [(f"{item['name']} {item['brand']}", CANDIDATES_BRANDED)] if item["brand"] else []
    queries.append((item["name"], MAX_CANDIDATES))
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in _own_matches(item, ctx):
        if _trackable(row):
            seen.add((row["source"], row["source_id"]))
            candidates.append(row)
    for query, limit in queries:
        taken = 0
        for row in food_catalog.search(query, limit=limit + 4, history=ctx.history):
            key = (row["source"], row["source_id"])
            if key in seen or not _trackable(row):
                continue
            seen.add(key)
            candidates.append(ctx.rename(row))
            taken += 1
            if taken >= limit or len(candidates) >= MAX_CANDIDATES:
                break
    return candidates


# ── step 3: pick ─────────────────────────────────────────────────────────────────

async def _pick(item: dict[str, Any], candidates: list[dict[str, Any]], ctx: UserContext) -> tuple[int | None, bool]:
    lines = []
    for index, row in enumerate(candidates):
        entry: dict[str, Any] = {
            "i": index, "name": row["name"], "marke": row.get("brand"),
            "quelle": "Grundnahrungsmittel" if row["source"] == "bls" else "Produkt",
            "kcal_100": row["kcal"], "protein_100": row["protein"], "carbs_100": row["carbs"], "fett_100": row["fat"],
        }
        days = ctx.recency.get((row["source"], row["source_id"]))
        if days is not None:
            entry["schon_getrackt"] = row.get("tracked_count") or 1
            entry["zuletzt_vor_tagen"] = days
        lines.append(json.dumps(entry, ensure_ascii=False))
    user = json.dumps({"gesucht": item["name"], "marke": item["brand"]}, ensure_ascii=False) + "\nKandidaten:\n" + "\n".join(lines)
    data = await _complete(PICK_PROMPT, user, max_tokens=60)
    choice = data.get("choice")
    if isinstance(choice, bool) or not isinstance(choice, int) or not 0 <= choice < len(candidates):
        return None, False
    return choice, data.get("confident") is True


async def _resolve(item: dict[str, Any], ctx: UserContext) -> dict[str, Any]:
    try:
        candidates = await asyncio.to_thread(_collect_candidates, item, ctx)
    except Exception:
        logger.warning("Candidate search failed for %r", item["name"], exc_info=True)
        return {"status": "error", "candidates": [], "choice": None}
    if not candidates:
        return {"status": "not_found", "candidates": [], "choice": None}
    try:
        choice, confident = await _pick(item, candidates, ctx)
    except Exception:
        # Without a verdict the user decides; never track a guess silently.
        logger.warning("Candidate pick failed for %r", item["name"], exc_info=True)
        choice, confident = None, False
    return {"status": "tracked" if choice is not None and confident else "ambiguous", "candidates": candidates, "choice": choice}


# ── step 4: amount ───────────────────────────────────────────────────────────────

def _count_label(count: float, word: str) -> str:
    plural = {"Packung": "Packungen", "Portion": "Portionen"}[word]
    if count == 0.5:
        return f"½ {word}"
    number = f"{count:g}".replace(".", ",")
    return f"{number} {word if count <= 1 else plural}"


def amount_for(item: dict[str, Any], row: dict[str, Any], ctx: UserContext) -> dict[str, Any]:
    """The amount of ``item`` if it is tracked as ``row``.

    Packages and pieces take the product's own size ("eine Mozzarella" -> 125 g). Without a usable
    size the model's estimate stays. Without any amount at all: the user's last amount of this
    product, then one serving, then 100 g/ml - always flagged as estimated.
    """
    count = item.get("count") or 1.0
    guess = item["amount"]
    portion = item.get("portion")
    if portion:
        size = row.get("package_g") if portion == "packung" else row.get("serving_g")
        if size and 0 < size <= MAX_PORTION:
            amount = count * float(size)
            if 0 < amount <= MAX_AMOUNT and (guess is None or guess / PORTION_RATIO <= amount <= guess * PORTION_RATIO):
                word = "Packung" if portion == "packung" else "Portion"
                return {"amount": round(amount, 1), "estimated": False, "amount_note": _count_label(count, word)}
    if guess is not None:
        return {"amount": guess, "estimated": item["estimated"], "amount_note": None}
    last = ctx.last_amounts.get((row["source"], row["source_id"]))
    if last and 0 < last <= MAX_AMOUNT:
        return {"amount": round(float(last), 1), "estimated": True, "amount_note": "wie zuletzt"}
    serving = row.get("serving_g")
    if serving and 0 < serving * count <= MAX_PORTION:
        return {"amount": round(float(serving) * count, 1), "estimated": True, "amount_note": _count_label(count, "Portion")}
    return {"amount": 100.0, "estimated": True, "amount_note": None}


# ── orchestration ────────────────────────────────────────────────────────────────

def _option(row: dict[str, Any], amount: dict[str, Any]) -> dict[str, Any]:
    keys = ("source", "source_id", "name", "brand", "unit", "kcal", "protein", "carbs", "fat")
    return {**{key: row.get(key) for key in keys}, **amount, "servings": food_catalog.servings(row)}


async def smart_track_events(
    text: str | None,
    image: str | None,
    ctx: UserContext,
    store: Callable[[dict[str, Any], float], dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    """Yield ``parsed``, one ``item`` per food (in text order) and ``done``.

    ``store(candidate, amount)`` writes the diary entry and returns its serialised form.
    Every ``item`` carries up to five alternatives, each with its own amount; ``suggested`` says
    that the first one is the model's pick (also when it was not sure enough to track it).
    """
    try:
        items = await (parse_image(image) if image else parse_text(text or "", ctx.weigh_state))
    except Exception:
        logger.exception("Parsing food %s failed", "photo" if image else "text")
        yield {"type": "error", "message": "Das Foto konnte nicht verarbeitet werden." if image else "Der Text konnte nicht verarbeitet werden."}
        return
    if not items:
        yield {"type": "error", "message": "Auf dem Foto habe ich kein Lebensmittel erkannt." if image else "Ich habe darin kein Lebensmittel erkannt."}
        return

    yield {"type": "parsed", "items": [{"index": index, **item} for index, item in enumerate(items)]}

    tasks = [asyncio.create_task(_resolve(item, ctx)) for item in items]
    try:
        for index, (item, task) in enumerate(zip(items, tasks)):
            resolved = await task
            candidates = resolved["candidates"]
            choice = resolved["choice"]
            ordered = ([candidates[choice]] if choice is not None else []) + [row for i, row in enumerate(candidates) if i != choice]
            options = [_option(row, amount_for(item, row, ctx)) for row in ordered[:MAX_ALTERNATIVES]]
            first = options[0] if options else {"amount": item["amount"] or 100.0, "estimated": True, "amount_note": None}
            event: dict[str, Any] = {
                "type": "item", "index": index, "status": resolved["status"], "entry": None, "suggested": choice is not None,
                "amount": first["amount"], "estimated": first["estimated"], "amount_note": first["amount_note"],
            }
            if resolved["status"] == "tracked":
                try:
                    event["entry"] = store(candidates[choice], first["amount"])
                except Exception:
                    logger.exception("Storing smart-tracked entry failed")
                    event["status"] = "error"
            event["alternatives"] = options
            yield event
        yield {"type": "done"}
    finally:
        for task in tasks:
            task.cancel()
