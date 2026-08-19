"""Create native Forge programs, sessions, and session-chat tables.

Run once after migrate_add_forge_planning.py from backend:
  python migrate_add_forge_sessions.py
"""
from sqlalchemy import text

from app.database import engine

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS forge_training_programs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        mode VARCHAR(16) NOT NULL DEFAULT 'rotation',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        rotation_cursor INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_training_programs_user_id ON forge_training_programs (user_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_program_routines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        program_id UUID NOT NULL REFERENCES forge_training_programs(id) ON DELETE CASCADE,
        plan_id UUID NOT NULL REFERENCES forge_training_plans(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        weekdays JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT uq_forge_program_routine_plan UNIQUE (program_id, plan_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_program_routines_program_id ON forge_program_routines (program_id);",
    "CREATE INDEX IF NOT EXISTS ix_forge_program_routines_plan_id ON forge_program_routines (plan_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_workout_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        program_id UUID REFERENCES forge_training_programs(id) ON DELETE SET NULL,
        source_plan_id UUID REFERENCES forge_training_plans(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        started_at TIMESTAMPTZ DEFAULT now(),
        completed_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_workout_sessions_user_id ON forge_workout_sessions (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_forge_workout_sessions_program_id ON forge_workout_sessions (program_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_session_exercises (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES forge_workout_sessions(id) ON DELETE CASCADE,
        source_exercise_id UUID REFERENCES forge_exercises(id) ON DELETE SET NULL,
        source_plan_exercise_id UUID REFERENCES forge_plan_exercises(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        icon VARCHAR(64) NOT NULL DEFAULT 'Dumbbell',
        equipment VARCHAR(16) NOT NULL DEFAULT 'other',
        primary_muscle_group VARCHAR(64) NOT NULL,
        secondary_muscle_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
        machine_profile_name VARCHAR(100),
        notes VARCHAR(500),
        position INTEGER NOT NULL,
        CONSTRAINT uq_forge_session_exercise_position UNIQUE (session_id, position)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_session_exercises_session_id ON forge_session_exercises (session_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_session_sets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_exercise_id UUID NOT NULL REFERENCES forge_session_exercises(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        set_type VARCHAR(16) NOT NULL DEFAULT 'working',
        target_weight_kg DOUBLE PRECISION,
        target_reps INTEGER,
        actual_weight_kg DOUBLE PRECISION,
        actual_reps INTEGER,
        coach_suggested_weight_kg DOUBLE PRECISION,
        coach_suggested_reps INTEGER,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        note VARCHAR(300),
        CONSTRAINT uq_forge_session_set_position UNIQUE (session_exercise_id, position)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_session_sets_session_exercise_id ON forge_session_sets (session_exercise_id);",
    """
    CREATE TABLE IF NOT EXISTS forge_session_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES forge_workout_sessions(id) ON DELETE CASCADE,
        role VARCHAR(16) NOT NULL,
        content VARCHAR(4000) NOT NULL,
        proposed_action JSONB,
        action_status VARCHAR(16),
        created_at TIMESTAMPTZ DEFAULT now()
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_session_messages_session_id ON forge_session_messages (session_id);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:60]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nNative Forge session migration complete.")


if __name__ == "__main__":
    migrate()
