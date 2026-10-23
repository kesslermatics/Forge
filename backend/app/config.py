"""
Configuration settings loaded from environment variables.
NEVER hardcode secrets - always use environment variables!
"""
import os
from pydantic import Field
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
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))

    # Encryption key for API credentials (Fernet key, 32 bytes base64)
    encryption_key: str = os.getenv("ENCRYPTION_KEY", "")

    # OpenRouter is the only LLM gateway. The field names stay "openai_*" because the
    # OpenAI-compatible SDK is used, but they bind exclusively to OPENROUTER_* variables.
    openai_api_key: str = Field(default=os.getenv("OPENROUTER_API_KEY", ""), validation_alias="OPENROUTER_API_KEY")
    openai_model: str = Field(default=os.getenv("OPENROUTER_MODEL", "google/gemini-3.8-flash"), validation_alias="OPENROUTER_MODEL")
    openai_base_url: str = Field(default=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), validation_alias="OPENROUTER_BASE_URL")
    openai_reasoning_effort: str = Field(default=os.getenv("OPENROUTER_REASONING_EFFORT", "medium"), validation_alias="OPENROUTER_REASONING_EFFORT")

    # Google Health API OAuth (optional until the integration is enabled in Google Cloud)
    google_health_client_id: str = os.getenv("GOOGLE_HEALTH_CLIENT_ID", "")
    google_health_client_secret: str = os.getenv("GOOGLE_HEALTH_CLIENT_SECRET", "")
    google_health_redirect_uri: str = os.getenv("GOOGLE_HEALTH_REDIRECT_URI", "")
    frontend_url: str = os.getenv("FRONTEND_URL", "https://forge.kesslermatics.com")
    # Comma-separated list of additional allowed CORS origins, e.g.
    # "https://forge.kesslermatics.com,https://other.example.com"
    extra_cors_origins: str = os.getenv("EXTRA_CORS_ORIGINS", "")

    # Public Streamable HTTP MCP endpoint and transport allowlists.
    mcp_server_url: str = os.getenv(
        "MCP_SERVER_URL",
        "https://forge.kesslermatics.com/mcp",
    )
    mcp_issuer_url: str = os.getenv(
        "MCP_ISSUER_URL",
        "https://forge.kesslermatics.com",
    )
    mcp_allowed_hosts: str = os.getenv(
        "MCP_ALLOWED_HOSTS",
        "forge.kesslermatics.com,localhost:*,127.0.0.1:*",
    )
    mcp_allowed_origins: str = os.getenv(
        "MCP_ALLOWED_ORIGINS",
        "https://forge.kesslermatics.com,http://localhost:*,http://127.0.0.1:*",
    )

    # Private object storage (S3-compatible, e.g. Cloudflare R2) for progress photos and plan images.
    # Empty by default so uploads never silently fall back to ephemeral container storage.
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")
    s3_bucket: str = os.getenv("S3_BUCKET", "")
    s3_access_key_id: str = os.getenv("S3_ACCESS_KEY_ID", "")
    s3_secret_access_key: str = os.getenv("S3_SECRET_ACCESS_KEY", "")
    s3_region: str = os.getenv("S3_REGION", "auto")
    # Objects live under this prefix so the bucket can also hold other data (e.g. backups).
    s3_key_prefix: str = os.getenv("S3_KEY_PREFIX", "photos/")

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
    if not settings.openai_api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable is not set!")

    return settings


settings = get_settings()
