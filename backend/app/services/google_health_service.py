"""Google Health API OAuth token handling and Forge workout export."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)
from app.encryption import decrypt_value, encrypt_value
from app.models import GoogleHealthConnection, GoogleHealthWorkoutExport, ForgeWorkoutSession

GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_HEALTH_EXERCISE_URL = "https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints"
GOOGLE_HEALTH_STEPS_URL = "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp"
GOOGLE_HEALTH_SLEEP_URL = "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints"

# Legacy constant kept for backwards compat — new connections request all three scopes.
GOOGLE_HEALTH_WRITE_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly"
GOOGLE_HEALTH_READ_ACTIVITY_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"
GOOGLE_HEALTH_READ_SLEEP_SCOPE = "https://www.googleapis.com/auth/googlehealth.sleep.readonly"

GOOGLE_HEALTH_SCOPES = " ".join([
    GOOGLE_HEALTH_WRITE_SCOPE,
    GOOGLE_HEALTH_READ_ACTIVITY_SCOPE,
    GOOGLE_HEALTH_READ_SLEEP_SCOPE,
])


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


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def connection_has_scope(connection: GoogleHealthConnection, scope: str) -> bool:
    """Return True when the stored scope string includes the requested scope."""
    return scope in (connection.scope or "")


async def fetch_steps(
    connection: GoogleHealthConnection,
    db: Session,
    target_date: "date | None" = None,
) -> dict:
    """Fetch step count and activity calories for *target_date* from Google Health.

    Returns a dict with keys: available, date, steps, activity_kcal.
    On auth / scope errors returns available=False with a reason string.
    """
    from datetime import date as _date  # local import to avoid circular at module level
    if target_date is None:
        target_date = _date.today()

    if not connection_has_scope(connection, GOOGLE_HEALTH_READ_ACTIVITY_SCOPE):
        return {
            "available": False,
            "reason": "Dein Google-Konto muss neu verbunden werden, um Schritte lesen zu können.",
            "needs_reauth": True,
        }

    try:
        token = await _access_token(connection, db)
    except GoogleHealthAuthorizationError as exc:
        return {"available": False, "reason": str(exc)}

    # dailyRollUp uses POST with a JSON body and CivilTimeInterval (local date, no UTC shift)
    body = {
        "range": {
            "start": {
                "date": {"year": target_date.year, "month": target_date.month, "day": target_date.day},
            },
            "end": {
                "date": {
                    "year": (target_date + timedelta(days=1)).year,
                    "month": (target_date + timedelta(days=1)).month,
                    "day": (target_date + timedelta(days=1)).day,
                },
            },
        },
        "windowSizeDays": 1,
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            GOOGLE_HEALTH_STEPS_URL,
            json=body,
            headers={"Authorization": f"Bearer {token}", "Accept-Language": "de"},
        )

    if response.is_error:
        logger.warning(
            "Google Health steps dailyRollUp failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        return {
            "available": False,
            "reason": f"Google Health hat die Schritt-Anfrage abgelehnt (HTTP {response.status_code}).",
            "_debug": response.text[:300],
        }

    payload = response.json()
    rollup_points = payload.get("rollupDataPoints") or []
    total_steps = int(((rollup_points[0].get("steps") or {}).get("countSum") or 0)) if rollup_points else 0

    return {
        "available": True,
        "source": "google_health",
        "date": target_date.isoformat(),
        "steps": total_steps,
    }


async def fetch_sleep(
    connection: GoogleHealthConnection,
    db: Session,
    target_date: "date | None" = None,
) -> dict:
    """Fetch sleep sessions for the night ending on *target_date* from Google Health.

    A sleep night is queried as 18:00 the previous day → 12:00 the target day.
    Returns a dict with keys: available, date, total_sleep_min, stages (list).
    """
    from datetime import date as _date, timedelta  # local import

    if target_date is None:
        target_date = _date.today()

    if not connection_has_scope(connection, GOOGLE_HEALTH_READ_SLEEP_SCOPE):
        return {
            "available": False,
            "reason": "Dein Google-Konto muss neu verbunden werden, um Schlafdaten lesen zu können.",
            "needs_reauth": True,
        }

    try:
        token = await _access_token(connection, db)
    except GoogleHealthAuthorizationError as exc:
        return {"available": False, "reason": str(exc)}

    prev_day = target_date - timedelta(days=1)
    # Filter by end_time: sleep sessions that ended after prev_day 18:00 and before target_date 14:00 UTC
    # (covers European nights with UTC+2 offset)
    start = f"{prev_day.isoformat()}T16:00:00Z"
    end   = f"{target_date.isoformat()}T14:00:00Z"
    filter_str = f'sleep.interval.end_time >= "{start}" AND sleep.interval.end_time < "{end}"'

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            GOOGLE_HEALTH_SLEEP_URL,
            params={"filter": filter_str, "pageSize": 25},
            headers={"Authorization": f"Bearer {token}", "Accept-Language": "de"},
        )

    if response.is_error:
        logger.warning(
            "Google Health sleep request failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        return {
            "available": False,
            "reason": f"Google Health hat die Schlaf-Anfrage abgelehnt (HTTP {response.status_code}).",
            "_debug": response.text[:300],
        }

    payload = response.json()
    data_points = payload.get("dataPoints") or []

    if not data_points:
        return {
            "available": True,
            "source": "google_health",
            "date": target_date.isoformat(),
            "total_sleep_min": 0,
            "stages": [],
        }

    # Pick the main sleep session (mainSleep=True preferred, otherwise longest)
    main_point = None
    for point in data_points:
        sleep = point.get("sleep") or {}
        if (sleep.get("metadata") or {}).get("mainSleep"):
            main_point = point
            break
    if main_point is None:
        main_point = max(
            data_points,
            key=lambda p: int(((p.get("sleep") or {}).get("summary") or {}).get("minutesInSleepPeriod") or 0),
        )

    sleep = main_point.get("sleep") or {}
    summary = sleep.get("summary") or {}
    stages_raw = sleep.get("stages") or []

    STAGE_MAP = {
        "AWAKE": "awake",
        "LIGHT": "light",
        "DEEP": "deep",
        "REM": "rem",
        "SLEEPING": "sleeping",
        "OUT_OF_BED": "out_of_bed",
        "UNSPECIFIED": "unspecified",
    }

    stages = []
    for s in stages_raw:
        stage_name = STAGE_MAP.get(s.get("type", ""), s.get("type", "").lower())
        start_str  = s.get("startTime", "")
        end_str    = s.get("endTime", "")
        try:
            from datetime import datetime as _dt
            duration_s = max(0, int(
                (_dt.fromisoformat(end_str.replace("Z", "+00:00")) -
                 _dt.fromisoformat(start_str.replace("Z", "+00:00"))).total_seconds()
            ))
        except (ValueError, TypeError):
            duration_s = 0
        stages.append({
            "stage": stage_name,
            "start": start_str,
            "end": end_str,
            "duration_min": round(duration_s / 60, 1),
        })

    # Use Google's pre-computed summary values directly
    stages_summary = summary.get("stagesSummary") or []
    stage_minutes = {
        STAGE_MAP.get(s.get("type", ""), s.get("type", "").lower()): int(s.get("minutes") or 0)
        for s in stages_summary
    }

    return {
        "available": True,
        "source": "google_health",
        "date": target_date.isoformat(),
        "total_sleep_min": int(summary.get("minutesAsleep") or 0),
        "total_in_bed_min": int(summary.get("minutesInSleepPeriod") or 0),
        "awake_min": int(summary.get("minutesAwake") or 0),
        "stage_minutes": stage_minutes,
        "stages": stages,
    }
