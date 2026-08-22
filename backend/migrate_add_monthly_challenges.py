"""Create persistent, account-scoped monthly Forge challenge tables.

Run once after deployment:
  python migrate_add_monthly_challenges.py
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS monthly_challenge_cycles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month_start DATE NOT NULL,
        generated_at TIMESTAMPTZ DEFAULT now(),
        total_challenges INTEGER NOT NULL DEFAULT 0,
        completed_challenges INTEGER NOT NULL DEFAULT 0,
        completion_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
        finalized_at TIMESTAMPTZ,
        UNIQUE (user_id, month_start)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS monthly_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cycle_id UUID NOT NULL REFERENCES monthly_challenge_cycles(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL,
        category VARCHAR(32) NOT NULL,
        metric VARCHAR(80) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description VARCHAR(500) NOT NULL,
        icon VARCHAR(64) NOT NULL,
        unit VARCHAR(32) NOT NULL,
        baseline_value DOUBLE PRECISION NOT NULL DEFAULT 0,
        target_value DOUBLE PRECISION NOT NULL,
        rules JSON NOT NULL DEFAULT '{}'::json,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        completed_at TIMESTAMPTZ,
        completion_stats JSON,
        final_stats JSON,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (cycle_id, slot),
        UNIQUE (cycle_id, category)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS monthly_challenge_checkins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cycle_id UUID NOT NULL REFERENCES monthly_challenge_cycles(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        metrics_snapshot JSON NOT NULL DEFAULT '{}'::json,
        progress_snapshot JSON NOT NULL DEFAULT '{}'::json,
        checkin_data JSON NOT NULL DEFAULT '{}'::json,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (cycle_id, date)
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_monthly_challenge_cycles_user_month ON monthly_challenge_cycles (user_id, month_start DESC);",
    "CREATE INDEX IF NOT EXISTS ix_monthly_challenge_checkins_user_date ON monthly_challenge_checkins (user_id, date DESC);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:70]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nMonthly challenge migration complete.")


if __name__ == "__main__":
    migrate()
