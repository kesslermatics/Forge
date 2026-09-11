"""Normalize Forge machine profiles with pre-mutation backup and reporting.

Run from backend: python migrate_normalize_forge_machine_profiles.py
All database mutations and snapshot backfills run in one fail-closed transaction.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text
from app.database import engine

BACKUP_DIR = Path(__file__).resolve().parent / "migration_backups"
_NUMBER = r"\d+(?:[.,]\d{1,3})?"
_ITEM = rf"{_NUMBER}\s*(?:kg)?"
_SEPARATOR = r"(?:\s*,\s+|\s*;\s*|\s*/\s*|\s+)"
_PURE_LIST = re.compile(rf"^\s*{_ITEM}(?:{_SEPARATOR}{_ITEM})+\s*$", re.IGNORECASE)
_NUMBER_TOKEN = re.compile(_NUMBER)


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def extract_high_confidence_weights(notes: str | None) -> tuple[str, list[float] | None, str]:
    original = (notes or "").strip()
    if not original:
        return "no_notes", None, "notes are empty"
    if not _PURE_LIST.fullmatch(original):
        return "skipped_ambiguous", None, "not a pure delimited weight list"
    raw_values = [float(match.group(0).replace(",", ".")) for match in _NUMBER_TOKEN.finditer(original)]
    # Unitless legacy notes are accepted only when they still look unmistakably like
    # machine loads rather than positions: a sufficiently long ascending sequence
    # with either a fractional load or a value of at least 20 kg.
    has_load_signal = any(value != int(value) for value in raw_values) or max(raw_values, default=0) >= 20
    if len(raw_values) < 4 or raw_values != sorted(raw_values) or not has_load_signal:
        return "skipped_ambiguous", None, "unitless numbers lack a high-confidence ascending load pattern"
    values = sorted({round(value, 3) for value in raw_values})
    if not values or len(values) > 100 or any(not math.isfinite(value) or value <= 0 or value > 1000 for value in values):
        return "skipped_invalid", None, "weight list violates safety bounds"
    return "extracted", values, "high-confidence pure kg weight list"


def _load_profiles(connection) -> list[dict[str, Any]]:
    columns = {column["name"] for column in inspect(connection).get_columns("forge_machine_profiles")}
    selected = ["id", "user_id", "name", "model", "notes", "is_archived", "created_at", "updated_at"]
    selected += [name for name in ("loading_system", "load_basis", "available_weights_kg") if name in columns]
    return [dict(row) for row in connection.execute(text(
        f"SELECT {', '.join(selected)} FROM forge_machine_profiles ORDER BY created_at, id"
    )).mappings().all()]


def _write_files(profiles: list[dict[str, Any]], stamp: str) -> tuple[Path, Path, list[dict[str, Any]]]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"forge_machine_profiles_{stamp}.json"
    report_path = BACKUP_DIR / f"forge_machine_profiles_extraction_{stamp}.json"
    backup_path.write_text(json.dumps([_jsonable(row) for row in profiles], ensure_ascii=False, indent=2), encoding="utf-8")
    report = []
    for profile in profiles:
        existing = profile.get("available_weights_kg")
        if isinstance(existing, list) and existing:
            status, extracted, reason = "existing_preserved", None, "structured list already exists"
        else:
            status, extracted, reason = extract_high_confidence_weights(profile.get("notes"))
        report.append({
            "profile_id": str(profile["id"]),
            "original_notes": profile.get("notes"),
            "extraction_status": status,
            "extracted_list": extracted,
            "reason": reason,
        })
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path, report_path, report


DDL = [
    "ALTER TABLE forge_machine_profiles ADD COLUMN IF NOT EXISTS loading_system VARCHAR(16) NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE forge_machine_profiles ADD COLUMN IF NOT EXISTS load_basis VARCHAR(16) NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE forge_machine_profiles ADD COLUMN IF NOT EXISTS available_weights_kg JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE forge_session_exercises ADD COLUMN IF NOT EXISTS machine_profile_snapshot JSONB",
    """DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_forge_machine_profiles_loading_system') THEN ALTER TABLE forge_machine_profiles ADD CONSTRAINT ck_forge_machine_profiles_loading_system CHECK (loading_system IN ('selectorized','plate_loaded','fixed','other','unknown')); END IF; END $$""",
    """DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_forge_machine_profiles_load_basis') THEN ALTER TABLE forge_machine_profiles ADD CONSTRAINT ck_forge_machine_profiles_load_basis CHECK (load_basis IN ('displayed_total','per_side','unknown')); END IF; END $$""",
    """DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_forge_machine_profiles_available_weights_array') THEN ALTER TABLE forge_machine_profiles ADD CONSTRAINT ck_forge_machine_profiles_available_weights_array CHECK (jsonb_typeof(available_weights_kg)='array' AND jsonb_array_length(available_weights_kg)<=100); END IF; END $$""",
]

SNAPSHOT_BACKFILL_SQL = """
    UPDATE forge_session_exercises AS se SET machine_profile_snapshot=jsonb_build_object(
      'id',p.id::text,'name',p.name,'model',p.model,'notes',p.notes,
      'loading_system',p.loading_system,'load_basis',p.load_basis,
      'available_weights_kg',p.available_weights_kg,'snapshot_quality','best_available_current')
    FROM forge_machine_profiles AS p
    WHERE se.source_machine_profile_id=p.id
      AND (se.machine_profile_snapshot IS NULL OR se.machine_profile_snapshot='{}'::jsonb)
"""

NORMALIZATION_CONSISTENCY_SQL = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM forge_machine_profiles
        WHERE loading_system NOT IN ('selectorized','plate_loaded','fixed','other','unknown')
           OR load_basis NOT IN ('displayed_total','per_side','unknown')
           OR jsonb_typeof(available_weights_kg) <> 'array'
           OR jsonb_array_length(available_weights_kg) > 100
    ) THEN
        RAISE EXCEPTION 'Invalid normalized Forge machine profile';
    END IF;
    IF EXISTS (
        SELECT 1 FROM forge_session_exercises
        WHERE source_machine_profile_id IS NOT NULL
          AND (machine_profile_snapshot IS NULL
            OR machine_profile_snapshot->>'id' <> source_machine_profile_id::text
            OR NOT machine_profile_snapshot ?& ARRAY['name','model','notes','loading_system','load_basis','available_weights_kg'])
    ) THEN
        RAISE EXCEPTION 'Incomplete Forge machine profile snapshot backfill';
    END IF;
END $$
"""

# Safe to run on every deploy. High-confidence legacy note extraction remains in
# migrate() because it requires a pre-mutation backup and report; startup only
# installs the additive schema and guarantees complete best-available snapshots.
STARTUP_STATEMENTS = [*DDL, SNAPSHOT_BACKFILL_SQL, NORMALIZATION_CONSISTENCY_SQL]


def migrate() -> dict[str, Any]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    with engine.connect() as connection:
        profiles = _load_profiles(connection)
    backup_path, report_path, report = _write_files(profiles, stamp)
    original_notes = {str(profile["id"]): profile.get("notes") for profile in profiles}
    extracted = {item["profile_id"]: item["extracted_list"] for item in report if item["extraction_status"] == "extracted"}

    with engine.begin() as connection:
        connection.execute(text("LOCK TABLE forge_machine_profiles IN SHARE ROW EXCLUSIVE MODE"))
        connection.execute(text("LOCK TABLE forge_session_exercises IN SHARE ROW EXCLUSIVE MODE"))
        current_notes = {str(row["id"]): row["notes"] for row in connection.execute(text("SELECT id, notes FROM forge_machine_profiles")).mappings()}
        if current_notes != original_notes:
            raise RuntimeError("Profile changed after backup; refusing to migrate")
        for statement in DDL:
            connection.execute(text(statement))
        extracted_written = 0
        for profile_id, weights in extracted.items():
            result = connection.execute(text("""UPDATE forge_machine_profiles SET available_weights_kg=CAST(:weights AS jsonb) WHERE id=CAST(:id AS uuid) AND available_weights_kg='[]'::jsonb"""), {"weights": json.dumps(weights), "id": profile_id})
            extracted_written += result.rowcount
        snapshots_backfilled = connection.execute(text(SNAPSHOT_BACKFILL_SQL)).rowcount
        invalid_profiles = connection.execute(text("""SELECT count(*) FROM forge_machine_profiles WHERE loading_system NOT IN ('selectorized','plate_loaded','fixed','other','unknown') OR load_basis NOT IN ('displayed_total','per_side','unknown') OR jsonb_typeof(available_weights_kg)<>'array' OR jsonb_array_length(available_weights_kg)>100""")).scalar_one()
        invalid_snapshots = connection.execute(text("""SELECT count(*) FROM forge_session_exercises WHERE source_machine_profile_id IS NOT NULL AND (machine_profile_snapshot IS NULL OR machine_profile_snapshot->>'id'<>source_machine_profile_id::text OR NOT machine_profile_snapshot ?& ARRAY['name','model','notes','loading_system','load_basis','available_weights_kg'])""")).scalar_one()
        notes_after = {str(row["id"]): row["notes"] for row in connection.execute(text("SELECT id, notes FROM forge_machine_profiles")).mappings()}
        if invalid_profiles or invalid_snapshots or notes_after != original_notes:
            raise RuntimeError("Post-migration consistency check failed; transaction rolled back")

    result = {"profile_count": len(profiles), "extracted_candidates": len(extracted), "extracted_written": extracted_written, "snapshots_backfilled": snapshots_backfilled, "backup_file": str(backup_path), "report_file": str(report_path)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def verify_read_only() -> dict[str, Any]:
    backups = sorted(BACKUP_DIR.glob("forge_machine_profiles_[0-9]*Z.json"))
    if not backups:
        raise RuntimeError("No profile backup is available for verification")
    expected = {str(row["id"]): row.get("notes") for row in json.loads(backups[-1].read_text(encoding="utf-8"))}
    with engine.connect() as connection:
        profile_columns = {column["name"] for column in inspect(connection).get_columns("forge_machine_profiles")}
        session_columns = {column["name"] for column in inspect(connection).get_columns("forge_session_exercises")}
        actual = {str(row["id"]): row["notes"] for row in connection.execute(text("SELECT id, notes FROM forge_machine_profiles")).mappings()}
        distribution = [list(row) for row in connection.execute(text("SELECT loading_system, load_basis, count(*) FROM forge_machine_profiles GROUP BY 1, 2 ORDER BY 1, 2"))]
        weights = connection.execute(text("SELECT count(*) FILTER (WHERE jsonb_array_length(available_weights_kg)>0), count(*) FROM forge_machine_profiles")).one()
        snapshots = connection.execute(text("""SELECT count(*) FILTER (WHERE source_machine_profile_id IS NOT NULL), count(*) FILTER (WHERE source_machine_profile_id IS NOT NULL AND machine_profile_snapshot IS NOT NULL), count(*) FILTER (WHERE source_machine_profile_id IS NOT NULL AND machine_profile_snapshot->>'snapshot_quality'='best_available_current') FROM forge_session_exercises""")).one()
        checks = [row[0] for row in connection.execute(text("SELECT conname FROM pg_constraint WHERE conrelid='forge_machine_profiles'::regclass AND conname LIKE 'ck_forge_machine_profiles_%' ORDER BY conname"))]
    result = {
        "profile_count": len(actual), "notes_unchanged": actual == expected,
        "profile_columns_present": {"loading_system", "load_basis", "available_weights_kg"}.issubset(profile_columns),
        "snapshot_column_present": "machine_profile_snapshot" in session_columns,
        "profile_distributions": distribution, "profiles_with_structured_weights": weights[0],
        "session_rows_with_profile_fk": snapshots[0], "session_rows_with_snapshot": snapshots[1],
        "best_available_snapshots": snapshots[2], "checks": checks,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return result


if __name__ == "__main__":
    import sys
    verify_read_only() if "--verify-only" in sys.argv else migrate()
