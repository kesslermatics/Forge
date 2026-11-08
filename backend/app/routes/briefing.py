"""
Coaching routes – body weight, training analytics, consistency and the coach chat.
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta

from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models import ChatConversation, ChatMessage, ForgeWorkoutSession, NutritionEntry, ProfileGoal, User, WeightClothingItem
from app.services import profile_goals
from app.services.chat_agent import refresh_chat_summary, run_chat_agent
from app.services.forge_session_adapter import completed_forge_workouts
from app.services.analytics_service import compute_progressive_overload, compute_consistency_timeline
from app.services.profile_goals import GoalError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/briefing", tags=["Briefing"])


BERLIN = ZoneInfo("Europe/Berlin")
DateType = date  # alias: a pydantic field named "date" would shadow the type inside its own class


def _berlin_today() -> date:
    """Forge counts days in Europe/Berlin; the server clock is UTC."""
    return datetime.now(BERLIN).date()


class WeightUpsert(BaseModel):
    weight_kg: float = Field(ge=20, le=400)
    date: DateType | None = None  # defaults to today (Berlin)

    @field_validator("weight_kg")
    @classmethod
    def one_decimal(cls, value: float) -> float:
        return round(value, 1)


ClothingIcon = Literal["shirt", "pants", "shorts", "phone", "shoes", "watch", "wallet", "keys", "glasses", "backpack", "headphones"]
MAX_CLOTHING_ITEMS = 6
DEFAULT_CLOTHING = [("Shorts", 200, "shorts"), ("Hose", 600, "pants"), ("Hemd", 200, "shirt"), ("Handy", 200, "phone")]


class ClothingItemIn(BaseModel):
    id: UUID | None = None  # existing items keep their id so the client's selection stays valid
    name: str = Field(min_length=1, max_length=24)
    weight_g: int = Field(ge=1, le=5000)
    icon: ClothingIcon

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Der Name darf nicht leer sein.")
        return value


class ClothingUpdate(BaseModel):
    items: list[ClothingItemIn] = Field(min_length=1, max_length=MAX_CLOTHING_ITEMS)










# ════════════════════════════════════════════════════════
#  AI CHAT — conversational coaching
# ════════════════════════════════════════════════════════

class ChatSendRequest(BaseModel):
    message: str = Field(min_length=1, max_length=16000)
    message_id: UUID | None = None

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Die Nachricht darf nicht leer sein.")
        return value


def _iso(value):
    return value.isoformat() if value is not None else None


def _serialize_chat_message(message: ChatMessage) -> dict:
    return {
        "id": str(message.id),
        "sequence": message.sequence,
        "role": message.role,
        "content": message.content,
        "status": message.status,
        "agent_details": message.agent_details or [],
        "created_at": _iso(message.created_at),
    }


def _serialize_conversation(conversation: ChatConversation, include_messages: bool = True) -> dict:
    payload = {
        "id": str(conversation.id),
        "title": conversation.title,
        "summary": conversation.summary,
        "created_at": _iso(conversation.created_at),
        "updated_at": _iso(conversation.updated_at),
        "message_count": len(conversation.messages),
    }
    if include_messages:
        payload["messages"] = [
            _serialize_chat_message(item)
            for item in sorted(conversation.messages, key=lambda value: value.sequence)
        ]
    return payload


def _owned_chat(db: Session, user_id, conversation_id: UUID) -> ChatConversation:
    conversation = db.query(ChatConversation).filter(
        ChatConversation.id == conversation_id,
        ChatConversation.user_id == user_id,
    ).first()
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat nicht gefunden.")
    return conversation


def _append_chat_message(
    conversation: ChatConversation,
    role: str,
    content: str,
    message_status: str = "completed",
    agent_details: list[dict] | None = None,
) -> ChatMessage:
    message = ChatMessage(
        conversation_id=conversation.id,
        sequence=conversation.next_sequence,
        role=role,
        content=content[:16000],
        status=message_status,
        agent_details=agent_details,
    )
    conversation.next_sequence += 1
    conversation.messages.append(message)
    return message


@router.post("/chat/conversations", status_code=status.HTTP_201_CREATED)
async def create_chat_conversation(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start one new Coach conversation; previous chats are intentionally not exposed."""
    conversation = ChatConversation(user_id=current_user.id, title="Coach Chat")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return _serialize_conversation(conversation)


@router.post("/chat/conversations/{conversation_id}/messages/stream")
async def stream_chat_message(
    conversation_id: UUID,
    body: ChatSendRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = _owned_chat(db, current_user.id, conversation_id)
    if body.message_id is not None:
        user_message = db.query(ChatMessage).filter(
            ChatMessage.id == body.message_id,
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.role == "user",
        ).first()
        if user_message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User-Nachricht nicht gefunden.")
        db.query(ChatMessage).filter(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.sequence > user_message.sequence,
        ).delete(synchronize_session=False)
        user_message.content = body.message.strip()
        user_message.status = "completed"
        conversation.next_sequence = user_message.sequence + 1
        conversation.summary = None
        conversation.summary_until_sequence = None
        previous_messages = db.query(ChatMessage).filter(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.sequence < user_message.sequence,
            ChatMessage.status == "completed",
        ).order_by(ChatMessage.sequence.asc()).all()
    else:
        previous_messages = db.query(ChatMessage).filter(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.status == "completed",
        ).order_by(ChatMessage.sequence.asc()).all()
        user_message = _append_chat_message(conversation, "user", body.message.strip())
    db.commit()

    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    agent_details: list[dict] = []

    def capture_agent_detail(event: dict) -> None:
        event_type = event.get("type")
        if event_type == "thinking" and event.get("text"):
            agent_details.append({
                "type": "thinking",
                "text": str(event["text"])[:600],
                "round": event.get("round"),
            })
        elif event_type == "tool_started" and event.get("tool"):
            agent_details.append({
                "type": "tool",
                "tool": str(event["tool"]),
                "label": str(event.get("label") or "Ich prüfe deine Daten.")[:240],
                "round": event.get("round"),
                "call": event.get("call"),
                "status": "completed",
            })
        elif event_type == "summary_started":
            agent_details.append({
                "type": "summary",
                "text": str(event.get("label") or "Älterer Verlauf zusammenfassen.")[:240],
                "status": "completed",
            })

    async def emit(event: dict):
        capture_agent_detail(event)
        await queue.put(event)

    async def run_agent():
        try:
            answer = await run_chat_agent(
                user=current_user,
                db=db,
                message=user_message.content,
                history=[{"role": item.role, "content": item.content} for item in previous_messages],
                summary=conversation.summary,
                emit=emit,
            )
            assistant = _append_chat_message(conversation, "assistant", answer, agent_details=agent_details)
            conversation.updated_at = datetime.utcnow()
            await refresh_chat_summary(conversation, db, current_user, emit)
            assistant.agent_details = agent_details
            db.commit()
            await queue.put({"type": "completed", "message": _serialize_chat_message(assistant), "conversation": _serialize_conversation(conversation, include_messages=False)})
        except asyncio.CancelledError:
            db.rollback()
            try:
                _append_chat_message(
                    conversation,
                    "assistant",
                    "Diese Anfrage wurde abgebrochen.",
                    message_status="aborted",
                    agent_details=agent_details,
                )
                conversation.updated_at = datetime.utcnow()
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Could not persist aborted global Coach turn")
            raise
        except Exception:
            logger.exception("Global Coach agent failed")
            db.rollback()
            try:
                _append_chat_message(
                    conversation,
                    "assistant",
                    "Der Coach konnte gerade keine Antwort erstellen.",
                    message_status="error",
                    agent_details=agent_details,
                )
                conversation.updated_at = datetime.utcnow()
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Could not persist failed global Coach turn")
            await queue.put({"type": "error", "message": "Der Coach konnte gerade keine Antwort erstellen."})
        finally:
            await queue.put(None)

    task = asyncio.create_task(run_agent())

    async def event_stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        task.cancel()
                        break
                    continue
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ════════════════════════════════════════════════════════
#  ANALYTICS ENDPOINTS
# ════════════════════════════════════════════════════════
























# ════════════════════════════════════════════════════════
#  WEIGHT, TRAINING ANALYTICS, CONSISTENCY
# ════════════════════════════════════════════════════════

@router.put("/weight")
def save_weight(
    data: WeightUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add one weight measurement (a day can have several; the same value again within minutes is ignored)."""
    try:
        return profile_goals.save_weight(db, current_user, data.weight_kg, data.date)
    except GoalError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/weight/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weight(
    entry_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not profile_goals.delete_weight(db, current_user, entry_id):
        raise HTTPException(status_code=404, detail="Messung nicht gefunden.")


@router.get("/weight-clothing")
def get_weight_clothing(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The user's fixed list of things to subtract from the scale reading (defaults on first use)."""
    items = _clothing_rows(db, current_user.id)
    if not items:
        for position, (name, weight_g, icon) in enumerate(DEFAULT_CLOTHING):
            db.add(WeightClothingItem(user_id=current_user.id, name=name, weight_g=weight_g, icon=icon, position=position))
        db.commit()
        items = _clothing_rows(db, current_user.id)
    return {"items": [_serialize_clothing(item) for item in items]}


@router.put("/weight-clothing")
def save_weight_clothing(
    data: ClothingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the whole list; items sent with a known id are updated in place."""
    existing = {item.id: item for item in _clothing_rows(db, current_user.id)}
    kept: set = set()
    for position, payload in enumerate(data.items):
        row = existing.get(payload.id) if payload.id else None
        if row is None:
            row = WeightClothingItem(user_id=current_user.id)
            db.add(row)
        elif row.id in kept:
            raise HTTPException(status_code=422, detail="Ein Eintrag wurde doppelt gesendet.")
        row.name, row.weight_g, row.icon, row.position = payload.name, payload.weight_g, payload.icon, position
        if row.id is not None:
            kept.add(row.id)
    for item_id, row in existing.items():
        if item_id not in kept:
            db.delete(row)
    db.commit()
    return {"items": [_serialize_clothing(item) for item in _clothing_rows(db, current_user.id)]}


def _clothing_rows(db: Session, user_id) -> list[WeightClothingItem]:
    return db.query(WeightClothingItem).filter(WeightClothingItem.user_id == user_id).order_by(WeightClothingItem.position).all()


def _serialize_clothing(item: WeightClothingItem) -> dict:
    return {"id": str(item.id), "name": item.name, "weight_g": item.weight_g, "icon": item.icon}


@router.get("/weight-history")
def get_weight_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    days: int = Query(90, ge=7, le=3650),
    start_date: str | None = Query(None, description="ISO date string YYYY-MM-DD; overrides the profile start date and 'days'"),
):
    """Weight history plus the profile weight goal.

    ``entries`` has one value per day (mean of that day's measurements); ``today`` lists today's single
    measurements. Window: explicit ``start_date``, else the profile goal's start date, else the last ``days``.
    ``latest`` is the newest measurement regardless of the window.
    """
    today_date = _berlin_today()
    profile = db.query(ProfileGoal).filter(ProfileGoal.user_id == current_user.id).first()

    if start_date:
        try:
            cutoff = date.fromisoformat(start_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="start_date must be a valid ISO date (YYYY-MM-DD)")
    elif profile is not None and profile.start_date is not None:
        cutoff = profile.start_date
    else:
        cutoff = today_date - timedelta(days=days)
    cutoff = min(cutoff, today_date)
    cutoff = max(cutoff, today_date - timedelta(days=3650))

    latest = profile_goals.latest_weight(db, current_user.id)
    entries = profile_goals.daily_weights(db, current_user.id, cutoff)
    return {
        "entries": [{"date": e.date.isoformat(), "weight_kg": e.weight_kg} for e in entries],
        "today": profile_goals.day_measurements(db, current_user.id, today_date),
        "start_weight": entries[0].weight_kg if entries else None,
        "current_weight": entries[-1].weight_kg if entries else None,
        "latest": profile_goals.serialize_weight(latest) if latest else None,
        "goal": {
            "start_kg": profile.start_weight_kg if profile else None,
            "start_date": profile.start_date.isoformat() if profile and profile.start_date else None,
            "target_kg": profile.target_weight_kg if profile else None,
            "target_date": profile.target_date.isoformat() if profile and profile.target_date else None,
        },
        "count": len(entries),
    }


@router.get("/workouts")
def get_workout_list(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The user's recent completed Forge sessions as a lightweight picker list."""
    workouts = completed_forge_workouts(db, current_user.id, limit=20)
    return [
        {
            "index": i,
            "title": w.get("title", "Workout"),
            "date": (w.get("start_time") or "")[:10],
            "duration_min": w.get("duration_min"),
            "exercise_names": [ex.get("title", "?") for ex in w.get("exercises", [])],
        }
        for i, w in enumerate(workouts)
    ]


@router.get("/progressive-overload")
def get_progressive_overload(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-exercise progression over time."""
    return compute_progressive_overload(completed_forge_workouts(db, current_user.id, limit=20))


@router.get("/consistency")
def get_consistency(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The compact 14-day dashboard timeline (training and food logging) and its streak metrics."""
    workout_dates = [
        completed_at.date().isoformat()
        for (completed_at,) in db.query(ForgeWorkoutSession.completed_at).filter(
            ForgeWorkoutSession.user_id == current_user.id,
            ForgeWorkoutSession.status == "completed",
            ForgeWorkoutSession.completed_at.isnot(None),
        ).all()
        if completed_at is not None
    ]
    since = _berlin_today() - timedelta(days=90)
    nutrition_dates = [
        day.isoformat()
        for (day,) in db.query(NutritionEntry.date).filter(
            NutritionEntry.user_id == current_user.id, NutritionEntry.date >= since,
        ).distinct().all()
    ]
    return compute_consistency_timeline(workout_dates, nutrition_dates)
