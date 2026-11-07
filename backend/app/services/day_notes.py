"""Free-text day notes ("Erkältung, schlecht geschlafen", "Geburtstag, Restaurant").

A note belongs to one calendar day and is delivered together with that day's nutrition and
training, so the Coach can explain outliers instead of guessing.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

from sqlalchemy.orm import Session

from app.models import DayNote

MAX_NOTE_LENGTH = 2000


def get_note(db: Session, user_id, day: date) -> str | None:
    row = db.query(DayNote).filter(DayNote.user_id == user_id, DayNote.date == day).first()
    return row.text if row else None


def notes_between(db: Session, user_id, start: date, end: date) -> dict[date, str]:
    rows = db.query(DayNote).filter(DayNote.user_id == user_id, DayNote.date >= start, DayNote.date <= end).all()
    return {row.date: row.text for row in rows}


def notes_for_dates(db: Session, user_id, days: Iterable[date]) -> dict[date, str]:
    wanted = set(days)
    if not wanted:
        return {}
    rows = db.query(DayNote).filter(DayNote.user_id == user_id, DayNote.date.in_(wanted)).all()
    return {row.date: row.text for row in rows}


def set_note(db: Session, user_id, day: date, text: str | None) -> str | None:
    """Create, overwrite or (empty text) delete the note of one day. Returns the stored text."""
    cleaned = (text or "").strip()[:MAX_NOTE_LENGTH]
    row = db.query(DayNote).filter(DayNote.user_id == user_id, DayNote.date == day).first()
    if not cleaned:
        if row is not None:
            db.delete(row)
            db.commit()
        return None
    if row is None:
        db.add(DayNote(user_id=user_id, date=day, text=cleaned))
    else:
        row.text = cleaned
    db.commit()
    return cleaned
