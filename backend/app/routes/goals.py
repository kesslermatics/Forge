"""Profile goals (weight goal with dates, daily nutrition targets, nutrition rules) and day notes."""
from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services import day_notes, profile_goals
from app.services.profile_goals import GoalError

router = APIRouter(prefix="/api", tags=["Goals"])


class GoalsUpdate(BaseModel):
    """Every field is optional; only the fields that are sent change (null clears optional ones)."""
    start_weight_kg: float | None = None
    start_date: date_type | None = None
    target_weight_kg: float | None = None
    target_date: date_type | None = None
    kcal: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    sugar: float | None = None
    salt: float | None = None
    fiber: float | None = None
    nutrition_rules: str | None = Field(default=None, max_length=2000)


class DayNoteUpdate(BaseModel):
    date: date_type
    text: str | None = Field(default=None, max_length=day_notes.MAX_NOTE_LENGTH)


@router.get("/goals")
def read_goals(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return profile_goals.get_goals(db, current_user)


@router.put("/goals")
def write_goals(data: GoalsUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fields = data.model_dump(exclude_unset=True)
    try:
        return profile_goals.set_goals(db, current_user, fields)
    except GoalError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/day-note")
def read_day_note(date: date_type = Query(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"date": date.isoformat(), "text": day_notes.get_note(db, current_user.id, date)}


@router.put("/day-note")
def write_day_note(data: DayNoteUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    text = day_notes.set_note(db, current_user.id, data.date, data.text)
    return {"date": data.date.isoformat(), "text": text}
