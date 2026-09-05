"""
HevyCoach-AI Backend
Main FastAPI application entry point.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routes import auth, user
from app.routes import briefing as briefing_router
from app.routes import forge as forge_router
from app.routes import monthly_challenges as monthly_challenges_router
from app.scheduler import start_scheduler, stop_scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)

# Create database tables (new tables only — does not add columns to existing tables)
Base.metadata.create_all(bind=engine)

# Auto-migrate: add any missing legacy columns and the complete Google Health schema on every deploy.
# New ORM tables are also covered by create_all above; the explicit Google Health
# statements keep production constraints and indexes aligned without manual shell work.
from sqlalchemy import text as _sql_text
from migrate_add_google_health import STATEMENTS as _google_health_migrations
from migrate_add_forge_course_plans import STATEMENTS as _forge_course_plan_migrations

with engine.connect() as _conn:
    _legacy_migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS training_plan JSON;",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm DOUBLE PRECISION;",
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS agent_details JSON;",
        # weight_entries and chat tables are created by create_all above (new tables)
    ]
    for stmt in _legacy_migrations:
        try:
            _conn.execute(_sql_text(stmt))
        except Exception:
            pass  # Legacy migration compatibility for already-deployed databases.
    _conn.commit()

# Forge course plans and Google Health are production capabilities. Do not hide
# failed schema migrations: failing startup is safer than serving incompatible APIs.
with engine.connect() as _conn:
    for stmt in _forge_course_plan_migrations:
        _conn.execute(_sql_text(stmt))
    for stmt in _google_health_migrations:
        _conn.execute(_sql_text(stmt))
    _conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle – manages the APScheduler."""
    start_scheduler()
    yield
    stop_scheduler()


# Initialize FastAPI app
app = FastAPI(
    title="HevyCoach-AI",
    description="AI-powered coaching wrapper for the Hevy fitness app",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Configure CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # Local development
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        # Production
        "https://coach.kesslermatics.com",
        "http://coach.kesslermatics.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(user.router)
app.include_router(briefing_router.router)
app.include_router(forge_router.router)
app.include_router(monthly_challenges_router.router)


@app.get("/", tags=["Health"])
async def root():
    """Health check endpoint."""
    return {"message": "HevyCoach-AI API is running", "status": "healthy"}


@app.get("/health", tags=["Health"])
async def health_check():
    """Detailed health check endpoint."""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "service": "HevyCoach-AI Backend"
    }
