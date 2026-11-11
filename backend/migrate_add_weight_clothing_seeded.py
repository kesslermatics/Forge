"""
Migration: users.weight_clothing_seeded, so the default clothing list is created only once
and an intentionally emptied list stays empty.

Run once:
  cd backend
  python migrate_add_weight_clothing_seeded.py
"""
from sqlalchemy import text
from app.database import engine

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_clothing_seeded BOOLEAN NOT NULL DEFAULT FALSE;",
    # Users who already have items count as configured.
    "UPDATE users SET weight_clothing_seeded = TRUE WHERE id IN (SELECT DISTINCT user_id FROM weight_clothing_items);",
]


def migrate():
    with engine.connect() as conn:
        for stmt in STATEMENTS:
            print(f"  ▸ Running: {stmt.strip()[:70]}…")
            conn.execute(text(stmt))
        conn.commit()
    print("\n✅ Migration complete – users.weight_clothing_seeded added!")


if __name__ == "__main__":
    migrate()
