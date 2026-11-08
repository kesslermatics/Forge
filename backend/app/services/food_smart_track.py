"""Free-text food tracking: "100g Hähnchen von Lidl, 200g Kartoffeln und bisschen Öl".

Pipeline (small model, see settings.food_parse_model):
  1. One call splits the text into items with an amount in g/ml (vague amounts are estimated).
     For a photo, a vision call (settings.food_vision_model) produces the same items instead.
  2. Per item the hybrid catalog search collects candidates (with and without the brand).
  3. Per item one small call picks the best candidate and says whether it is confident.
Searches and picks of all items run in parallel; results are emitted in the order of the text so the
UI can play them back one after another. Confident items are tracked right away through the
``store`` callback, unsure ones are handed back with alternatives so the user can choose.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, AsyncIterator, Callable

from openai import AsyncOpenAI

from app.config import settings
from app.services import food_catalog

logger = logging.getLogger(__name__)

MAX_AMOUNT = 10000.0
CANDIDATES_BRANDED = 5  # from the "name + brand" query; the plain query fills up to MAX_CANDIDATES
MAX_CANDIDATES = 9
MAX_ALTERNATIVES = 5

PARSE_PROMPT = """Du zerlegst deutsche Beschreibungen von Mahlzeiten in einzelne Lebensmittel für ein Ernährungstagebuch.
Antworte ausschließlich mit JSON: {"items":[{"name":string,"brand":string|null,"amount":number,"unit":"g"|"ml","estimated":boolean}]}

Regeln:
- name: gängiger deutscher Produktname, ohne Marke und ohne Mengenangabe (z. B. "Hähnchenbrust", "Kartoffeln", "Olivenöl").
- brand: nur wenn ausdrücklich genannt (z. B. Lidl, Rewe, Alpro), sonst null.
- amount: Menge in Gramm (unit "g") oder Millilitern (unit "ml", nur für Getränke und Flüssigkeiten wie Milch oder Saft).
- Genannte Mengen übernehmen (kg und l umrechnen), estimated=false.
- Stückzahlen, Portionen und vage Angaben ("eine Banane", "2 Eier", "bisschen Öl", "ein Joghurt") selbst als typische Menge in Gramm bzw. Millilitern schätzen, estimated=true.
  Richtwerte: Banane 120 g, Apfel 180 g, Ei 55 g, Scheibe Brot 45 g, Brötchen 60 g, Joghurtbecher 150 g, EL Öl 10 g, bisschen Öl 5 g, TL Zucker 5 g.
- Jedes Lebensmittel ist ein eigener Eintrag. Bei Zubereitungen den Zustand im Namen lassen (z. B. "Reis gekocht").
- Alles, was kein Lebensmittel oder Getränk ist, weglassen."""

PHOTO_PROMPT = """Du siehst ein Foto von Essen oder Getränken und erstellst daraus die Einträge für ein Ernährungstagebuch.
Antworte ausschließlich mit JSON: {"items":[{"name":string,"brand":string|null,"amount":number,"unit":"g"|"ml","estimated":boolean}]}

Regeln:
- Jedes erkennbare Lebensmittel ist ein eigener Eintrag (z. B. auf einem Teller Reis, Hähnchen und Brokkoli einzeln). Nur aufnehmen, was zu sehen ist; nichts dazuerfinden.
- name: gängiger deutscher Produktname ohne Marke und Menge, bei Zubereitungen mit Zustand ("Reis gekocht", "Hähnchenbrust gebraten").
- brand: nur wenn der Markenname auf einer Verpackung lesbar ist, sonst null.
- amount: Gewicht in Gramm (unit "g") bzw. Milliliter (unit "ml", nur Getränke und Flüssigkeiten) der sichtbaren Portion. Schätze es aus der Größe im Vergleich zu Teller, Besteck, Hand oder Verpackung.
- Steht eine Mengenangabe lesbar auf der Verpackung und wird offensichtlich die ganze Packung gegessen, nimm sie mit estimated=false. Alles andere ist geschätzt: estimated=true.
- Verpackte Produkte als konkretes Produkt benennen (z. B. "Magerquark", "Haferdrink"), nicht nur als "Verpackung".
- Ist kein Lebensmittel zu sehen, antworte mit {"items":[]}."""

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
    if not isinstance(raw, dict):
        return None
    name = " ".join(str(raw.get("name") or "").split())[:120]
    if not name:
        return None
    brand = " ".join(str(raw.get("brand") or "").split())[:60] or None
    try:
        amount = float(raw.get("amount"))
    except (TypeError, ValueError):
        amount = 0.0
    estimated = raw.get("estimated") is True
    if not 0 < amount <= MAX_AMOUNT:
        amount, estimated = 100.0, True
    unit = "ml" if raw.get("unit") == "ml" else "g"
    return {"name": name, "brand": brand, "amount": round(amount, 1), "unit": unit, "estimated": estimated}


async def parse_text(text: str) -> list[dict[str, Any]]:
    data = await _complete(PARSE_PROMPT, text, max_tokens=1200)
    items = [_clean_item(raw) for raw in data.get("items") or []]
    return [item for item in items if item]


async def parse_image(image: str) -> list[dict[str, Any]]:
    """``image`` is a ``data:image/...;base64,`` URL."""
    user = [
        {"type": "text", "text": "Welche Lebensmittel sind auf dem Foto?"},
        {"type": "image_url", "image_url": {"url": image}},
    ]
    data = await _complete(PHOTO_PROMPT, user, max_tokens=1200, model=settings.food_vision_model)
    items = [_clean_item(raw) for raw in data.get("items") or []]
    return [item for item in items if item]


# ── step 2: candidates ───────────────────────────────────────────────────────────

def _trackable(row: dict[str, Any]) -> bool:
    return None not in (row.get("kcal"), row.get("protein"), row.get("carbs"), row.get("fat"))


def _collect_candidates(item: dict[str, Any], history: dict[tuple[str, str], int]) -> list[dict[str, Any]]:
    queries = [(f"{item['name']} {item['brand']}", CANDIDATES_BRANDED)] if item["brand"] else []
    queries.append((item["name"], MAX_CANDIDATES))
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for query, limit in queries:
        taken = 0
        for row in food_catalog.search(query, limit=limit + 4, history=history):
            key = (row["source"], row["source_id"])
            if key in seen or not _trackable(row):
                continue
            seen.add(key)
            candidates.append(row)
            taken += 1
            if taken >= limit or len(candidates) >= MAX_CANDIDATES:
                break
    return candidates


# ── step 3: pick ─────────────────────────────────────────────────────────────────

async def _pick(
    item: dict[str, Any], candidates: list[dict[str, Any]], recency: dict[tuple[str, str], int],
) -> tuple[int | None, bool]:
    lines = []
    for index, row in enumerate(candidates):
        entry: dict[str, Any] = {
            "i": index, "name": row["name"], "marke": row.get("brand"),
            "quelle": "Grundnahrungsmittel" if row["source"] == "bls" else "Produkt",
            "kcal_100": row["kcal"], "protein_100": row["protein"], "carbs_100": row["carbs"], "fett_100": row["fat"],
        }
        days = recency.get((row["source"], row["source_id"]))
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


async def _resolve(
    item: dict[str, Any], history: dict[tuple[str, str], int], recency: dict[tuple[str, str], int],
) -> dict[str, Any]:
    try:
        candidates = await asyncio.to_thread(_collect_candidates, item, history)
    except Exception:
        logger.warning("Candidate search failed for %r", item["name"], exc_info=True)
        return {"status": "error", "candidates": [], "choice": None}
    if not candidates:
        return {"status": "not_found", "candidates": [], "choice": None}
    try:
        choice, confident = await _pick(item, candidates, recency)
    except Exception:
        # Without a verdict the user decides; never track a guess silently.
        logger.warning("Candidate pick failed for %r", item["name"], exc_info=True)
        choice, confident = None, False
    return {"status": "tracked" if choice is not None and confident else "ambiguous", "candidates": candidates, "choice": choice}


# ── orchestration ────────────────────────────────────────────────────────────────

def _option(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in ("source", "source_id", "name", "brand", "unit", "kcal", "protein", "carbs", "fat")}


async def smart_track_events(
    text: str | None,
    image: str | None,
    history: dict[tuple[str, str], int],
    recency: dict[tuple[str, str], int],
    store: Callable[[dict[str, Any], float], dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    """Yield ``parsed``, one ``item`` per food (in text order) and ``done``.

    ``store(candidate, amount)`` writes the diary entry and returns its serialised form.
    """
    try:
        items = await (parse_image(image) if image else parse_text(text or ""))
    except Exception:
        logger.exception("Parsing food %s failed", "photo" if image else "text")
        yield {"type": "error", "message": "Das Foto konnte nicht verarbeitet werden." if image else "Der Text konnte nicht verarbeitet werden."}
        return
    if not items:
        yield {"type": "error", "message": "Auf dem Foto habe ich kein Lebensmittel erkannt." if image else "Ich habe darin kein Lebensmittel erkannt."}
        return

    yield {"type": "parsed", "items": [{"index": index, **item} for index, item in enumerate(items)]}

    tasks = [asyncio.create_task(_resolve(item, history, recency)) for item in items]
    try:
        for index, (item, task) in enumerate(zip(items, tasks)):
            resolved = await task
            candidates = resolved["candidates"]
            choice = resolved["choice"]
            event: dict[str, Any] = {"type": "item", "index": index, "status": resolved["status"], "entry": None}
            ordered = ([candidates[choice]] if choice is not None else []) + [row for i, row in enumerate(candidates) if i != choice]
            if resolved["status"] == "tracked":
                try:
                    event["entry"] = store(candidates[choice], item["amount"])
                except Exception:
                    logger.exception("Storing smart-tracked entry failed")
                    event["status"] = "error"
            event["alternatives"] = [_option(row) for row in ordered[:MAX_ALTERNATIVES]]
            yield event
        yield {"type": "done"}
    finally:
        for task in tasks:
            task.cancel()
