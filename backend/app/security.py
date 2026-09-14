"""
Security utilities for password hashing and JWT token management.
"""
from datetime import datetime, timedelta
from typing import Optional
import hashlib
import hmac
import re
import secrets
import bcrypt
from jose import JWTError, jwt
from app.config import settings


API_KEY_PREFIX = "forge_live_"
_API_KEY_PATTERN = re.compile(r"^forge_live_([0-9a-f]{16})\.([A-Za-z0-9_-]{32,})$")


def hash_api_key_secret(secret: str) -> str:
    """Hash a high-entropy API-key secret for non-reversible storage."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str, str]:
    """Return the one-time plaintext key, lookup id, and persisted secret hash."""
    key_id = secrets.token_hex(8)
    secret = secrets.token_urlsafe(32)
    return f"{API_KEY_PREFIX}{key_id}.{secret}", key_id, hash_api_key_secret(secret)


def parse_and_verify_api_key(value: str, expected_hash: str) -> bool:
    """Verify a formatted personal API key using a constant-time hash comparison."""
    match = _API_KEY_PATTERN.fullmatch(value.strip())
    if match is None:
        return False
    return hmac.compare_digest(hash_api_key_secret(match.group(2)), expected_hash)


def api_key_id(value: str) -> Optional[str]:
    """Extract the public lookup id without accepting malformed key formats."""
    match = _API_KEY_PATTERN.fullmatch(value.strip())
    return match.group(1) if match is not None else None


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt directly.

    Args:
        password: Plain text password

    Returns:
        Hashed password string
    """
    pwd_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash.

    Args:
        plain_password: Plain text password to verify
        hashed_password: Hashed password to compare against

    Returns:
        True if password matches, False otherwise
    """
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Data to encode in the token
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)

    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(
        to_encode,
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm
    )

    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and verify a JWT access token.

    Args:
        token: JWT token string

    Returns:
        Decoded token payload or None if invalid
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm]
        )
        return payload
    except JWTError:
        return None
