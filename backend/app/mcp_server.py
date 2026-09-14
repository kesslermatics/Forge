"""Authenticated Streamable HTTP MCP server mounted by the FastAPI backend."""
import logging
from typing import Annotated, Any

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field

from app.config import settings
from app.database import SessionLocal
from app.dependencies import resolve_api_key_user
from app.models import User
from app.security import api_key_id
from app.services.chat_agent import execute_coach_tool

logger = logging.getLogger(__name__)
COACH_SCOPE = "coach:read"


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class ForgeApiKeyVerifier(TokenVerifier):
    """Validate non-expiring Forge personal keys presented as MCP bearer tokens."""

    async def verify_token(self, token: str) -> AccessToken | None:
        db = SessionLocal()
        try:
            user = resolve_api_key_user(token, db)
            lookup_id = api_key_id(token)
            if lookup_id is None:
                return None
            return AccessToken(
                token=token,
                client_id=f"forge-api-key:{lookup_id}",
                scopes=[COACH_SCOPE],
                expires_at=None,
                resource=settings.mcp_server_url,
                subject=str(user.id),
                claims={"iss": settings.mcp_issuer_url},
            )
        except Exception:
            db.rollback()
            return None
        finally:
            db.close()


mcp = MCPServer(
    "Forge Coach",
    instructions="Read-only access to the authenticated user's Forge training, nutrition, activity, and coaching context.",
    token_verifier=ForgeApiKeyVerifier(),
    auth=AuthSettings(
        issuer_url=settings.mcp_issuer_url,
        resource_server_url=settings.mcp_server_url,
        required_scopes=[COACH_SCOPE],
        validate_token_resource=True,
    ),
)


async def _call(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    access_token = get_access_token()
    if access_token is None or not access_token.subject:
        raise ToolError("Authentication required")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == access_token.subject).first()
        if user is None:
            raise ToolError("Forge account not found")
        return await execute_coach_tool(name, arguments or {}, user, db)
    except ToolError:
        raise
    except Exception as exc:
        logger.exception("MCP Coach tool %s failed", name)
        raise ToolError("Forge could not load this tool's data") from exc
    finally:
        db.close()


@mcp.tool()
async def get_user_profile() -> dict[str, Any]:
    """Read the user's profile, integration status, and current authoritative Yazio goal."""
    return await _call("get_user_profile")


@mcp.tool()
async def get_training_plan() -> dict[str, Any]:
    """Read native Forge training plans, descriptions, and exercises."""
    return await _call("get_training_plan")


@mcp.tool()
async def get_latest_workout() -> dict[str, Any]:
    """Read the most recently completed workout with notes and completed sets."""
    return await _call("get_latest_workout")


@mcp.tool()
async def get_workouts(
    limit: Annotated[int, Field(ge=1, le=30)] = 20,
    days: Annotated[int, Field(ge=1, le=365)] = 365,
) -> dict[str, Any]:
    """Read recent completed Forge workouts within a bounded time window."""
    return await _call("get_workouts", {"limit": limit, "days": days})


@mcp.tool()
async def get_exercise_history(
    exercise_name: Annotated[str, Field(min_length=1, max_length=120)],
    limit: Annotated[int, Field(ge=1, le=30)] = 20,
) -> dict[str, Any]:
    """Read completed-set history for an exercise by its exact name."""
    return await _call("get_exercise_history", {"exercise_name": exercise_name, "limit": limit})


@mcp.tool()
async def get_nutrition_day(
    date: str | None = None,
    include_food_items: bool = False,
) -> dict[str, Any]:
    """Read Yazio nutrition totals and goals for YYYY-MM-DD; omit date for today."""
    arguments: dict[str, Any] = {"include_food_items": include_food_items}
    if date is not None:
        arguments["date"] = date
    return await _call("get_nutrition_day", arguments)


@mcp.tool()
async def get_nutrition_range(
    days: Annotated[int, Field(ge=1, le=14)] = 7,
) -> dict[str, Any]:
    """Read compact daily nutrition totals for the most recent days."""
    return await _call("get_nutrition_range", {"days": days})


@mcp.tool()
async def get_steps(date: str | None = None) -> dict[str, Any]:
    """Read steps, activity calories, and water for YYYY-MM-DD; omit date for today."""
    return await _call("get_steps", {"date": date} if date is not None else {})


@mcp.tool()
async def get_weight_history(
    days: Annotated[int, Field(ge=7, le=365)] = 90,
) -> dict[str, Any]:
    """Read locally collected weight history for the recent period."""
    return await _call("get_weight_history", {"days": days})


@mcp.tool()
async def get_coaching_memory(
    limit: Annotated[int, Field(ge=1, le=10)] = 5,
) -> dict[str, Any]:
    """Read recent saved briefings, workout reviews, and coaching tips."""
    return await _call("get_coaching_memory", {"limit": limit})


mcp_http_app = mcp.streamable_http_app(
    streamable_http_path="/",
    json_response=True,
    stateless_http=True,
    max_request_body_size=256 * 1024,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=_csv(settings.mcp_allowed_hosts),
        allowed_origins=_csv(settings.mcp_allowed_origins),
    ),
)
