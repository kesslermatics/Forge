"""Background scheduling for Forge-native morning briefings."""
import asyncio
import logging
from datetime import date

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import MorningBriefing, User, WeightEntry
from app.services.aggregator import gather_user_context
from app.services.ai_service import generate_daily_briefing

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _generate_for_user(user: User, db: Session) -> bool:
    """Generate and save one daily briefing from native Forge and optional Yazio data."""
    today = date.today()
    existing = (
        db.query(MorningBriefing)
        .filter(MorningBriefing.user_id == user.id, MorningBriefing.date == today)
        .first()
    )
    if existing:
        logger.debug("Briefing already exists for user %s on %s – skipping", user.username, today)
        return True

    try:
        context = await gather_user_context(user, db)
        yazio = context.get("yazio")
        if yazio and yazio.get("profile"):
            weight = yazio["profile"].get("current_weight_kg")
            if weight and weight > 0:
                existing_weight = (
                    db.query(WeightEntry)
                    .filter(WeightEntry.user_id == user.id, WeightEntry.date == today)
                    .first()
                )
                if not existing_weight:
                    db.add(WeightEntry(user_id=user.id, date=today, weight_kg=round(weight, 2)))
                    db.commit()

        briefing = MorningBriefing(
            user_id=user.id,
            date=today,
            briefing_data=await generate_daily_briefing(
                yazio_data=context["yazio"],
                workout_data=context["workouts"],
                language=user.language or "de",
                today_nutrition=context.get("yazio_today"),
            ),
        )
        db.add(briefing)
        db.commit()
        logger.info("Briefing generated for %s", user.username)
        return True
    except Exception as exc:
        db.rollback()
        logger.error("Failed to generate briefing for %s: %s", user.username, exc)
        return False


async def daily_briefing_job():
    """Generate nutrition-aware briefings without requiring a Hevy credential."""
    logger.info("Starting daily briefing generation")
    db: Session = SessionLocal()
    try:
        active_users = (
            db.query(User)
            .filter(User.yazio_email.isnot(None), User.yazio_password.isnot(None))
            .all()
        )
        success = 0
        for user in active_users:
            success += await _generate_for_user(user, db)
            await asyncio.sleep(1)
        logger.info("Daily briefing generation complete: %d/%d succeeded", success, len(active_users))
    except Exception as exc:
        logger.error("Briefing cron job crashed: %s", exc)
    finally:
        db.close()


def start_scheduler():
    """Start the daily Forge-native briefing.

    The weight entry for each day comes from the briefing job below.
    """
    scheduler.add_job(
        daily_briefing_job,
        trigger=CronTrigger(hour=4, minute=0, timezone="Europe/Berlin"),
        id="daily_morning_briefing",
        name="Generate morning briefings for all users",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started – briefings at 04:00 Europe/Berlin")


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
