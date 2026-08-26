"""Allow a Forge rotation to repeat the same routine in several ordered slots (A-B-A).

Replaces the routine-per-program uniqueness with slot uniqueness.

Run once from backend after deploying the matching application code:
    python migrate_forge_rotation_repeatable_routines.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_program_routines DROP CONSTRAINT IF EXISTS uq_forge_program_routine_plan;",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'uq_forge_program_routine_position'
        ) THEN
            ALTER TABLE forge_program_routines
            ADD CONSTRAINT uq_forge_program_routine_position UNIQUE (program_id, position);
        END IF;
    END $$;
    """,
]


def migrate() -> None:
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Forge rotations now support repeated routines in ordered slots.")


if __name__ == "__main__":
    migrate()
