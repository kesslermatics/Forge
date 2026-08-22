"""Authenticated API for persistent monthly Forge challenges."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas import MonthlyChallengeCycleResponse, MonthlyChallengeCheckinResponse
from app.services.monthly_challenge_service import (
    generate_daily_challenge_checkin,
    get_or_create_current_cycle,
    serialize_cycle,
)

router = APIRouter(prefix="/api/challenges", tags=["Monthly challenges"])


@router.get("/monthly/current", response_model=MonthlyChallengeCycleResponse)
async def get_current_monthly_challenges(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return this account's frozen monthly goals and freshly calculated Forge progress."""
    cycle = await get_or_create_current_cycle(db, current_user)
    payload = serialize_cycle(db, current_user, cycle)
    db.commit()
    return payload


@router.post("/monthly/check-in", response_model=MonthlyChallengeCheckinResponse)
async def create_current_monthly_checkin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Idempotently generate the caller's daily check-in (also used by the 03:00 job)."""
    checkin = await generate_daily_challenge_checkin(db, current_user)
    return {
        "date": checkin.date,
        "checkin": checkin.checkin_data,
    }
