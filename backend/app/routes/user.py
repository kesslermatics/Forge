"""
User routes for profile and API key management.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import (
    UserResponse,
    YazioCredentialsUpdate, YazioCredentialsResponse,
    GoalUpdate, GoalResponse,
    LanguageUpdate, LanguageResponse,
    TrainingPlanUpdate, TrainingPlanResponse,
)
from app.dependencies import get_current_user
from app.encryption import encrypt_value

router = APIRouter(prefix="/user", tags=["User"])


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get current authenticated user's information.
    Returns user profile excluding sensitive data.
    """
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        has_yazio=current_user.yazio_email is not None,
        current_goal=current_user.current_goal,
        target_weight=current_user.target_weight,
        first_name=current_user.first_name,
        language=current_user.language or "de",
        training_plan=current_user.training_plan,
    )


@router.post("/yazio", response_model=YazioCredentialsResponse)
async def update_yazio_credentials(
    creds: YazioCredentialsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Save or update Yazio credentials for the current user.
    Credentials are encrypted before storage.
    """
    current_user.yazio_email = encrypt_value(creds.yazio_email)
    current_user.yazio_password = encrypt_value(creds.yazio_password)
    db.commit()
    db.refresh(current_user)

    return YazioCredentialsResponse(
        message="Yazio credentials saved successfully",
        has_yazio=True
    )


@router.delete("/yazio", response_model=YazioCredentialsResponse)
async def delete_yazio_credentials(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove Yazio credentials for the current user."""
    current_user.yazio_email = None
    current_user.yazio_password = None
    db.commit()
    db.refresh(current_user)

    return YazioCredentialsResponse(
        message="Yazio credentials removed successfully",
        has_yazio=False
    )


@router.post("/goal", response_model=GoalResponse)
async def update_goal(
    data: GoalUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the user's fitness goal and optional target weight."""
    current_user.current_goal = data.current_goal
    current_user.target_weight = data.target_weight
    db.commit()
    db.refresh(current_user)

    return GoalResponse(
        message="Goal updated successfully",
        current_goal=current_user.current_goal,
        target_weight=current_user.target_weight,
    )


@router.post("/language", response_model=LanguageResponse)
async def update_language(
    data: LanguageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the user's preferred language (de or en)."""
    current_user.language = data.language
    db.commit()
    db.refresh(current_user)

    return LanguageResponse(
        message="Language updated successfully",
        language=current_user.language,
    )


@router.post("/training-plan", response_model=TrainingPlanResponse)
async def update_training_plan(
    data: TrainingPlanUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the user's training plan (list of workout names)."""
    current_user.training_plan = data.workout_names
    db.commit()
    db.refresh(current_user)

    return TrainingPlanResponse(
        message="Training plan updated successfully",
        training_plan=current_user.training_plan or [],
    )


@router.get("/training-plan", response_model=TrainingPlanResponse)
async def get_training_plan(
    current_user: User = Depends(get_current_user),
):
    """Get the user's current training plan."""
    return TrainingPlanResponse(
        message="OK",
        training_plan=current_user.training_plan or [],
    )
