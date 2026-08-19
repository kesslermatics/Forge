"""Data aggregation service for native Forge sessions and optional Yazio data."""
import logging
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models import User
from app.encryption import decrypt_value
from app.services.forge_session_adapter import completed_forge_workouts
from app.services.yazio_service import fetch_yazio_summary

logger = logging.getLogger(__name__)


async def gather_user_context(
    user: User,
    db: Session,
    include_today_nutrition: bool = True,
) -> dict:
    """Gather optional Yazio data and the user's recent completed Forge sessions."""
    yazio_data: Optional[dict] = None
    yazio_today: Optional[dict] = None
    yazio_dby: Optional[dict] = None

    if user.yazio_email and user.yazio_password:
        try:
            email = decrypt_value(user.yazio_email)
            password = decrypt_value(user.yazio_password)
            yazio_data = await fetch_yazio_summary(email, password)
            if include_today_nutrition:
                yazio_today = await fetch_yazio_summary(email, password, target_date=date.today())
            yazio_dby = await fetch_yazio_summary(
                email,
                password,
                target_date=date.today() - timedelta(days=2),
            )
        except Exception as exc:
            logger.error("Failed to gather Yazio data for user %s: %s", user.id, exc)
    else:
        logger.info("User %s has no Yazio credentials – skipping nutrition", user.id)

    return {
        "yazio": yazio_data,
        "yazio_today": yazio_today,
        "yazio_day_before_yesterday": yazio_dby,
        "workouts": completed_forge_workouts(db, user.id, limit=20),
    }
