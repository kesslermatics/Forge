"""Build or refresh the Forge food catalog (BLS 4.0 + Open Food Facts Germany) with embeddings.

The catalog lives in its own Postgres (pgvector) database and can always be rebuilt from the
public sources, so it holds no personal data. Personal diary entries in the Forge database keep
their own nutrient snapshot and only reference catalog rows loosely by (source, source_id).

Sources and licences
  * BLS 4.0, Max Rubner-Institut (2025), CC BY 4.0, DOI 10.25826/Data20251217-134202-0
  * Open Food Facts product database, ODbL 1.0 (official Parquet export on Hugging Face)

A run is idempotent:
  1. ensure schema and extensions
  2. upsert BLS and OFF rows (a full run also removes OFF rows that disappeared upstream)
  3. embed every searchable row whose embedding text changed since the last run
  4. build indexes and ANALYZE

Usage (from backend/):
  pip install -r tools/requirements-food-import.txt
  FOOD_CATALOG_DATABASE_URL=postgresql://... OPENROUTER_API_KEY=... \
    python tools/food_catalog_import.py [--bls-xlsx PATH] [--off-parquet PATH] [--skip-embeddings]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import logging
import math
import os
import re
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import duckdb
import httpx
import numpy as np
import pandas as pd
import psycopg
from dotenv import load_dotenv
from openai import OpenAI
from pgvector.psycopg import register_vector
from pgvector.utils import HalfVector

log = logging.getLogger("food_catalog_import")

EMBEDDING_MODEL = os.getenv("FOOD_EMBEDDING_MODEL", "google/gemini-embedding-2")
EMBEDDING_DIMENSIONS = int(os.getenv("FOOD_EMBEDDING_DIMENSIONS", "768"))
OFF_PARQUET_URL = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet?download=true"
BLS_DOWNLOAD_PAGE = "https://blsdb.de/download"
USER_AGENT = "ForgeFoodCatalog/1.0 (private, non-commercial; contact via forge.kesslermatics.com)"

# BLS codes that are stored as first-class columns instead of the extra nutrient list.
BLS_CORE = {"ENERCC": "kcal", "PROT625": "protein", "CHO": "carbs", "FAT": "fat", "SUGAR": "sugar",
            "FIBT": "fiber", "FASAT": "saturated", "NACL": "salt"}
# Energy in kJ and nitrogen duplicate information that the UI never needs.
BLS_SKIP = {"ENERCJ", "NT"}

# Open Food Facts nutriments worth showing. OFF normalises every "100g" value to grams,
# so the factor converts grams into the display unit.
OFF_EXTRA = {
    "monounsaturated-fat": ("Einfach ungesättigte Fettsäuren", "g", 1, "Fette"),
    "polyunsaturated-fat": ("Mehrfach ungesättigte Fettsäuren", "g", 1, "Fette"),
    "trans-fat": ("Transfettsäuren", "g", 1, "Fette"),
    "omega-3-fat": ("Omega-3-Fettsäuren", "g", 1, "Fette"),
    "cholesterol": ("Cholesterin", "mg", 1e3, "Fette"),
    "starch": ("Stärke", "g", 1, "Kohlenhydrate"),
    "lactose": ("Laktose", "g", 1, "Kohlenhydrate"),
    "polyols": ("Mehrwertige Alkohole", "g", 1, "Kohlenhydrate"),
    "added-sugars": ("Zugesetzter Zucker", "g", 1, "Kohlenhydrate"),
    "alcohol": ("Alkohol", "g", 1, "Sonstiges"),
    "caffeine": ("Koffein", "mg", 1e3, "Sonstiges"),
    "sodium": ("Natrium", "mg", 1e3, "Mineralstoffe"),
    "potassium": ("Kalium", "mg", 1e3, "Mineralstoffe"),
    "calcium": ("Calcium", "mg", 1e3, "Mineralstoffe"),
    "magnesium": ("Magnesium", "mg", 1e3, "Mineralstoffe"),
    "phosphorus": ("Phosphor", "mg", 1e3, "Mineralstoffe"),
    "iron": ("Eisen", "mg", 1e3, "Mineralstoffe"),
    "zinc": ("Zink", "mg", 1e3, "Mineralstoffe"),
    "iodine": ("Iod", "µg", 1e6, "Mineralstoffe"),
    "selenium": ("Selen", "µg", 1e6, "Mineralstoffe"),
    "copper": ("Kupfer", "mg", 1e3, "Mineralstoffe"),
    "manganese": ("Mangan", "mg", 1e3, "Mineralstoffe"),
    "vitamin-a": ("Vitamin A", "µg", 1e6, "Vitamine"),
    "vitamin-d": ("Vitamin D", "µg", 1e6, "Vitamine"),
    "vitamin-e": ("Vitamin E", "mg", 1e3, "Vitamine"),
    "vitamin-k": ("Vitamin K", "µg", 1e6, "Vitamine"),
    "vitamin-c": ("Vitamin C", "mg", 1e3, "Vitamine"),
    "vitamin-b1": ("Vitamin B1", "mg", 1e3, "Vitamine"),
    "vitamin-b2": ("Vitamin B2", "mg", 1e3, "Vitamine"),
    "vitamin-pp": ("Niacin", "mg", 1e3, "Vitamine"),
    "vitamin-b6": ("Vitamin B6", "mg", 1e3, "Vitamine"),
    "vitamin-b9": ("Folat", "µg", 1e6, "Vitamine"),
    "vitamin-b12": ("Vitamin B12", "µg", 1e6, "Vitamine"),
    "biotin": ("Biotin", "µg", 1e6, "Vitamine"),
    "pantothenic-acid": ("Pantothensäure", "mg", 1e3, "Vitamine"),
}

SCHEMA_SQL = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    "CREATE EXTENSION IF NOT EXISTS unaccent",
    # unaccent() is only STABLE; generated columns and indexes need an IMMUTABLE wrapper.
    """CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
       LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
       $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$""",
    f"""CREATE TABLE IF NOT EXISTS foods (
      id            bigserial PRIMARY KEY,
      source        text NOT NULL CHECK (source IN ('bls', 'off')),
      source_id     text NOT NULL,
      name          text NOT NULL,
      name_alt      text,
      brand         text,
      category      text,
      unit          text NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'ml')),
      kcal          double precision,
      protein       double precision,
      carbs         double precision,
      fat           double precision,
      sugar         double precision,
      fiber         double precision,
      saturated     double precision,
      salt          double precision,
      nutrients     jsonb NOT NULL DEFAULT '[]'::jsonb,
      serving_g     double precision,
      serving_label text,
      package_g     double precision,
      quantity_label text,
      ingredients   text,
      allergens     text,
      scans         integer NOT NULL DEFAULT 0,
      completeness  real,
      quality       text NOT NULL DEFAULT 'ok' CHECK (quality IN ('ok', 'incomplete', 'suspect')),
      countries     text,
      search_text   text GENERATED ALWAYS AS (
                      lower(f_unaccent(name || ' ' || coalesce(brand, '') || ' ' || coalesce(name_alt, '')))
                    ) STORED,
      embed_text    text,
      embed_hash    text,
      embedding     halfvec({EMBEDDING_DIMENSIONS}),
      seen_run      bigint,
      updated_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, source_id)
    )""",
    """CREATE TABLE IF NOT EXISTS import_runs (
      id          bigserial PRIMARY KEY,
      started_at  timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      status      text NOT NULL DEFAULT 'running',
      details     jsonb
    )""",
    """CREATE TABLE IF NOT EXISTS catalog_meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    )""",
]

INDEX_SQL = [
    "CREATE INDEX IF NOT EXISTS foods_search_trgm ON foods USING gin (search_text gin_trgm_ops)",
    "CREATE INDEX IF NOT EXISTS foods_source_id ON foods (source_id)",
    "CREATE INDEX IF NOT EXISTS foods_quality ON foods (quality)",
    # Approximate nearest neighbour search over cosine distance; vectors are L2-normalised.
    "CREATE INDEX IF NOT EXISTS foods_embedding_hnsw ON foods USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)",
]

STAGE_COLUMNS = [
    "source", "source_id", "name", "name_alt", "brand", "category", "unit", "kcal", "protein", "carbs", "fat",
    "sugar", "fiber", "saturated", "salt", "nutrients", "serving_g", "serving_label", "package_g", "quantity_label",
    "ingredients", "allergens", "scans", "completeness", "quality", "countries", "embed_text", "embed_hash",
]


# ── helpers ──────────────────────────────────────────────────────────────────────

def clean_text(value, limit: int | None = None) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text:
        return None
    return text[:limit] if limit else text


def clean_brand(value) -> str | None:
    """'Nutella, Ferrero, FERRERO' -> 'Nutella, Ferrero' (dedupe case-insensitively, keep two)."""
    text = clean_text(value)
    if not text:
        return None
    seen, parts = set(), []
    for part in text.split(","):
        part = part.strip()
        if part and part.lower() not in seen:
            seen.add(part.lower())
            parts.append(part)
    return ", ".join(parts[:2])[:120] or None


def embed_text_for(name: str, brand: str | None, name_alt: str | None) -> str:
    parts = [name]
    if brand:
        parts.append(brand)
    if name_alt and name_alt.lower() != name.lower():
        parts.append(name_alt)
    return " | ".join(parts)


def text_hash(value: str) -> str:
    return hashlib.sha1(f"{EMBEDDING_MODEL}|{EMBEDDING_DIMENSIONS}|{value}".encode("utf-8")).hexdigest()


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def quality_for(kcal, protein, carbs, fat) -> str:
    if None in (kcal, protein, carbs, fat):
        return "incomplete"
    if min(kcal, protein, carbs, fat) < 0 or protein + carbs + fat > 100.5 or kcal > 900:
        return "suspect"
    if kcal > 20 and abs(kcal - (4 * protein + 4 * carbs + 9 * fat)) > 0.25 * kcal:
        return "suspect"
    return "ok"


# ── BLS ──────────────────────────────────────────────────────────────────────────

def download_bls(target_dir: Path) -> Path:
    """Fetch the BLS 4.0 ZIP. The site hands out a per-session token in the download link."""
    with httpx.Client(follow_redirects=True, timeout=120, headers={"User-Agent": USER_AGENT}) as client:
        page = client.get(BLS_DOWNLOAD_PAGE).text
        match = re.search(r"BLS&#95;4&#95;0&#95;2025&#95;DE&#46;zip\?token=([A-Z0-9-]+)", page)
        if not match:
            raise RuntimeError("BLS download link not found on blsdb.de/download")
        archive = client.get(f"https://blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip?token={match.group(1)}")
        archive.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(archive.content)) as zf:
        member = next(name for name in zf.namelist() if name.endswith("Daten_2025_DE.xlsx"))
        components = next(name for name in zf.namelist() if name.endswith("Components_DE_EN.xlsx"))
        zf.extract(member, target_dir)
        zf.extract(components, target_dir)
    return target_dir / member


def bls_number(value) -> float | None:
    """Excel cell -> float. Trace and below-detection markers count as 0, '-' as missing."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text.upper() == "TR" or text.startswith("<"):
        return 0.0
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def load_bls(xlsx: Path) -> list[dict]:
    components_path = next(xlsx.parent.glob("*Components_DE_EN.xlsx"), None)
    groups: dict[str, str] = {}
    if components_path:
        # keep_default_na=False: the sodium code is literally "NA".
        components = pd.read_excel(components_path, keep_default_na=False, na_values=[""])
        for _, row in components.iterrows():
            code = str(row.get("Nährstoffcode / Component code") or "").strip()
            group = str(row.get("Nährstoffgruppe") or "").split(";")[-1].strip()
            if code:
                groups[code] = group or "Sonstiges"

    frame = pd.read_excel(xlsx, keep_default_na=False, na_values=[""])
    pattern = re.compile(r"^(\S+) (.+) \[(.+)/100g\]$")
    columns = []
    for column in frame.columns:
        match = pattern.match(str(column))
        if match:
            columns.append((match.group(1), match.group(2).strip(), match.group(3), column))

    rows = []
    for _, record in frame.iterrows():
        values = {code: bls_number(record[column]) for code, _, _, column in columns}
        extras = [
            {"k": code, "l": label, "u": unit, "v": round(values[code], 4), "g": groups.get(code, "Sonstiges")}
            for code, label, unit, _ in columns
            if code not in BLS_CORE and code not in BLS_SKIP and values.get(code) is not None
        ]
        name = clean_text(record["Lebensmittelbezeichnung"], 300)
        if not name:
            continue
        name_alt = clean_text(record.get("Food name"), 300)
        core = {field: values.get(code) for code, field in BLS_CORE.items()}
        text = embed_text_for(name, None, name_alt)
        rows.append({
            "source": "bls", "source_id": str(record["BLS Code"]).strip(), "name": name, "name_alt": name_alt,
            "brand": None, "category": str(record["BLS Code"]).strip()[:1], "unit": "g", **core,
            "nutrients": json.dumps(extras, ensure_ascii=False), "serving_g": None, "serving_label": None,
            "package_g": None, "quantity_label": None, "ingredients": None, "allergens": None, "scans": 0,
            # BLS is the reference: its energy includes alcohol, fibre and polyols, so the
            # 4/4/9 plausibility check used for crowd-sourced OFF data does not apply.
            "completeness": 1.0,
            "quality": "incomplete" if None in (core["kcal"], core["protein"], core["carbs"], core["fat"]) else "ok",
            "countries": "en:germany", "embed_text": text, "embed_hash": text_hash(text),
        })
    return rows


# ── Open Food Facts ──────────────────────────────────────────────────────────────

def download_off(target_dir: Path) -> Path:
    path = target_dir / "food.parquet"
    log.info("downloading OFF parquet (~8 GB) to %s", path)
    with httpx.stream("GET", OFF_PARQUET_URL, follow_redirects=True, timeout=None, headers={"User-Agent": USER_AGENT}) as response:
        response.raise_for_status()
        with open(path, "wb") as handle:
            for chunk in response.iter_bytes(1 << 22):
                handle.write(chunk)
    return path


def extract_off(parquet: Path, csv_path: Path, limit: int | None) -> int:
    """Flatten German-relevant products into a CSV in Python-friendly raw form (one pass with DuckDB)."""
    extra_names = ", ".join(f"'{name}'" for name in OFF_EXTRA)
    con = duckdb.connect()
    con.execute(f"SET threads TO {max(2, (os.cpu_count() or 4) - 2)}; SET memory_limit='6GB'; SET preserve_insertion_order=false;")
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    con.execute(f"""
    COPY (
      WITH base AS (
        SELECT * FROM read_parquet('{parquet}')
        WHERE NOT coalesce(obsolete, false)
          AND (list_contains(countries_tags, 'en:germany')
               OR (length(code) = 13 AND regexp_matches(code, '^4[0-4]')))
        QUALIFY row_number() OVER (PARTITION BY code ORDER BY last_modified_t DESC NULLS LAST) = 1
      )
      SELECT code,
        list_filter(product_name, x -> x.lang = 'de')[1].text AS name_de,
        list_filter(product_name, x -> x.lang = 'main')[1].text AS name_main,
        brands,
        categories_tags[-1] AS category,
        product_quantity_unit AS quantity_unit,
        quantity,
        try_cast(product_quantity AS DOUBLE) AS package_g,
        try_cast(serving_quantity AS DOUBLE) AS serving_g,
        serving_size,
        list_filter(nutriments, x -> x.name = 'energy-kcal')[1]."100g" AS kcal,
        list_filter(nutriments, x -> x.name = 'proteins')[1]."100g" AS protein,
        list_filter(nutriments, x -> x.name = 'carbohydrates')[1]."100g" AS carbs,
        list_filter(nutriments, x -> x.name = 'fat')[1]."100g" AS fat,
        list_filter(nutriments, x -> x.name = 'sugars')[1]."100g" AS sugar,
        list_filter(nutriments, x -> x.name = 'fiber')[1]."100g" AS fiber,
        list_filter(nutriments, x -> x.name = 'saturated-fat')[1]."100g" AS saturated,
        list_filter(nutriments, x -> x.name = 'salt')[1]."100g" AS salt,
        to_json(list_transform(list_filter(nutriments, x -> x.name IN ({extra_names}) AND x."100g" IS NOT NULL),
                               x -> {{'n': x.name, 'v': x."100g"}})) AS extras,
        coalesce(list_filter(ingredients_text, x -> x.lang = 'de')[1].text,
                 list_filter(ingredients_text, x -> x.lang = 'main')[1].text) AS ingredients,
        array_to_string(allergens_tags, ',') AS allergens,
        coalesce(unique_scans_n, 0) AS scans,
        completeness,
        array_to_string(countries_tags[1:6], ',') AS countries
      FROM base {limit_sql}
    ) TO '{csv_path}' (FORMAT CSV, HEADER true)
    """)
    return con.execute(f"SELECT count(*) FROM read_csv_auto('{csv_path}')").fetchone()[0]


def off_rows(csv_path: Path):
    """Yield normalised catalog rows from the flattened OFF CSV."""
    for chunk in pd.read_csv(csv_path, dtype={"code": str}, chunksize=50_000, keep_default_na=False, na_values=[""]):
        for record in chunk.to_dict("records"):
            code = clean_text(record.get("code"))
            name_de = clean_text(record.get("name_de"), 300)
            name_main = clean_text(record.get("name_main"), 300)
            name = name_de or name_main
            if not code or not name:
                continue
            brand = clean_brand(record.get("brands"))
            core = {field: finite(record.get(field)) for field in ("kcal", "protein", "carbs", "fat", "sugar", "fiber", "saturated", "salt")}
            extras = []
            try:
                for item in json.loads(record.get("extras") or "[]") or []:
                    meta = OFF_EXTRA.get(item.get("n"))
                    value = finite(item.get("v"))
                    if meta and value is not None and value >= 0:
                        label, unit, factor, group = meta
                        extras.append({"k": item["n"], "l": label, "u": unit, "v": round(value * factor, 4), "g": group})
            except (TypeError, ValueError):
                extras = []
            quantity = clean_text(record.get("quantity"), 60)
            unit_raw = (clean_text(record.get("quantity_unit")) or "").lower()
            serving_label = clean_text(record.get("serving_size"), 60)
            is_liquid = unit_raw in {"ml", "cl", "l"} or bool(re.search(r"\d\s*(ml|cl|l)\b", f"{quantity or ''} {serving_label or ''}", re.I))
            serving_g = finite(record.get("serving_g"))
            package_g = finite(record.get("package_g"))
            name_alt = name_main if name_de and name_main and name_main.lower() != name_de.lower() else None
            text = embed_text_for(name, brand, name_alt)
            yield {
                "source": "off", "source_id": code, "name": name, "name_alt": name_alt, "brand": brand,
                "category": clean_text(record.get("category"), 120), "unit": "ml" if is_liquid else "g", **core,
                "nutrients": json.dumps(extras, ensure_ascii=False),
                "serving_g": serving_g if serving_g and 0 < serving_g <= 2000 else None,
                "serving_label": serving_label,
                "package_g": package_g if package_g and 0 < package_g <= 10000 else None,
                "quantity_label": quantity,
                "ingredients": clean_text(record.get("ingredients"), 3000),
                "allergens": clean_text(record.get("allergens"), 500),
                "scans": int(finite(record.get("scans")) or 0),
                "completeness": finite(record.get("completeness")),
                "quality": quality_for(core["kcal"], core["protein"], core["carbs"], core["fat"]),
                "countries": clean_text(record.get("countries"), 300),
                "embed_text": text, "embed_hash": text_hash(text),
            }


# ── database writes ──────────────────────────────────────────────────────────────

def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        for statement in SCHEMA_SQL:
            cur.execute(statement)
        cur.execute("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'foods'::regclass AND attname = 'embedding'")
        current = cur.fetchone()[0]
        if current != f"halfvec({EMBEDDING_DIMENSIONS})":
            raise RuntimeError(f"foods.embedding is {current}, expected halfvec({EMBEDDING_DIMENSIONS}); rebuild the catalog to change dimensions")
        cur.execute(
            "INSERT INTO catalog_meta (key, value) VALUES ('embedding_model', %s), ('embedding_dimensions', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (EMBEDDING_MODEL, str(EMBEDDING_DIMENSIONS)),
        )
    conn.commit()


def upsert_rows(conn: psycopg.Connection, rows, run_id: int, label: str) -> int:
    """COPY rows into a temp stage table, then upsert. Embeddings survive when the text is unchanged."""
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS foods_stage")
        cur.execute("CREATE TEMP TABLE foods_stage (LIKE foods INCLUDING DEFAULTS) ON COMMIT PRESERVE ROWS")
        cur.execute("ALTER TABLE foods_stage DROP COLUMN search_text, DROP COLUMN id, DROP COLUMN embedding, DROP COLUMN seen_run, DROP COLUMN updated_at")
        count = 0
        with cur.copy(f"COPY foods_stage ({', '.join(STAGE_COLUMNS)}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row([row[column] for column in STAGE_COLUMNS])
                count += 1
                if count % 100_000 == 0:
                    log.info("%s: staged %d rows", label, count)
        update_columns = [column for column in STAGE_COLUMNS if column not in ("source", "source_id", "embed_hash")]
        assignments = ", ".join(f"{column} = EXCLUDED.{column}" for column in update_columns)
        cur.execute(f"""
            INSERT INTO foods ({', '.join(STAGE_COLUMNS)}, seen_run)
            SELECT {', '.join(STAGE_COLUMNS)}, %s FROM foods_stage
            ON CONFLICT (source, source_id) DO UPDATE SET {assignments},
              embedding  = CASE WHEN foods.embed_hash = EXCLUDED.embed_hash THEN foods.embedding ELSE NULL END,
              embed_hash = EXCLUDED.embed_hash,
              seen_run   = EXCLUDED.seen_run,
              updated_at = now()
        """, (run_id,))
        cur.execute("DROP TABLE foods_stage")
    conn.commit()
    log.info("%s: upserted %d rows", label, count)
    return count


def embed_pending(conn: psycopg.Connection, api_key: str, base_url: str, batch_size: int, workers: int, max_rows: int | None) -> int:
    """Embed searchable rows without a current embedding. Resumable: progress is committed per chunk."""
    client = OpenAI(api_key=api_key, base_url=base_url, max_retries=6, timeout=120)
    register_vector(conn)

    def embed_batch(batch: list[tuple[int, str]]) -> list[tuple[int, HalfVector]]:
        for attempt in range(6):
            try:
                response = client.embeddings.create(model=EMBEDDING_MODEL, input=[text for _, text in batch],
                                                    dimensions=EMBEDDING_DIMENSIONS, encoding_format="float")
                vectors = sorted(response.data, key=lambda item: item.index)
                if len(vectors) != len(batch):
                    raise RuntimeError(f"expected {len(batch)} embeddings, got {len(vectors)}")
                out = []
                for (row_id, _), item in zip(batch, vectors):
                    arr = np.asarray(item.embedding, dtype=np.float32)
                    norm = float(np.linalg.norm(arr))
                    out.append((row_id, HalfVector(arr / norm if norm > 0 else arr)))
                return out
            except Exception as exc:  # network hiccups and provider rate limits
                wait = min(60, 2 ** attempt * 2)
                log.warning("embedding batch failed (%s), retry in %ss", exc, wait)
                time.sleep(wait)
        raise RuntimeError("embedding batch failed repeatedly")

    total = 0
    chunk_rows = batch_size * workers * 4
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE IF NOT EXISTS emb_stage (id bigint PRIMARY KEY, embedding halfvec(%s))" % EMBEDDING_DIMENSIONS)
    conn.commit()
    started = time.time()
    while True:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, embed_text FROM foods
                           WHERE embedding IS NULL AND quality = 'ok' AND embed_text IS NOT NULL
                           ORDER BY source, scans DESC, id LIMIT %s""", (chunk_rows,))
            pending = cur.fetchall()
        if max_rows is not None:
            pending = pending[: max(0, max_rows - total)]
        if not pending:
            break
        batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
        results: list[tuple[int, HalfVector]] = []
        with cf.ThreadPoolExecutor(workers) as pool:
            for part in pool.map(embed_batch, batches):
                results.extend(part)
        with conn.cursor() as cur:
            cur.execute("TRUNCATE emb_stage")
            with cur.copy("COPY emb_stage (id, embedding) FROM STDIN WITH (FORMAT BINARY)") as copy:
                copy.set_types(["int8", "halfvec"])
                for row in results:
                    copy.write_row(row)
            cur.execute("UPDATE foods f SET embedding = s.embedding FROM emb_stage s WHERE f.id = s.id")
        conn.commit()
        total += len(results)
        rate = total / max(time.time() - started, 1)
        log.info("embedded %d rows (%.0f rows/s)", total, rate)
        if max_rows is not None and total >= max_rows:
            break
    return total


def main() -> int:
    load_dotenv(os.getenv("FOOD_IMPORT_ENV_FILE") or None)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-url", default=os.getenv("FOOD_CATALOG_DATABASE_URL"))
    parser.add_argument("--bls-xlsx", type=Path, help="local BLS_4_0_Daten_2025_DE.xlsx (downloaded when omitted)")
    parser.add_argument("--off-parquet", type=Path, help="local OFF food.parquet (downloaded when omitted)")
    parser.add_argument("--skip-bls", action="store_true")
    parser.add_argument("--skip-off", action="store_true")
    parser.add_argument("--off-limit", type=int, help="only import the first N OFF rows (testing; disables deletions)")
    parser.add_argument("--skip-embeddings", action="store_true")
    parser.add_argument("--embed-limit", type=int, help="embed at most N rows in this run (testing)")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.database_url:
        parser.error("FOOD_CATALOG_DATABASE_URL or --database-url is required")
    api_key = os.getenv("OPENROUTER_API_KEY")
    base_url = os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
    if not args.skip_embeddings and not api_key:
        parser.error("OPENROUTER_API_KEY is required for embeddings (or pass --skip-embeddings)")

    details: dict = {"embedding_model": EMBEDDING_MODEL, "dimensions": EMBEDDING_DIMENSIONS}
    with tempfile.TemporaryDirectory(prefix="food-import-") as tmp, psycopg.connect(args.database_url) as conn:
        tmp_dir = Path(tmp)
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO import_runs DEFAULT VALUES RETURNING id")
            run_id = cur.fetchone()[0]
        conn.commit()
        try:
            if not args.skip_bls:
                xlsx = args.bls_xlsx or download_bls(tmp_dir)
                details["bls_rows"] = upsert_rows(conn, load_bls(xlsx), run_id, "BLS")
            if not args.skip_off:
                parquet = args.off_parquet or download_off(tmp_dir)
                csv_path = tmp_dir / "off_de.csv"
                log.info("extracting OFF rows with DuckDB")
                details["off_extracted"] = extract_off(parquet, csv_path, args.off_limit)
                details["off_rows"] = upsert_rows(conn, off_rows(csv_path), run_id, "OFF")
                if not args.off_limit:
                    with conn.cursor() as cur:
                        # Products cached from the live OFF API (seen_run NULL) may be missing from the
                        # export; keep them so a scanned barcode never disappears again.
                        cur.execute("DELETE FROM foods WHERE source = 'off' AND seen_run IS NOT NULL AND seen_run <> %s", (run_id,))
                        details["off_removed"] = cur.rowcount
                    conn.commit()
            if not args.skip_embeddings:
                details["embedded"] = embed_pending(conn, api_key, base_url, args.batch_size, args.workers, args.embed_limit)
            log.info("building indexes")
            with conn.cursor() as cur:
                cur.execute("SET maintenance_work_mem = '512MB'")
                # Parallel index builds allocate dynamic shared memory, which exceeds Docker's
                # default 64 MB /dev/shm; a serial build uses process-local memory instead.
                cur.execute("SET max_parallel_maintenance_workers = 0")
                for statement in INDEX_SQL:
                    cur.execute(statement)
                cur.execute("ANALYZE foods")
                cur.execute("SELECT source, quality, count(*), count(embedding) FROM foods GROUP BY 1, 2 ORDER BY 1, 2")
                details["counts"] = [list(row) for row in cur.fetchall()]
                cur.execute("SELECT pg_size_pretty(pg_total_relation_size('foods'))")
                details["size"] = cur.fetchone()[0]
                cur.execute("UPDATE import_runs SET finished_at = clock_timestamp(), status = 'done', details = %s WHERE id = %s",
                            (json.dumps(details), run_id))
            conn.commit()
        except Exception:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("UPDATE import_runs SET finished_at = clock_timestamp(), status = 'failed', details = %s WHERE id = %s",
                            (json.dumps(details), run_id))
            conn.commit()
            raise
    log.info("done: %s", json.dumps(details))
    return 0


if __name__ == "__main__":
    sys.exit(main())
