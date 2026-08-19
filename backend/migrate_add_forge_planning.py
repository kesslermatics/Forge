"""Create native Forge exercise-library and training-plan tables.

Run once from backend:
  python migrate_add_forge_planning.py
"""
from sqlalchemy import text

from app.database import engine

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS forge_exercises (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        icon VARCHAR(64) NOT NULL DEFAULT 'Dumbbell',
        equipment VARCHAR(16) NOT NULL DEFAULT 'other',
        primary_muscle_group VARCHAR(64) NOT NULL,
        secondary_muscle_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT uq_forge_exercise_user_name UNIQUE (user_id, name)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_exercises_user_id ON forge_exercises (user_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_machine_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exercise_id UUID NOT NULL REFERENCES forge_exercises(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        model VARCHAR(100),
        notes VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT uq_forge_machine_profile_name UNIQUE (exercise_id, name)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_machine_profiles_exercise_id ON forge_machine_profiles (exercise_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_training_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description VARCHAR(500),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_training_plans_user_id ON forge_training_plans (user_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_plan_exercises (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES forge_training_plans(id) ON DELETE CASCADE,
        exercise_id UUID NOT NULL REFERENCES forge_exercises(id) ON DELETE RESTRICT,
        machine_profile_id UUID REFERENCES forge_machine_profiles(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        notes VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT uq_forge_plan_exercise_position UNIQUE (plan_id, position)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_plan_exercises_plan_id ON forge_plan_exercises (plan_id);",
    "CREATE INDEX IF NOT EXISTS ix_forge_plan_exercises_exercise_id ON forge_plan_exercises (exercise_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_plan_sets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_exercise_id UUID NOT NULL REFERENCES forge_plan_exercises(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        set_type VARCHAR(16) NOT NULL DEFAULT 'working',
        previous_weight_kg DOUBLE PRECISION,
        previous_reps INTEGER,
        current_weight_kg DOUBLE PRECISION,
        current_reps INTEGER,
        coach_suggested_weight_kg DOUBLE PRECISION,
        coach_suggested_reps INTEGER,
        note VARCHAR(300),
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT uq_forge_plan_set_position UNIQUE (plan_exercise_id, position)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_plan_sets_plan_exercise_id ON forge_plan_sets (plan_exercise_id);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:60]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nNative Forge planning migration complete.")


if __name__ == "__main__":
    migrate()
