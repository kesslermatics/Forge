"""Add optional private image metadata to Forge training-day plans.

Run once from backend:
  python migrate_add_forge_plan_images.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_storage_key VARCHAR(512);",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_content_type VARCHAR(100);",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_byte_size INTEGER;",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_width INTEGER;",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_height INTEGER;",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS image_sha256 VARCHAR(64);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge plan-image migration complete.")


if __name__ == "__main__":
    migrate()
