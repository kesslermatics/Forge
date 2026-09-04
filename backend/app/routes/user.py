"""
User routes for profile and API key management.
"""
from datetime import datetime, timedelta, timezone
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import GoogleHealthConnection, GoogleHealthOAuthState, GoogleHealthWorkoutExport, User
from app.schemas import (
    GoogleHealthConnectResponse, GoogleHealthStatusResponse,
    UserResponse,
    YazioCredentialsUpdate, YazioCredentialsResponse,
    LanguageUpdate, LanguageResponse,
    TrainingPlanUpdate, TrainingPlanResponse,
    ProfileUpdate, ProfileResponse,
)
from app.dependencies import get_current_user
from app.encryption import encrypt_value
from app.services.google_health_service import (
    GOOGLE_HEALTH_WRITE_SCOPE,
    GoogleHealthAuthorizationError,
    GoogleHealthConfigurationError,
    exchange_authorization_code,
    is_google_health_configured,
    require_google_health_configuration,
)

router = APIRouter(prefix="/user", tags=["User"])


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current account information without exposing any provider credentials."""
    google_connection = db.query(GoogleHealthConnection).filter(
        GoogleHealthConnection.user_id == current_user.id,
        GoogleHealthConnection.status == "connected",
    ).first()
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        has_yazio=current_user.yazio_email is not None,
        has_google_health=google_connection is not None,
        first_name=current_user.first_name,
        height_cm=current_user.height_cm,
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


@router.patch("/profile", response_model=ProfileResponse)
async def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user-managed profile fields without touching credentials or daily weight history."""
    updates = data.model_dump(exclude_unset=True)
    if "first_name" in updates:
        current_user.first_name = updates["first_name"].strip() if updates["first_name"] and updates["first_name"].strip() else None
    if "height_cm" in updates:
        current_user.height_cm = updates["height_cm"]
    db.commit()
    db.refresh(current_user)
    return ProfileResponse(
        message="Profile updated successfully",
        first_name=current_user.first_name,
        height_cm=current_user.height_cm,
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


def _google_health_settings_redirect(result: str) -> RedirectResponse:
    query = urlencode({"google_health": result})
    return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/settings?{query}", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/google-health", response_model=GoogleHealthStatusResponse)
async def get_google_health_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return provider connection and export state without exposing OAuth tokens."""
    connection = db.query(GoogleHealthConnection).filter(GoogleHealthConnection.user_id == current_user.id).first()
    latest_export = db.query(GoogleHealthWorkoutExport).filter(
        GoogleHealthWorkoutExport.user_id == current_user.id,
        GoogleHealthWorkoutExport.status == "exported",
    ).order_by(GoogleHealthWorkoutExport.exported_at.desc()).first()
    failed_exports = db.query(GoogleHealthWorkoutExport).filter(
        GoogleHealthWorkoutExport.user_id == current_user.id,
        GoogleHealthWorkoutExport.status == "failed",
    ).count()
    return GoogleHealthStatusResponse(
        configured=is_google_health_configured(),
        connected=connection is not None and connection.status == "connected",
        status=connection.status if connection else "not_connected",
        last_error=connection.last_error if connection else None,
        last_exported_at=latest_export.exported_at if latest_export else None,
        failed_exports=failed_exports,
    )


@router.post("/google-health/connect", response_model=GoogleHealthConnectResponse)
async def start_google_health_connection(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a short-lived CSRF state and return Google's OAuth consent URL."""
    try:
        require_google_health_configuration()
    except GoogleHealthConfigurationError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    now = datetime.now(timezone.utc)
    db.query(GoogleHealthOAuthState).filter(GoogleHealthOAuthState.expires_at < now).delete()
    state = secrets.token_urlsafe(32)
    db.add(GoogleHealthOAuthState(state=state, user_id=current_user.id, expires_at=now + timedelta(minutes=10)))
    db.commit()
    authorization_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": settings.google_health_client_id,
        "redirect_uri": settings.google_health_redirect_uri,
        "response_type": "code",
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "scope": GOOGLE_HEALTH_WRITE_SCOPE,
        "state": state,
    })
    return GoogleHealthConnectResponse(authorization_url=authorization_url)


@router.get("/google-health/callback")
async def complete_google_health_connection(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """Validate the single-use state, persist encrypted OAuth tokens, then return to settings."""
    oauth_state = db.query(GoogleHealthOAuthState).filter(GoogleHealthOAuthState.state == (state or "")).first()
    if oauth_state is None or oauth_state.expires_at < datetime.now(timezone.utc):
        if oauth_state is not None:
            db.delete(oauth_state)
            db.commit()
        return _google_health_settings_redirect("invalid_state")
    user_id = oauth_state.user_id
    db.delete(oauth_state)
    db.commit()
    if error or not code:
        return _google_health_settings_redirect("declined")

    try:
        token_data = await exchange_authorization_code(code)
        connection = db.query(GoogleHealthConnection).filter(GoogleHealthConnection.user_id == user_id).first()
        refresh_token = token_data.get("refresh_token")
        if connection is None and not refresh_token:
            raise GoogleHealthAuthorizationError("Google hat kein Refresh-Token zurückgegeben. Bitte stimme erneut zu.")
        if connection is None:
            connection = GoogleHealthConnection(
                user_id=user_id,
                refresh_token=encrypt_value(refresh_token),
                scope=token_data.get("scope") or GOOGLE_HEALTH_WRITE_SCOPE,
            )
            db.add(connection)
        elif refresh_token:
            connection.refresh_token = encrypt_value(refresh_token)
        connection.access_token = encrypt_value(token_data["access_token"])
        connection.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(1, int(token_data.get("expires_in", 3600))))
        connection.scope = token_data.get("scope") or GOOGLE_HEALTH_WRITE_SCOPE
        connection.status = "connected"
        connection.last_error = None
        db.commit()
    except (GoogleHealthConfigurationError, GoogleHealthAuthorizationError, httpx.HTTPError, ValueError):
        return _google_health_settings_redirect("failed")
    return _google_health_settings_redirect("connected")


@router.delete("/google-health", response_model=GoogleHealthStatusResponse)
async def disconnect_google_health(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Forget local OAuth credentials; Google access can also be revoked in the Google account."""
    connection = db.query(GoogleHealthConnection).filter(GoogleHealthConnection.user_id == current_user.id).first()
    if connection is not None:
        db.delete(connection)
        db.commit()
    return await get_google_health_status(current_user=current_user, db=db)
