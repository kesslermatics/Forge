"""
Run once from backend after deploying the matching application code:
  python migrate_add_forge_machine_profile_identity.py

Adds a durable machine-profile identity to Forge session exercise snapshots. Existing
snapshots are backfilled only when their canonical exercise and stored profile name
identify exactly one current machine profile.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    ALTER TABLE forge_session_exercises
    ADD COLUMN IF NOT EXISTS source_machine_profile_id UUID
    REFERENCES forge_machine_profiles(id) ON DELETE RESTRICT;
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_forge_session_exercises_source_machine_profile_id
    ON forge_session_exercises (source_machine_profile_id);
    """,
    """
    UPDATE forge_session_exercises AS session_exercise
    SET source_machine_profile_id = profile.id
    FROM forge_machine_profiles AS profile
    WHERE session_exercise.source_machine_profile_id IS NULL
      AND session_exercise.source_exercise_id = profile.exercise_id
      AND session_exercise.machine_profile_name = profile.name;
    """,
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:60]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge machine-profile identity migration complete.")


if __name__ == "__main__":
    migrate()
