"""Create Google Health OAuth and Forge-workout export persistence.

Run once after deploying the matching application code:
  python migrate_add_google_health.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS google_health_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        refresh_token VARCHAR(4096) NOT NULL,
        access_token VARCHAR(4096),
        token_expires_at TIMESTAMPTZ,
        scope VARCHAR(2000) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'connected',
        last_error VARCHAR(1000),
        connected_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_google_health_connections_user_id ON google_health_connections (user_id);",
    """
    CREATE TABLE IF NOT EXISTS google_health_workout_exports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id UUID NOT NULL REFERENCES forge_workout_sessions(id) ON DELETE CASCADE,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        external_data_point_name VARCHAR(512),
        last_error VARCHAR(1000),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        attempted_at TIMESTAMPTZ,
        exported_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ,
        CONSTRAINT uq_google_health_export_session UNIQUE (session_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_google_health_workout_exports_user_id ON google_health_workout_exports (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_google_health_workout_exports_session_id ON google_health_workout_exports (session_id);",
    """
    CREATE TABLE IF NOT EXISTS google_health_oauth_states (
        state VARCHAR(128) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_google_health_oauth_states_user_id ON google_health_oauth_states (user_id);",
    "CREATE INDEX IF NOT EXISTS ix_google_health_oauth_states_expires_at ON google_health_oauth_states (expires_at);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nGoogle Health migration complete.")


if __name__ == "__main__":
    migrate()
