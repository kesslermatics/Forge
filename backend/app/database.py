"""
Database configuration and session management.
"""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings


def _normalise_db_url(url: str) -> str:
    """
    Railway (and other PaaS) typically provide a plain `postgresql://` or
    `postgres://` URL.  SQLAlchemy 2 on Python 3.13 resolves that to the
    psycopg3 dialect (`psycopg`) by default, but we ship `psycopg2-binary`.
    Force the psycopg2 dialect so the connection always works regardless of
    what the platform injects.
    """
    replacements = [
        ("postgresql+psycopg://", "postgresql+psycopg2://"),
        ("postgres+psycopg://",   "postgresql+psycopg2://"),
        ("postgresql://",          "postgresql+psycopg2://"),
        ("postgres://",            "postgresql+psycopg2://"),
    ]
    for old, new in replacements:
        if url.startswith(old):
            return new + url[len(old):]
    return url


# Create SQLAlchemy engine
engine = create_engine(_normalise_db_url(settings.database_url))

# Create SessionLocal class for database sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for models
Base = declarative_base()


def get_db():
    """
    Dependency that provides a database session.
    Ensures the session is closed after each request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
