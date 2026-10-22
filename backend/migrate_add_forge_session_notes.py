"""Add the live-workout exercise note, the AI completion review and the ad-hoc session wish.

Runs automatically on startup (idempotent). Manual run from backend:
  python migrate_add_forge_session_notes.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_session_exercises ADD COLUMN IF NOT EXISTS session_note TEXT;",
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS completion_review JSON;",
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS user_request TEXT;",
    "ALTER TABLE forge_workout_sessions ADD COLUMN IF NOT EXISTS description TEXT;",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge session-note migration complete.")


if __name__ == "__main__":
    migrate()
