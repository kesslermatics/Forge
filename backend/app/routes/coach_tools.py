"""Read-only Coach context tools exposed for API-key-backed MCP adapters."""
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user_or_api_key
from app.models import User
from app.services.chat_agent import execute_coach_tool

CoachToolName = Literal[
    "get_user_profile",
    "get_goals",
    "get_training_plan",
    "get_latest_workout",
    "get_workouts",
    "get_exercise_history",
    "get_nutrition_day",
    "get_nutrition_range",
    "get_steps",
    "get_sleep",
    "get_weight_history",
    "get_volume_and_frequency_analysis",
    "get_strength_progression_analytics",
    "get_metabolic_trend_analysis",
    "get_macro_adherence_score",
    "get_sleep_and_performance_correlation",
    "get_performance_correlations",
    "project_goal_timeline",
]


class CoachToolRequest(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


class CoachToolResponse(BaseModel):
    tool: CoachToolName
    result: dict[str, Any]


router = APIRouter(prefix="/api/coach/tools", tags=["Coach Tools"])


@router.post("/{tool_name}", response_model=CoachToolResponse)
async def call_coach_tool(
    tool_name: CoachToolName,
    body: CoachToolRequest,
    current_user: User = Depends(get_current_user_or_api_key),
    db: Session = Depends(get_db),
):
    """Execute one allow-listed, read-only tool in the authenticated user's context."""
    try:
        result = await execute_coach_tool(tool_name, body.arguments, current_user, db)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Coach tool could not load its data",
        ) from exc
    return CoachToolResponse(tool=tool_name, result=result)
