"""Add explicit tracking-free course plans to Forge.

Run once from backend:
  python migrate_add_forge_course_plans.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS plan_type VARCHAR(16) NOT NULL DEFAULT 'workout';",
    "ALTER TABLE forge_training_plans ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER;",
    "ALTER TABLE forge_training_plans DROP CONSTRAINT IF EXISTS ck_forge_training_plan_type;",
    "ALTER TABLE forge_training_plans ADD CONSTRAINT ck_forge_training_plan_type CHECK (plan_type IN ('workout', 'course'));",
    "ALTER TABLE forge_training_plans DROP CONSTRAINT IF EXISTS ck_forge_training_plan_course_duration;",
    "ALTER TABLE forge_training_plans ADD CONSTRAINT ck_forge_training_plan_course_duration CHECK ((plan_type = 'workout' AND default_duration_minutes IS NULL) OR (plan_type = 'course' AND default_duration_minutes BETWEEN 1 AND 720));",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge course-plan migration complete.")


if __name__ == "__main__":
    migrate()
