"""Add persisted, validated Gemini coaching snapshots for native Forge sessions.

Run once from backend after deploying the matching application code:
    python migrate_add_forge_ai_coaching.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS start_coaching JSONB;",
    "ALTER TABLE forge_session_exercises ADD COLUMN IF NOT EXISTS addition_coaching JSONB;",
]


def migrate() -> None:
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Added Forge AI coaching snapshot columns.")


if __name__ == "__main__":
    migrate()
