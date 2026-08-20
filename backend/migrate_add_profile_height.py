"""Add user-managed profile height to existing accounts.

Run once from backend if the deployment has not applied startup migrations yet:
  python migrate_add_profile_height.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm DOUBLE PRECISION;",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))
        conn.commit()
    print("Profile height migration complete.")


if __name__ == "__main__":
    migrate()
