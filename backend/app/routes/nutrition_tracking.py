"""Native food tracking: user-defined meal slots, diary entries, catalog search and barcode lookup.

Diary data lives in the Forge database. Product data comes from the separate food catalog
(see app/services/food_catalog.py); entries store a full nutrient snapshot at tracking time.
"""
from __future__ import annotations

import json
from datetime import date as date_type
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.dependencies import get_current_user
from app.models import NutritionEntry, NutritionMealSlot, User
from app.services import food_catalog, food_smart_track, nutrition_native
from app.services.food_catalog import CatalogUnavailable

router = APIRouter(prefix="/api/nutrition", tags=["Nutrition tracking"])

CORE_FIELDS = ("kcal", "protein", "carbs", "fat", "sugar", "fiber", "saturated", "salt")
MAX_SLOTS = 12


# ── schemas ──────────────────────────────────────────────────────────────────────

class SlotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Der Name darf nicht leer sein.")
        return value


class SlotUpdate(SlotCreate):
    pass


class SlotOrder(BaseModel):
    slot_ids: list[UUID] = Field(min_length=1, max_length=MAX_SLOTS)


class EntryCreate(BaseModel):
    date: date_type
    slot_id: UUID | None = None
    source: Literal["bls", "off"]
    source_id: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0, le=10000)


class SmartTrackRequest(BaseModel):
    text: str = Field(min_length=2)
    date: date_type
    slot_id: UUID | None = None


class EntryUpdate(BaseModel):
    amount: float | None = Field(default=None, gt=0, le=10000)
    slot_id: UUID | None = None
    move_slot: bool = False  # explicit flag so slot_id=None can mean "unassign"


# ── helpers ──────────────────────────────────────────────────────────────────────

def _catalog_error(exc: CatalogUnavailable) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


def _owned_slot(db: Session, user: User, slot_id: UUID) -> NutritionMealSlot:
    slot = db.query(NutritionMealSlot).filter(NutritionMealSlot.id == slot_id, NutritionMealSlot.user_id == user.id).first()
    if slot is None:
        raise HTTPException(status_code=404, detail="Mahlzeit nicht gefunden.")
    return slot


def _owned_entry(db: Session, user: User, entry_id: UUID) -> NutritionEntry:
    entry = db.query(NutritionEntry).filter(NutritionEntry.id == entry_id, NutritionEntry.user_id == user.id).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden.")
    return entry


def _serialize_slot(slot: NutritionMealSlot) -> dict:
    return {"id": str(slot.id), "name": slot.name, "position": slot.position}


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(float(value), digits)


def _serialize_entry(entry: NutritionEntry) -> dict:
    per_100 = entry.per_100 or {}
    return {
        "id": str(entry.id),
        "date": entry.date.isoformat(),
        "slot_id": str(entry.slot_id) if entry.slot_id else None,
        "source": entry.source,
        "source_id": entry.source_id,
        "name": entry.name,
        "brand": entry.brand,
        "unit": entry.unit,
        "amount": _round(entry.amount),
        **{field: _round(getattr(entry, field), 2 if field == "salt" else 1) for field in CORE_FIELDS},
        "per_100": {field: per_100.get(field) for field in CORE_FIELDS},
        "logged_at": entry.logged_at.isoformat() if entry.logged_at else None,
    }


def _apply_amount(entry: NutritionEntry, amount: float) -> None:
    """Recompute totals from the stored per-100 snapshot."""
    entry.amount = amount
    per_100 = entry.per_100 or {}
    for field in CORE_FIELDS:
        value = per_100.get(field)
        total = None if value is None else float(value) * amount / 100.0
        if field in ("kcal", "protein", "carbs", "fat"):
            total = total or 0.0
        setattr(entry, field, total)


def _history(db: Session, user_id: UUID) -> dict[tuple[str, str], int]:
    rows = db.query(NutritionEntry.source, NutritionEntry.source_id, func.count(NutritionEntry.id)).filter(
        NutritionEntry.user_id == user_id,
    ).group_by(NutritionEntry.source, NutritionEntry.source_id).all()
    return {(source, source_id): count for source, source_id, count in rows}


def _recency(db: Session, user_id: UUID) -> dict[tuple[str, str], int]:
    """Days since the user last tracked each food."""
    rows = db.query(NutritionEntry.source, NutritionEntry.source_id, func.max(NutritionEntry.date)).filter(
        NutritionEntry.user_id == user_id,
    ).group_by(NutritionEntry.source, NutritionEntry.source_id).all()
    today = date_type.today()
    return {(source, source_id): max((today - last).days, 0) for source, source_id, last in rows if last}


def _last_amounts(db: Session, user: User, keys: list[tuple[str, str]]) -> dict[tuple[str, str], float]:
    if not keys:
        return {}
    ids = list({source_id for _, source_id in keys})
    rows = db.query(NutritionEntry.source, NutritionEntry.source_id, NutritionEntry.amount, NutritionEntry.logged_at).filter(
        NutritionEntry.user_id == user.id, NutritionEntry.source_id.in_(ids),
    ).order_by(NutritionEntry.logged_at.desc()).all()
    result: dict[tuple[str, str], float] = {}
    for source, source_id, amount, _ in rows:
        result.setdefault((source, source_id), amount)
    return result


def _default_amount(item: dict, last: dict[tuple[str, str], float]) -> float:
    """Last amount the user tracked, else one portion, else 100 g/ml."""
    previous = last.get((item["source"], item["source_id"]))
    if previous:
        return round(previous, 1)
    serving = item.get("serving_g")
    return round(serving, 1) if serving and 0 < serving <= 2000 else 100.0


def _is_complete(food: dict) -> bool:
    return None not in (food.get("kcal"), food.get("protein"), food.get("carbs"), food.get("fat"))


def _track_food(db: Session, user_id: UUID, food: dict, day: date_type, slot_id: UUID | None, amount: float) -> NutritionEntry:
    """Store a diary entry with a nutrient snapshot of the catalog food (caller checks completeness)."""
    per_100 = {field: (None if food.get(field) is None else round(float(food[field]), 4)) for field in CORE_FIELDS}
    entry = NutritionEntry(
        user_id=user_id, slot_id=slot_id, date=day, source=food["source"], source_id=food["source_id"],
        name=food["name"][:300], brand=(food.get("brand") or None), unit=food.get("unit") or "g",
        per_100=per_100, nutrients_per_100=food.get("nutrients") or None,
    )
    _apply_amount(entry, round(amount, 1))
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _totals(entries: list[NutritionEntry]) -> dict:
    totals = {field: 0.0 for field in CORE_FIELDS}
    for entry in entries:
        for field in CORE_FIELDS:
            totals[field] += getattr(entry, field) or 0.0
    return {field: round(value, 2 if field == "salt" else 1) for field, value in totals.items()}


# ── meal slots ───────────────────────────────────────────────────────────────────

@router.get("/slots")
def list_slots(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slots = db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == current_user.id).order_by(
        NutritionMealSlot.position, NutritionMealSlot.created_at).all()
    return {"items": [_serialize_slot(slot) for slot in slots]}


@router.post("/slots", status_code=status.HTTP_201_CREATED)
def create_slot(data: SlotCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == current_user.id).all()
    if len(existing) >= MAX_SLOTS:
        raise HTTPException(status_code=409, detail=f"Maximal {MAX_SLOTS} Mahlzeiten.")
    if any(slot.name.casefold() == data.name.casefold() for slot in existing):
        raise HTTPException(status_code=409, detail="Diese Mahlzeit gibt es schon.")
    slot = NutritionMealSlot(user_id=current_user.id, name=data.name,
                             position=max((slot.position for slot in existing), default=-1) + 1)
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return _serialize_slot(slot)


@router.patch("/slots/{slot_id}")
def rename_slot(slot_id: UUID, data: SlotUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slot = _owned_slot(db, current_user, slot_id)
    clash = db.query(NutritionMealSlot).filter(
        NutritionMealSlot.user_id == current_user.id, NutritionMealSlot.id != slot.id,
        func.lower(NutritionMealSlot.name) == data.name.casefold(),
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail="Diese Mahlzeit gibt es schon.")
    slot.name = data.name
    db.commit()
    return _serialize_slot(slot)


@router.put("/slots/order")
def reorder_slots(data: SlotOrder, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slots = {slot.id: slot for slot in db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == current_user.id).all()}
    if set(data.slot_ids) != set(slots) or len(data.slot_ids) != len(slots):
        raise HTTPException(status_code=422, detail="Die Reihenfolge muss alle Mahlzeiten genau einmal enthalten.")
    for position, slot_id in enumerate(data.slot_ids):
        slots[slot_id].position = position
    db.commit()
    return {"items": [_serialize_slot(slots[slot_id]) for slot_id in data.slot_ids]}


@router.delete("/slots/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_slot(slot_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slot = _owned_slot(db, current_user, slot_id)
    # Tracked food stays in the diary (slot_id becomes NULL), so daily totals never change silently.
    db.delete(slot)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── day and entries ──────────────────────────────────────────────────────────────

@router.get("/day")
def get_day(date: date_type = Query(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slots = db.query(NutritionMealSlot).filter(NutritionMealSlot.user_id == current_user.id).order_by(
        NutritionMealSlot.position, NutritionMealSlot.created_at).all()
    entries = db.query(NutritionEntry).filter(NutritionEntry.user_id == current_user.id, NutritionEntry.date == date).order_by(
        NutritionEntry.logged_at).all()
    by_slot: dict[UUID | None, list[NutritionEntry]] = {}
    for entry in entries:
        by_slot.setdefault(entry.slot_id, []).append(entry)
    unassigned = by_slot.get(None, [])
    return {
        "date": date.isoformat(),
        "totals": _totals(entries),
        "goals": nutrition_native.goals_native(nutrition_native.goal_for_day(nutrition_native.load_goals(db, current_user.id), date)),
        "entry_count": len(entries),
        "slots": [{**_serialize_slot(slot), "totals": _totals(by_slot.get(slot.id, [])), "entry_count": len(by_slot.get(slot.id, []))}
                  for slot in slots],
        "unassigned": {"totals": _totals(unassigned), "entry_count": len(unassigned)},
    }


@router.get("/entries")
def list_entries(
    date: date_type = Query(...),
    slot_id: UUID | None = Query(None),
    unassigned: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(NutritionEntry).filter(NutritionEntry.user_id == current_user.id, NutritionEntry.date == date)
    if slot_id is not None:
        query = query.filter(NutritionEntry.slot_id == slot_id)
    elif unassigned:
        query = query.filter(NutritionEntry.slot_id.is_(None))
    entries = query.order_by(NutritionEntry.logged_at).all()
    return {"items": [_serialize_entry(entry) for entry in entries], "totals": _totals(entries)}


@router.post("/entries", status_code=status.HTTP_201_CREATED)
def create_entry(data: EntryCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.slot_id is not None:
        _owned_slot(db, current_user, data.slot_id)
    try:
        food = food_catalog.get_food(data.source, data.source_id)
    except CatalogUnavailable as exc:
        raise _catalog_error(exc) from exc
    if food is None:
        raise HTTPException(status_code=404, detail="Lebensmittel nicht gefunden.")
    if not _is_complete(food):
        raise HTTPException(status_code=422, detail="Für dieses Produkt fehlen Nährwerte.")
    entry = _track_food(db, current_user.id, food, data.date, data.slot_id, data.amount)
    return _serialize_entry(entry)


@router.post("/smart-track")
async def smart_track(data: SmartTrackRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Free text -> several diary entries. Streams ``parsed``, one ``item`` per food and ``done`` as SSE."""
    if data.slot_id is not None:
        _owned_slot(db, current_user, data.slot_id)
    user_id = current_user.id

    async def event_stream():
        # The request's session is closed once the response starts, so the stream owns its own.
        session = SessionLocal()
        try:
            history = _history(session, user_id)
            recency = _recency(session, user_id)

            def store(candidate: dict, amount: float) -> dict:
                try:
                    food = food_catalog.get_food(candidate["source"], candidate["source_id"])
                    if food is None or not _is_complete(food):
                        raise ValueError("Food missing or incomplete")
                    return _serialize_entry(_track_food(session, user_id, food, data.date, data.slot_id, amount))
                except Exception:
                    session.rollback()
                    raise

            async for event in food_smart_track.smart_track_events(data.text, history, recency, store):
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            session.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.patch("/entries/{entry_id}")
def update_entry(entry_id: UUID, data: EntryUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = _owned_entry(db, current_user, entry_id)
    if data.amount is not None:
        _apply_amount(entry, round(data.amount, 1))
    if data.move_slot:
        if data.slot_id is not None:
            _owned_slot(db, current_user, data.slot_id)
        entry.slot_id = data.slot_id
    db.commit()
    db.refresh(entry)
    return _serialize_entry(entry)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = _owned_entry(db, current_user, entry_id)
    db.delete(entry)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── catalog ──────────────────────────────────────────────────────────────────────

@router.get("/recent")
def recent_foods(limit: int = Query(100, ge=1, le=100), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The last distinct products the user tracked, newest first, served from diary snapshots."""
    entries = db.query(NutritionEntry).filter(NutritionEntry.user_id == current_user.id).order_by(
        NutritionEntry.logged_at.desc()).limit(1500).all()
    history = _history(db, current_user.id)
    seen: set[tuple[str, str]] = set()
    items = []
    for entry in entries:
        key = (entry.source, entry.source_id)
        if key in seen:
            continue
        seen.add(key)
        per_100 = entry.per_100 or {}
        items.append({
            "source": entry.source, "source_id": entry.source_id, "name": entry.name, "brand": entry.brand, "unit": entry.unit,
            "kcal": per_100.get("kcal"), "protein": per_100.get("protein"), "carbs": per_100.get("carbs"), "fat": per_100.get("fat"),
            "serving_g": None, "serving_label": None, "tracked_count": history.get(key, 0), "default_amount": round(entry.amount, 1),
        })
        if len(items) >= limit:
            break
    return {"items": items}


@router.get("/search")
def search_foods(q: str = Query("", max_length=120), limit: int = Query(30, ge=1, le=50),
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    history = _history(db, current_user.id)
    try:
        items = food_catalog.search(q, limit=limit, history=history)
    except CatalogUnavailable as exc:
        raise _catalog_error(exc) from exc
    last = _last_amounts(db, current_user, [(item["source"], item["source_id"]) for item in items])
    return {"query": q, "items": [{**item, "default_amount": _default_amount(item, last)} for item in items]}


@router.get("/barcode/{code}")
def lookup_barcode(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        food = food_catalog.lookup_barcode(code)
    except CatalogUnavailable as exc:
        raise _catalog_error(exc) from exc
    if food is None:
        raise HTTPException(status_code=404, detail="Zu diesem Barcode gibt es noch kein Produkt.")
    return _detail_response(db, current_user, food)


@router.get("/foods/{source}/{source_id}")
def get_food(source: Literal["bls", "off"], source_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        food = food_catalog.get_food(source, source_id)
    except CatalogUnavailable as exc:
        raise _catalog_error(exc) from exc
    if food is None:
        raise HTTPException(status_code=404, detail="Lebensmittel nicht gefunden.")
    return _detail_response(db, current_user, food)


def _detail_response(db: Session, user: User, food: dict) -> dict:
    history = _history(db, user.id)
    detail = food_catalog.detail(food, history)
    last = _last_amounts(db, user, [(detail["source"], detail["source_id"])])
    complete = None not in (detail["kcal"], detail["protein"], detail["carbs"], detail["fat"])
    return {**detail, "default_amount": _default_amount(detail, last), "trackable": complete}
