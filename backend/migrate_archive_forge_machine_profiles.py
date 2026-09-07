"""Add non-destructive removal for Forge machine profiles.

Profiles referenced by completed or active sessions must retain their UUID so history
and machine-specific progression remain comparable. Deleting such a profile archives
it instead of breaking those historical snapshots.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    "ALTER TABLE forge_machine_profiles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;",
    "CREATE INDEX IF NOT EXISTS ix_forge_machine_profiles_user_archived ON forge_machine_profiles (user_id, is_archived);",
]


def migrate() -> None:
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("Forge machine-profile archive migration complete.")


if __name__ == "__main__":
    migrate()
