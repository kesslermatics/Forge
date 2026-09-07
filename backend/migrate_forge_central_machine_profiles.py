"""Make Forge machine profiles reusable, user-owned resources.

Run once from backend after the existing Forge migrations:
  python migrate_forge_central_machine_profiles.py

The migration is intentionally idempotent. It preserves every existing profile UUID and
therefore leaves plan/session foreign keys intact while moving the former exercise link
into an M:N association table.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    ALTER TABLE forge_machine_profiles
    ADD COLUMN IF NOT EXISTS user_id UUID;
    """,
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'forge_machine_profiles' AND column_name = 'exercise_id'
        ) THEN
            UPDATE forge_machine_profiles AS profile
            SET user_id = exercise.user_id
            FROM forge_exercises AS exercise
            WHERE profile.user_id IS NULL
              AND profile.exercise_id = exercise.id;
        END IF;
    END $$;
    """,
    """
    CREATE TABLE IF NOT EXISTS forge_exercise_machine_profiles (
        exercise_id UUID NOT NULL REFERENCES forge_exercises(id) ON DELETE CASCADE,
        machine_profile_id UUID NOT NULL REFERENCES forge_machine_profiles(id) ON DELETE CASCADE,
        PRIMARY KEY (exercise_id, machine_profile_id)
    );
    """,
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'forge_machine_profiles' AND column_name = 'exercise_id'
        ) THEN
            INSERT INTO forge_exercise_machine_profiles (exercise_id, machine_profile_id)
            SELECT exercise_id, id
            FROM forge_machine_profiles
            WHERE exercise_id IS NOT NULL
            ON CONFLICT (exercise_id, machine_profile_id) DO NOTHING;
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'forge_machine_profiles'::regclass
              AND contype = 'f'
              AND conname = 'fk_forge_machine_profiles_user_id'
        ) THEN
            ALTER TABLE forge_machine_profiles
            ADD CONSTRAINT fk_forge_machine_profiles_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
    END $$;
    """,
    """
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM forge_machine_profiles WHERE user_id IS NULL) THEN
            RAISE EXCEPTION 'Cannot migrate Forge machine profiles: orphaned profile rows exist';
        END IF;
    END $$;
    """,
    "ALTER TABLE forge_machine_profiles ALTER COLUMN user_id SET NOT NULL;",
    "ALTER TABLE forge_machine_profiles DROP CONSTRAINT IF EXISTS uq_forge_machine_profile_name;",
    "ALTER TABLE forge_machine_profiles DROP COLUMN IF EXISTS exercise_id;",
    "DROP INDEX IF EXISTS ix_forge_machine_profiles_exercise_id;",
    "CREATE INDEX IF NOT EXISTS ix_forge_machine_profiles_user_id ON forge_machine_profiles (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_forge_exercise_machine_profiles_profile_id ON forge_exercise_machine_profiles (machine_profile_id);",
]


def migrate() -> None:
    with engine.begin() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
    print("\nCentral Forge machine-profile migration complete.")


if __name__ == "__main__":
    migrate()
