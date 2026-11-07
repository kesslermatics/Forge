"""Read access to the separate food catalog database (BLS 4.0 + Open Food Facts, pgvector).

The catalog is built by tools/food_catalog_import.py and holds no personal data. Search combines
trigram matching (exact words, brands, typos) with embedding similarity (synonyms such as
"Brokkoli"/"Broccoli" or "Eiweiß"/"Protein") and re-ranks the union in Python, where the user's
own tracking history can be taken into account.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import math
import re
import threading
from collections import OrderedDict
from functools import lru_cache
from typing import Any

import httpx
from openai import OpenAI
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config import settings
from app.database import _normalise_db_url
from app.services.food_catalog_rows import ROW_COLUMNS, off_row_from_product

logger = logging.getLogger(__name__)

OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_USER_AGENT = "ForgeFoodTracking/1.0 (private, non-commercial; forge.kesslermatics.com)"
DETAIL_COLUMNS = (
    "id, source, source_id, name, name_alt, brand, category, unit, kcal, protein, carbs, fat, sugar, fiber, "
    "saturated, salt, nutrients, serving_g, serving_label, package_g, quantity_label, ingredients, allergens, "
    "scans, quality"
)
SUMMARY_COLUMNS = "id, source, source_id, name, brand, unit, kcal, protein, carbs, fat, serving_g, serving_label, scans, quality"


class CatalogUnavailable(RuntimeError):
    """The deployment has no catalog database configured or it cannot be reached."""


@lru_cache(maxsize=1)
def _engine() -> Engine:
    if not settings.food_catalog_database_url.strip():
        raise CatalogUnavailable("Der Lebensmittelkatalog ist nicht konfiguriert.")
    return create_engine(
        _normalise_db_url(settings.food_catalog_database_url.strip()),
        pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=1800,
    )


def _rows(sql: str, params: dict[str, Any], setup: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Run one read query; ``setup`` holds SET LOCAL statements scoped to the same transaction."""
    try:
        with _engine().connect() as conn:
            for statement in setup:
                conn.execute(text(statement))
            return [dict(row._mapping) for row in conn.execute(text(sql), params)]
    except CatalogUnavailable:
        raise
    except Exception as exc:
        logger.exception("Food catalog query failed")
        raise CatalogUnavailable("Der Lebensmittelkatalog ist gerade nicht erreichbar.") from exc


# ── query embeddings ─────────────────────────────────────────────────────────────

_embedding_cache: "OrderedDict[str, list[float]]" = OrderedDict()
_cache_lock = threading.Lock()


@lru_cache(maxsize=1)
def _embedding_client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, max_retries=1, timeout=4.0)


def _query_embedding(query: str) -> list[float] | None:
    key = query.casefold()
    with _cache_lock:
        if key in _embedding_cache:
            _embedding_cache.move_to_end(key)
            return _embedding_cache[key]
    try:
        response = _embedding_client().embeddings.create(
            model=settings.food_embedding_model,
            input=query[:500],
            dimensions=settings.food_embedding_dimensions,
            encoding_format="float",
        )
    except Exception:
        # Semantic search is an enhancement; lexical results still answer the request.
        logger.warning("Query embedding failed; falling back to lexical search", exc_info=True)
        return None
    vector = response.data[0].embedding
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    vector = [value / norm for value in vector]
    with _cache_lock:
        _embedding_cache[key] = vector
        if len(_embedding_cache) > 2000:
            _embedding_cache.popitem(last=False)
    return vector


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


# ── search ───────────────────────────────────────────────────────────────────────

_pool = cf.ThreadPoolExecutor(max_workers=8, thread_name_prefix="food-search")


def _lexical(query: str, source: str, limit: int) -> list[dict[str, Any]]:
    return _rows(f"""
        SELECT {SUMMARY_COLUMNS},
               word_similarity(lower(f_unaccent(:q)), search_text) AS sim
        FROM foods
        WHERE source = :source AND quality = 'ok' AND lower(f_unaccent(:q)) <% search_text
        ORDER BY sim DESC, scans DESC, length(name)
        LIMIT :limit
    """, {"q": query, "source": source, "limit": limit}, setup=("SET LOCAL pg_trgm.word_similarity_threshold = 0.35",))


def _normalise_query(query: str) -> str:
    return re.sub(r"\s+", " ", query).strip()


def search(query: str, *, limit: int = 30, history: dict[tuple[str, str], int] | None = None) -> list[dict[str, Any]]:
    """Hybrid search. ``history`` maps (source, source_id) to how often the user tracked it."""
    query = _normalise_query(query)[:120]
    if len(query) < 2:
        return []
    history = history or {}
    embedding_future = _pool.submit(_query_embedding, query) if len(query) >= 3 else None

    if len(query) >= 3:
        # BLS gets its own candidate pool: it has no scan counts, so in a shared top-N it would be
        # crowded out by hundreds of equally similar OFF products ("Banane roh" vs. every banana).
        bls_future = _pool.submit(_lexical, query, "bls", 30)
        lexical = _lexical(query, "off", 120) + bls_future.result()
    else:
        lexical = _rows(f"""
            SELECT {SUMMARY_COLUMNS}, 0.6 AS sim
            FROM foods
            WHERE quality = 'ok' AND search_text LIKE lower(f_unaccent(:q)) || '%'
            ORDER BY scans DESC LIMIT 60
        """, {"q": query})

    semantic: list[dict[str, Any]] = []
    vector = embedding_future.result() if embedding_future else None
    if vector is not None:
        semantic = _rows(f"""
            SELECT {SUMMARY_COLUMNS},
                   1 - (embedding <=> CAST(:v AS halfvec)) AS cos
            FROM foods
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:v AS halfvec)
            LIMIT 80
        """, {"v": _vector_literal(vector)}, setup=("SET LOCAL hnsw.ef_search = 100",))

    candidates: dict[int, dict[str, Any]] = {}
    for row in lexical:
        candidates[row["id"]] = {**row, "cos": None}
    for row in semantic:
        if row["id"] in candidates:
            candidates[row["id"]]["cos"] = row["cos"]
        else:
            candidates[row["id"]] = {**row, "sim": None}

    folded = _fold(query)
    for row in candidates.values():
        row["score"] = _score(row, folded, history)

    # Collapse duplicates and keep the strongest row: same name and brand (different barcodes), or
    # same name with identical macros (one product listed under several brand spellings).
    ranked: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    for row in sorted(candidates.values(), key=lambda item: item["score"], reverse=True):
        name = _fold(row["name"]).strip()
        macros = tuple(None if row.get(field) is None else round(float(row[field])) for field in ("kcal", "protein", "carbs", "fat"))
        keys = {("brand", name, _fold(row["brand"] or "")), ("macros", name, macros)}
        if keys & seen:
            continue
        seen |= keys
        ranked.append(row)
        if len(ranked) >= limit:
            break
    return [summary(row, history) for row in ranked]


def _fold(value: str) -> str:
    table = str.maketrans({"ä": "a", "ö": "o", "ü": "u", "ß": "ss", "é": "e", "è": "e", "à": "a"})
    return value.casefold().translate(table)


_RAW_SUFFIX = re.compile(r"[,\s]+(roh|frisch)$")


def _score(row: dict[str, Any], folded_query: str, history: dict[tuple[str, str], int]) -> float:
    name = _fold(row["name"])
    score = 0.0
    if row.get("sim") is not None:
        score += float(row["sim"])
    if row.get("cos") is not None:
        # Cosine of short food names clusters around 0.5; only the part above it is signal.
        score += max(0.0, (float(row["cos"]) - 0.5) * 2.0) * 0.9
    # BLS names carry the preparation state ("Banane roh"); the raw/fresh item is the exact hit.
    if name == folded_query or (row["source"] == "bls" and _RAW_SUFFIX.sub("", name) == folded_query):
        score += 0.6
    elif re.match(rf"^{re.escape(folded_query)}\b", name):
        score += 0.3
    elif name.startswith(folded_query):
        score += 0.15
    score -= min(0.25, 0.004 * max(len(name) - len(folded_query), 0))
    score += 0.04 * math.log1p(row.get("scans") or 0)
    if row["source"] == "bls":
        # Generic foods are the right answer for generic queries ("banane", "reis"), but only
        # when they actually match well; otherwise "Haferflocken-Nussplätzchen" beats real oats.
        # The query must appear in the German name itself: embeddings and the English alias in
        # search_text would otherwise promote near-synonyms ("whey" -> "Sauermolke").
        strong = all(word in name for word in folded_query.split())
        if strong:
            score += 0.2 if len(folded_query.split()) <= 2 else 0.08
        else:
            score -= 0.4
    tracked = history.get((row["source"], row["source_id"]), 0)
    if tracked:
        score += 0.5 + 0.12 * math.log1p(tracked)
    return score


def summary(row: dict[str, Any], history: dict[tuple[str, str], int] | None = None) -> dict[str, Any]:
    return {
        "source": row["source"],
        "source_id": row["source_id"],
        "name": row["name"],
        "brand": row.get("brand"),
        "unit": row.get("unit") or "g",
        "kcal": _round(row.get("kcal")),
        "protein": _round(row.get("protein")),
        "carbs": _round(row.get("carbs")),
        "fat": _round(row.get("fat")),
        "serving_g": _round(row.get("serving_g")),
        "serving_label": row.get("serving_label"),
        "tracked_count": (history or {}).get((row["source"], row["source_id"]), 0),
    }


def _round(value: Any, digits: int = 1) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if math.isfinite(number) else None


# ── single products ──────────────────────────────────────────────────────────────

def get_food(source: str, source_id: str) -> dict[str, Any] | None:
    rows = _rows(f"SELECT {DETAIL_COLUMNS} FROM foods WHERE source = :s AND source_id = :i", {"s": source, "i": source_id})
    return rows[0] if rows else None


def barcode_candidates(code: str) -> list[str]:
    digits = re.sub(r"\D", "", code or "")
    if not 6 <= len(digits) <= 14:
        return []
    variants = [digits, digits.lstrip("0"), digits.zfill(13), digits.zfill(8) if len(digits) < 8 else digits]
    if len(digits) == 12:
        variants.append("0" + digits)  # UPC-A as EAN-13
    seen: list[str] = []
    for value in variants:
        if value and value not in seen:
            seen.append(value)
    return seen


def lookup_barcode(code: str) -> dict[str, Any] | None:
    """Local catalog first; on a miss ask the live OFF API once (allowed: one call per real scan)."""
    candidates = barcode_candidates(code)
    if not candidates:
        return None
    rows = _rows(f"""
        SELECT {DETAIL_COLUMNS} FROM foods
        WHERE source = 'off' AND source_id = ANY(:codes)
        ORDER BY (quality = 'ok') DESC, scans DESC LIMIT 1
    """, {"codes": candidates})
    if rows:
        return rows[0]
    return _fetch_off_live(candidates[0])


def _fetch_off_live(code: str) -> dict[str, Any] | None:
    fields = ",".join([
        "code", "product_name", "product_name_de", "brands", "categories_tags", "nutriments", "nutrition", "serving_quantity", "serving_size",
        "product_quantity", "product_quantity_unit", "quantity", "ingredients_text_de", "ingredients_text", "allergens_tags",
        "countries_tags", "unique_scans_n", "completeness",
    ])
    try:
        response = httpx.get(OFF_PRODUCT_URL.format(code=code), params={"fields": fields},
                             headers={"User-Agent": OFF_USER_AGENT}, timeout=6.0)
        if response.status_code != 200:
            return None
        payload = response.json()
    except Exception:
        logger.warning("Live OFF lookup failed for %s", code, exc_info=True)
        return None
    product = payload.get("product") if payload.get("status") in (1, "success_with_warnings", "success") else None
    if not product:
        return None
    row = off_row_from_product({**product, "code": product.get("code") or code})
    if row is None:
        return None
    # Cached for good; the daily delta sync embeds it so it also shows up in search.
    try:
        columns = ", ".join(ROW_COLUMNS)
        values = ", ".join(f"CAST(:{column} AS jsonb)" if column == "nutrients" else f":{column}" for column in ROW_COLUMNS)
        with _engine().begin() as conn:
            stored = conn.execute(text(f"""
                INSERT INTO foods ({columns}) VALUES ({values})
                ON CONFLICT (source, source_id) DO NOTHING
                RETURNING id
            """), row).fetchone()
        logger.info("Stored live OFF product %s (%s)", row["source_id"], "new" if stored else "exists")
    except Exception:
        logger.warning("Could not cache live OFF product %s", code, exc_info=True)
    return get_food("off", row["source_id"]) or {**row, "id": None, "nutrients": json.loads(row["nutrients"])}


def servings(food: dict[str, Any]) -> list[dict[str, Any]]:
    """Quick amount choices: portion and package from OFF, always 100 g/ml."""
    unit = food.get("unit") or "g"
    options: list[dict[str, Any]] = []
    serving = _round(food.get("serving_g"))
    if serving and serving > 0:
        label = food.get("serving_label") or ""
        options.append({"label": "1 Portion", "detail": label if label and str(int(serving)) in label else f"{serving:g} {unit}", "amount": serving})
    package = _round(food.get("package_g"))
    if package and package > 0 and package != serving and package <= 3000:
        options.append({"label": "Packung", "detail": food.get("quantity_label") or f"{package:g} {unit}", "amount": package})
    options.append({"label": f"100 {unit}", "detail": None, "amount": 100.0})
    return options


def detail(food: dict[str, Any], history: dict[tuple[str, str], int] | None = None) -> dict[str, Any]:
    nutrients = food.get("nutrients") or []
    return {
        **summary(food, history),
        "name_alt": food.get("name_alt"),
        "sugar": _round(food.get("sugar")),
        "fiber": _round(food.get("fiber")),
        "saturated": _round(food.get("saturated")),
        "salt": _round(food.get("salt"), 2),
        "nutrients": nutrients if isinstance(nutrients, list) else [],
        "package_g": _round(food.get("package_g")),
        "quantity_label": food.get("quantity_label"),
        "ingredients": food.get("ingredients"),
        "allergens": [tag.split(":", 1)[-1].replace("-", " ") for tag in (food.get("allergens") or "").split(",") if tag],
        "quality": food.get("quality"),
        "servings": servings(food),
        "attribution": "Max Rubner-Institut, Bundeslebensmittelschlüssel 4.0 (CC BY 4.0)" if food["source"] == "bls"
                       else "Open Food Facts (ODbL)",
    }
