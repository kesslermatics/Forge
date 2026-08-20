"""Create private, account-scoped Forge progress-photo metadata.

Run once from backend after setting PHOTO_STORAGE_DIR to a persistent volume:
  python migrate_add_forge_progress_photos.py

Image binaries are intentionally not stored in PostgreSQL. They live under the opaque
private keys in the configured backend-only persistent volume.
"""
from sqlalchemy import text

from app.database import engine


STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS forge_progress_photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        taken_on DATE NOT NULL,
        view VARCHAR(16) NOT NULL DEFAULT 'front',
        note VARCHAR(500),
        storage_key VARCHAR(512) NOT NULL,
        content_type VARCHAR(100) NOT NULL DEFAULT 'image/webp',
        byte_size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        sha256 VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_forge_progress_photos_user_taken_created ON forge_progress_photos (user_id, taken_on DESC, created_at DESC);",
]


def migrate():
    with engine.connect() as conn:
        for statement in STATEMENTS:
            print(f"  ▸ Running: {statement.strip()[:60]}…")
            conn.execute(text(statement))
        conn.commit()
    print("\nForge progress-photo migration complete.")


if __name__ == "__main__":
    migrate()
