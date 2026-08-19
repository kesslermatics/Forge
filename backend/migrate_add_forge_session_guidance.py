"""Add immutable automatic coaching guidance to Forge session exercise snapshots.

Run once from backend after deploying the matching application code:
  python migrate_add_forge_session_guidance.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    ALTER TABLE forge_session_exercises
    ADD COLUMN IF NOT EXISTS coach_guidance JSONB;
    """,
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:60]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge session guidance migration complete.")


if __name__ == "__main__":
    migrate()
