"""
Configuration settings loaded from environment variables.
NEVER hardcode secrets - always use environment variables!
"""
import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    database_url: str = os.getenv("DATABASE_URL", "")
    
    # JWT Settings
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))
    
    # Encryption key for API credentials (Fernet key, 32 bytes base64)
    encryption_key: str = os.getenv("ENCRYPTION_KEY", "")

    # Google Gemini
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")

    # Google Health API OAuth (optional until the integration is enabled in Google Cloud)
    google_health_client_id: str = os.getenv("GOOGLE_HEALTH_CLIENT_ID", "")
    google_health_client_secret: str = os.getenv("GOOGLE_HEALTH_CLIENT_SECRET", "")
    google_health_redirect_uri: str = os.getenv("GOOGLE_HEALTH_REDIRECT_URI", "")
    frontend_url: str = os.getenv("FRONTEND_URL", "https://coach.kesslermatics.com")

    # Private Forge progress-photo storage. In production this must be a mounted persistent volume.
    # Keep empty by default so uploads never silently use ephemeral container storage.
    photo_storage_dir: str = os.getenv("PHOTO_STORAGE_DIR", "")
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


def get_settings() -> Settings:
    """Get application settings singleton."""
    settings = Settings()
    
    # Validate critical settings
    if not settings.database_url:
        raise ValueError("DATABASE_URL environment variable is not set!")
    if not settings.jwt_secret_key:
        raise ValueError("JWT_SECRET_KEY environment variable is not set!")
    if not settings.encryption_key:
        raise ValueError("ENCRYPTION_KEY environment variable is not set!")
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set!")
    
    return settings


settings = get_settings()
