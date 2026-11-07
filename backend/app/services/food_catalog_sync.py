"""Daily Open Food Facts delta sync for the food catalog.

Open Food Facts publishes one JSONL file per day with every product changed since the previous
file (https://static.openfoodfacts.org/data/delta/, kept for about two weeks). This job applies
all files newer than the stored watermark, keeps German products (country tag or GS1 prefix
400-440), removes products marked obsolete and embeds rows whose name text changed.

Run inside the backend container (Dokploy schedule):
    python -m app.services.food_catalog_sync

Idempotent and resumable: the watermark advances per file, embeddings are only created for rows
without one. The yearly BLS update stays a manual run of tools/food_catalog_import.py.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import json
import logging
import math
import re
import sys
import time
from typing import Any, Iterator

import httpx
from openai import OpenAI
from psycopg2.extras import execute_values

from app.config import settings
from app.services import food_catalog
from app.services.food_catalog_rows import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, ROW_COLUMNS, is_german, off_row_from_product

log = logging.getLogger("food_catalog_sync")

DELTA_BASE = "https://static.openfoodfacts.org/data/delta/"
DELTA_FILE = re.compile(r"^openfoodfacts_products_(\d+)_(\d+)\.json\.gz$")
USER_AGENT = "ForgeFoodCatalog/1.0 (private, non-commercial; contact via forge.kesslermatics.com)"
WATERMARK_KEY = "off_delta_until"
LOCK_ID = 74_211_903  # pg advisory lock: one sync at a time
BATCH = 500
EMBED_BATCH = 100
EMBED_WORKERS = 4
EMBED_MAX_PER_RUN = 30_000

_UPDATE_COLUMNS = [column for column in ROW_COLUMNS if column not in ("source", "source_id", "embed_hash")]
_UPSERT_SQL = f"""
    INSERT INTO foods ({", ".join(ROW_COLUMNS)}, seen_run) VALUES %s
    ON CONFLICT (source, source_id) DO UPDATE SET {", ".join(f"{column} = EXCLUDED.{column}" for column in _UPDATE_COLUMNS)},
      embedding  = CASE WHEN foods.embed_hash = EXCLUDED.embed_hash THEN foods.embedding ELSE NULL END,
      embed_hash = EXCLUDED.embed_hash,
      updated_at = now()
"""
# New rows carry the sync run as seen_run, so a later full import removes them again if they are
# missing upstream; existing rows keep theirs (live-cached barcodes stay NULL and are never removed).
_UPSERT_TEMPLATE = "(" + ", ".join("%s::jsonb" if column == "nutrients" else "%s" for column in ROW_COLUMNS) + ", %s)"


def delta_files(client: httpx.Client) -> list[tuple[int, int, str]]:
    response = client.get(DELTA_BASE + "index.txt")
    response.raise_for_status()
    files = []
    for line in response.text.split():
        match = DELTA_FILE.match(line.strip())
        if match:
            files.append((int(match.group(1)), int(match.group(2)), line.strip()))
    return sorted(files)


def products(client: httpx.Client, name: str) -> Iterator[dict[str, Any]]:
    """Stream one gzipped JSONL delta file without holding it in memory."""
    with client.stream("GET", DELTA_BASE + name) as response:
        response.raise_for_status()
        decompressor = gzip.GzipFile(fileobj=_StreamReader(response.iter_bytes(1 << 16)))
        for line in decompressor:
            if line.strip():
                yield json.loads(line)


class _StreamReader:
    """Minimal file-like adapter so GzipFile can read an httpx byte stream."""

    def __init__(self, chunks: Iterator[bytes]):
        self._chunks = chunks
        self._buffer = b""

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buffer) < size:
            try:
                self._buffer += next(self._chunks)
            except StopIteration:
                break
        if size < 0:
            data, self._buffer = self._buffer, b""
        else:
            data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data


def _watermark(cur) -> int:
    cur.execute("SELECT value FROM catalog_meta WHERE key = %s", (WATERMARK_KEY,))
    row = cur.fetchone()
    if row:
        return int(row[0])
    # First sync: start a few days before the last full import, since the Parquet export lags.
    cur.execute("""SELECT extract(epoch FROM started_at)::bigint FROM import_runs
                   WHERE status = 'done' AND details ? 'off_rows' ORDER BY id DESC LIMIT 1""")
    row = cur.fetchone()
    return (row[0] - 3 * 86_400) if row else 0


def _apply_file(conn, client: httpx.Client, name: str, run_id: int) -> dict[str, int]:
    stats = {"products": 0, "german": 0, "upserted": 0, "removed": 0}
    pending: dict[str, dict[str, Any]] = {}
    obsolete: set[str] = set()

    def flush():
        with conn.cursor() as cur:
            if pending:
                rows = [[row[column] for column in ROW_COLUMNS] + [run_id] for row in pending.values()]
                execute_values(cur, _UPSERT_SQL, rows, template=_UPSERT_TEMPLATE, page_size=BATCH)
                stats["upserted"] += len(rows)
                pending.clear()
            if obsolete:
                cur.execute("DELETE FROM foods WHERE source = 'off' AND source_id = ANY(%s)", (list(obsolete),))
                stats["removed"] += cur.rowcount
                obsolete.clear()

    for product in products(client, name):
        stats["products"] += 1
        if not is_german(product):
            continue
        stats["german"] += 1
        code = str(product.get("code") or "").strip()
        if product.get("obsolete") or product.get("product_type") not in (None, "food"):
            if code:
                obsolete.add(code)
                pending.pop(code, None)
            continue
        row = off_row_from_product(product)
        if row is None:
            continue
        obsolete.discard(row["source_id"])
        pending[row["source_id"]] = row  # last version of a code within the file wins
        if len(pending) >= BATCH:
            flush()
    flush()
    return stats


def _vector_literal(values: list[float]) -> str:
    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return "[" + ",".join(f"{value / norm:.6f}" for value in values) + "]"


def embed_pending(conn, limit: int = EMBED_MAX_PER_RUN) -> int:
    """Embed searchable rows without an embedding (new or renamed products)."""
    if not settings.openai_api_key:
        log.warning("OPENROUTER_API_KEY missing; skipping embeddings")
        return 0
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, max_retries=5, timeout=120)

    def embed(batch: list[tuple[int, str]]) -> list[tuple[int, str]]:
        for attempt in range(5):
            try:
                response = client.embeddings.create(model=EMBEDDING_MODEL, input=[text for _, text in batch],
                                                    dimensions=EMBEDDING_DIMENSIONS, encoding_format="float")
                vectors = sorted(response.data, key=lambda item: item.index)
                if len(vectors) != len(batch):
                    raise RuntimeError(f"expected {len(batch)} embeddings, got {len(vectors)}")
                return [(row_id, _vector_literal(item.embedding)) for (row_id, _), item in zip(batch, vectors)]
            except Exception as exc:  # rate limits and network hiccups
                wait = min(60, 2 ** attempt * 2)
                log.warning("embedding batch failed (%s), retry in %ss", exc, wait)
                time.sleep(wait)
        raise RuntimeError("embedding batch failed repeatedly")

    total = 0
    while total < limit:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, embed_text FROM foods
                           WHERE embedding IS NULL AND quality = 'ok' AND embed_text IS NOT NULL
                           ORDER BY scans DESC, id LIMIT %s""", (min(EMBED_BATCH * EMBED_WORKERS * 2, limit - total),))
            pending = cur.fetchall()
        if not pending:
            break
        batches = [pending[i:i + EMBED_BATCH] for i in range(0, len(pending), EMBED_BATCH)]
        results: list[tuple[int, str]] = []
        with cf.ThreadPoolExecutor(EMBED_WORKERS) as pool:
            for part in pool.map(embed, batches):
                results.extend(part)
        with conn.cursor() as cur:
            execute_values(cur, "UPDATE foods f SET embedding = v.e::halfvec FROM (VALUES %s) AS v(id, e) WHERE f.id = v.id",
                           results, template="(%s::bigint, %s)")
        conn.commit()
        total += len(results)
    return total


def run(max_files: int | None = None) -> dict[str, Any]:
    details: dict[str, Any] = {"kind": "off_delta", "files": [], "embedding_model": EMBEDDING_MODEL}
    conn = food_catalog._engine().raw_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,))
            if not cur.fetchone()[0]:
                log.info("another sync is running; nothing to do")
                return {"skipped": "locked"}
            cur.execute("INSERT INTO import_runs (details) VALUES (%s) RETURNING id", (json.dumps(details),))
            run_id = cur.fetchone()[0]
            watermark = _watermark(cur)
        conn.commit()
        try:
            with httpx.Client(timeout=httpx.Timeout(60, read=300), follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
                available = delta_files(client)
                if available and watermark and available[0][0] > watermark:
                    # Deltas are only kept ~2 weeks: changes in between are lost until a full import.
                    details["gap_since"] = watermark
                    log.warning("delta gap: oldest file starts after watermark %s; run a full import", watermark)
                files = [item for item in available if item[1] > watermark]
                if max_files is not None:
                    files = files[:max_files]
                log.info("watermark %s, %d delta file(s) to apply", watermark, len(files))
                for _, end, name in files:
                    started = time.time()
                    stats = _apply_file(conn, client, name, run_id)
                    with conn.cursor() as cur:
                        cur.execute("""INSERT INTO catalog_meta (key, value) VALUES (%s, %s)
                                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", (WATERMARK_KEY, str(end)))
                    conn.commit()
                    details["files"].append({"name": name, **stats, "seconds": round(time.time() - started, 1)})
                    log.info("%s: %s", name, stats)
            details["embedded"] = embed_pending(conn)
            with conn.cursor() as cur:
                cur.execute("ANALYZE foods")
                cur.execute("UPDATE import_runs SET finished_at = clock_timestamp(), status = 'done', details = %s WHERE id = %s",
                            (json.dumps(details), run_id))
            conn.commit()
        except Exception as exc:
            conn.rollback()
            details["error"] = str(exc)[:500]
            with conn.cursor() as cur:
                cur.execute("UPDATE import_runs SET finished_at = clock_timestamp(), status = 'failed', details = %s WHERE id = %s",
                            (json.dumps(details), run_id))
            conn.commit()
            raise
        finally:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
            conn.commit()
    finally:
        conn.close()
    log.info("done: %s", json.dumps(details))
    return details


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for name in ("httpx", "httpx2", "openai"):
        logging.getLogger(name).setLevel(logging.WARNING)
    max_files = int(sys.argv[1]) if len(sys.argv) > 1 else None
    run(max_files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
