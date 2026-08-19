"""Background scheduling for Forge-native morning briefings and workout tips."""
import asyncio
import logging
from datetime import date, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import MorningBriefing, User, WeightEntry, WorkoutReview
from app.services.aggregator import gather_user_context
from app.services.ai_service import generate_daily_briefing, generate_workout_tips
from app.services.forge_session_adapter import completed_forge_workouts, forge_plan_template

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


async def _generate_workout_review_for_user(
    user: User,
    db: Session,
    max_new_reviews: int = 3,
) -> int:
    """Generate Forge-native workout tips for recently completed sessions only."""
    workouts = completed_forge_workouts(db, user.id, limit=20)
    generated = 0

    for workout in workouts:
        session_id = workout["id"]
        existing = (
            db.query(WorkoutReview)
            .filter(
                WorkoutReview.user_id == user.id,
                WorkoutReview.hevy_workout_id == session_id,
            )
            .first()
        )
        if existing or generated >= max_new_reviews:
            continue

        workout_name = workout["title"]
        previous = (
            db.query(WorkoutReview)
            .filter(
                WorkoutReview.user_id == user.id,
                WorkoutReview.workout_name == workout_name,
            )
            .order_by(WorkoutReview.workout_date.desc())
            .limit(3)
            .all()
        )
        try:
            workout_dt = datetime.fromisoformat(workout["start_time"].replace("Z", "+00:00"))
        except (TypeError, ValueError):
            workout_dt = datetime.utcnow()

        try:
            context = await gather_user_context(user, db)
            tips_data = await generate_workout_tips(
                yazio_data=context["yazio"],
                workout_data=context["workouts"],
                workout_name=workout_name,
                language=user.language or "de",
                previous_tips_list=[row.tips_data for row in previous if row.tips_data],
                routine_exercises=forge_plan_template(
                    db,
                    user.id,
                    workout_name,
                    workout.get("source_plan_id"),
                ),
            )
            db.add(WorkoutReview(
                user_id=user.id,
                hevy_workout_id=session_id,
                workout_name=workout_name,
                workout_date=workout_dt,
                review_data=None,
                tips_data=tips_data,
                is_read=False,
            ))
            db.commit()
            generated += 1
            logger.info("Forge workout tips generated for %s — %s", user.username, session_id)
        except Exception as exc:
            db.rollback()
            logger.error("Failed to generate Forge workout tips for %s: %s", user.username, session_id, exc)

        await asyncio.sleep(2)

    return generated


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


async def workout_review_job():
    """Periodically generate one Forge-native tip set per newly completed session."""
    logger.info("Starting Forge workout review check")
    db: Session = SessionLocal()
    try:
        users = db.query(User).all()
        generated = 0
        for user in users:
            generated += await _generate_workout_review_for_user(user, db)
            await asyncio.sleep(1)
        logger.info("Forge workout review check complete: %d new reviews generated", generated)
    except Exception as exc:
        logger.error("Forge workout review job crashed: %s", exc)
    finally:
        db.close()


def start_scheduler():
    """Start daily Forge-native briefing generation and hourly workout reviews."""
    scheduler.add_job(
        daily_briefing_job,
        trigger=CronTrigger(hour=4, minute=0),
        id="daily_morning_briefing",
        name="Generate morning briefings for all users",
        replace_existing=True,
    )
    scheduler.add_job(
        workout_review_job,
        trigger=IntervalTrigger(hours=1),
        id="hourly_forge_workout_review",
        name="Generate Forge workout tips for completed sessions",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started – daily briefing at 04:00 AM + Forge workout reviews every hour")


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
