"""Add the session-wide training note and the cardio flag from the closing page of a session.

Runs automatically on startup (idempotent). Manual run from backend:
  python migrate_add_forge_session_training_note.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS training_note TEXT;",
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS cardio_done BOOLEAN NOT NULL DEFAULT false;",
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS cardio_minutes INTEGER;",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge session training-note migration complete.")


if __name__ == "__main__":
    migrate()
