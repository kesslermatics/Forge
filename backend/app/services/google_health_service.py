"""Google Health API OAuth token handling and Forge workout export."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.encryption import decrypt_value, encrypt_value
from app.models import GoogleHealthConnection, GoogleHealthWorkoutExport, ForgeWorkoutSession

GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_HEALTH_EXERCISE_URL = "https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints"
GOOGLE_HEALTH_WRITE_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly"


class GoogleHealthConfigurationError(RuntimeError):
    """Raised when an administrator has not configured this optional integration."""


class GoogleHealthAuthorizationError(RuntimeError):
    """Raised when a user must reconnect their Google account."""


def is_google_health_configured() -> bool:
    return bool(
        settings.google_health_client_id
        and settings.google_health_client_secret
        and settings.google_health_redirect_uri
    )


def require_google_health_configuration() -> None:
    if not is_google_health_configured():
        raise GoogleHealthConfigurationError(
            "Google Health ist noch nicht konfiguriert. Bitte hinterlege die Google-OAuth-Credentials im Backend."
        )


def _utc_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_workout_payload(session: ForgeWorkoutSession) -> dict[str, Any]:
    """Map a completed Forge session to Google's exercise-session record.

    Google Health exercise sessions currently carry overall workout metadata;
    the API schema has no fields for per-set repetitions or lifted weight.
    """
    if not session.completed_at:
        raise ValueError("Only completed Forge sessions can be exported.")
    started_at = session.started_at if session.started_at.tzinfo else session.started_at.replace(tzinfo=timezone.utc)
    completed_at = session.completed_at if session.completed_at.tzinfo else session.completed_at.replace(tzinfo=timezone.utc)
    active_seconds = max(1, int((completed_at - started_at).total_seconds()))
    return {
        "dataSource": {"recordingMethod": "ACTIVELY_MEASURED"},
        "exercise": {
            "interval": {
                "startTime": _utc_timestamp(started_at),
                "startUtcOffset": "0s",
                "endTime": _utc_timestamp(completed_at),
                "endUtcOffset": "0s",
            },
            "exerciseType": "STRENGTH_TRAINING",
            "displayName": session.name,
            "activeDuration": f"{active_seconds}s",
        },
    }


async def exchange_authorization_code(code: str) -> dict[str, Any]:
    """Exchange a Google authorization code for a refreshable token grant."""
    require_google_health_configuration()
    data = {
        "code": code,
        "client_id": settings.google_health_client_id,
        "client_secret": settings.google_health_client_secret,
        "redirect_uri": settings.google_health_redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(GOOGLE_OAUTH_TOKEN_URL, data=data)
    if response.is_error:
        raise GoogleHealthAuthorizationError("Google hat die Autorisierung abgelehnt. Bitte verbinde dein Konto erneut.")
    payload = response.json()
    if not payload.get("access_token"):
        raise GoogleHealthAuthorizationError("Google hat kein Zugriffstoken zurückgegeben.")
    return payload


async def _access_token(connection: GoogleHealthConnection, db: Session) -> str:
    """Return a valid access token, refreshing it only when a workout is exported."""
    now = datetime.now(timezone.utc)
    if connection.access_token and connection.token_expires_at and connection.token_expires_at > now + timedelta(seconds=60):
        return decrypt_value(connection.access_token)

    require_google_health_configuration()
    data = {
        "client_id": settings.google_health_client_id,
        "client_secret": settings.google_health_client_secret,
        "refresh_token": decrypt_value(connection.refresh_token),
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(GOOGLE_OAUTH_TOKEN_URL, data=data)
    if response.is_error:
        connection.status = "reauthorization_required"
        connection.last_error = "Die Google-Autorisierung ist abgelaufen oder wurde widerrufen."
        db.commit()
        raise GoogleHealthAuthorizationError(connection.last_error)

    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise GoogleHealthAuthorizationError("Google hat kein erneuertes Zugriffstoken zurückgegeben.")
    connection.access_token = encrypt_value(token)
    connection.token_expires_at = now + timedelta(seconds=max(1, int(payload.get("expires_in", 3600))))
    connection.status = "connected"
    connection.last_error = None
    db.commit()
    return token


async def export_completed_session(db: Session, session: ForgeWorkoutSession) -> GoogleHealthWorkoutExport | None:
    """Export once after the local completion commit; never fail local workout completion."""
    connection = db.query(GoogleHealthConnection).filter(
        GoogleHealthConnection.user_id == session.user_id,
        GoogleHealthConnection.status == "connected",
    ).first()
    if connection is None:
        return None

    export = db.query(GoogleHealthWorkoutExport).filter(
        GoogleHealthWorkoutExport.session_id == session.id,
    ).first()
    if export and export.status == "exported":
        return export
    if export is None:
        export = GoogleHealthWorkoutExport(user_id=session.user_id, session_id=session.id, status="pending")
        db.add(export)
        db.commit()

    export.attempt_count += 1
    export.attempted_at = datetime.now(timezone.utc)
    export.status = "exporting"
    export.last_error = None
    db.commit()

    try:
        token = await _access_token(connection, db)
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                GOOGLE_HEALTH_EXERCISE_URL,
                json=build_workout_payload(session),
                headers={"Authorization": f"Bearer {token}", "Accept-Language": "de"},
            )
        if response.is_error:
            raise RuntimeError("Google Health hat den Workout-Export abgelehnt.")
        payload = response.json()
        result = payload.get("response") if isinstance(payload, dict) else None
        export.external_data_point_name = result.get("name") if isinstance(result, dict) else None
        export.status = "exported"
        export.exported_at = datetime.now(timezone.utc)
        export.last_error = None
    except (GoogleHealthAuthorizationError, GoogleHealthConfigurationError) as error:
        export.status = "failed"
        export.last_error = str(error)
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        export.status = "failed"
        export.last_error = str(error)[:1000]
    finally:
        db.commit()
        db.refresh(export)
    return export
