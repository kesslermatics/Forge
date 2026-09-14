"""Create non-expiring, revocable personal API-key persistence.

Run manually with ``python migrate_add_api_keys.py`` or let backend startup apply
these idempotent statements.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        key_id VARCHAR(16) NOT NULL,
        secret_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        CONSTRAINT uq_api_keys_key_id UNIQUE (key_id),
        CONSTRAINT ck_api_keys_name_not_blank CHECK (length(btrim(name)) > 0),
        CONSTRAINT ck_api_keys_hash_length CHECK (length(secret_hash) = 64),
        CONSTRAINT ck_api_keys_revoked_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    );
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_api_keys_key_id ON api_keys (key_id);",
    "CREATE INDEX IF NOT EXISTS ix_api_keys_user_id ON api_keys (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_api_keys_user_created ON api_keys (user_id, created_at DESC);",
]


def migrate() -> None:
    with engine.begin() as connection:
        for statement in STATEMENTS:
            connection.execute(text(statement))
    print("API-key migration complete.")


if __name__ == "__main__":
    migrate()
