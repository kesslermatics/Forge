"""Authentication dependencies for JWT sessions and personal API keys."""
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, User
from app.security import api_key_id, decode_access_token, parse_and_verify_api_key

bearer_security = HTTPBearer(auto_error=False)
api_key_security = APIKeyHeader(name="X-API-Key", auto_error=False)


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _user_from_jwt(credentials: HTTPAuthorizationCredentials | None, db: Session) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _credentials_exception()
    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub") if payload is not None else None
    if not user_id:
        raise _credentials_exception()
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise _credentials_exception()
    return user


def resolve_api_key_user(value: str | None, db: Session) -> User:
    lookup_id = api_key_id(value or "")
    if lookup_id is None:
        raise _credentials_exception()
    stored_key = db.query(ApiKey).filter(
        ApiKey.key_id == lookup_id,
        ApiKey.revoked_at.is_(None),
    ).first()
    if stored_key is None or not parse_and_verify_api_key(value or "", stored_key.secret_hash):
        raise _credentials_exception()
    user = db.query(User).filter(User.id == stored_key.user_id).first()
    if user is None:
        raise _credentials_exception()

    now = datetime.now(timezone.utc)
    if stored_key.last_used_at is None or stored_key.last_used_at < now - timedelta(hours=1):
        stored_key.last_used_at = now
        db.commit()
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_security),
    db: Session = Depends(get_db),
) -> User:
    """Resolve a browser/user session from a JWT only."""
    return _user_from_jwt(credentials, db)


async def get_current_user_or_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_security),
    api_key: str | None = Depends(api_key_security),
    db: Session = Depends(get_db),
) -> User:
    """Resolve coach read APIs from exactly one supported authentication method."""
    if credentials is not None and api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use either Authorization Bearer or X-API-Key, not both",
        )
    if api_key:
        return resolve_api_key_user(api_key, db)
    return _user_from_jwt(credentials, db)
