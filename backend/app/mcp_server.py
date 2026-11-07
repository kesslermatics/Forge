"""Authenticated Streamable HTTP MCP server mounted by the FastAPI backend."""
import logging
from typing import Annotated, Any, Literal
from uuid import UUID

from collections.abc import Callable

from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, Field

from app.config import settings
from app.database import SessionLocal
from app.dependencies import resolve_api_key_user
from app.models import User
from app.security import api_key_id
from app.services import forge_plan_tools
from app.services.chat_agent import execute_coach_tool
from app.services.forge_plan_tools import ForgePlanToolError, PlanExerciseSpec, ProgramRoutineSpec
from starlette.concurrency import run_in_threadpool

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
    instructions=(
        "Access to the authenticated user's Forge training, nutrition, activity, and coaching context. "
        "Read tools accept date ranges; long ranges are aggregated or paged, so prefer summaries first and drill down. "
        "Write tools can change training plans, the training split (program) and the exercise library. "
        "Workout tracking itself happens in the Forge app and cannot be changed here. "
        "Call list_plans / list_exercises / get_training_program first to obtain IDs, and only modify what the user asked for."
    ),
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
    """Read the user's profile, daily calorie/macro targets (nutrition_targets), integration status, and the current Yazio goal."""
    return await _call("get_user_profile")


@mcp.tool()
async def get_training_plan() -> dict[str, Any]:
    """Read native Forge training plans, descriptions, and exercises."""
    return await _call("get_training_plan")


@mcp.tool()
async def get_latest_workout() -> dict[str, Any]:
    """Read the most recently completed workout with notes, in-workout exercise notes (session_note) and completed sets."""
    return await _call("get_latest_workout")


async def _call_sync(function: Callable[..., dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
    """Run a synchronous plan/program/exercise function for the token owner in a worker thread."""
    access_token = get_access_token()
    if access_token is None or not access_token.subject:
        raise ToolError("Authentication required")
    subject = access_token.subject

    def run() -> dict[str, Any]:
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == subject).first()
            if user is None:
                raise ToolError("Forge account not found")
            return function(db, user, **kwargs)
        finally:
            db.close()

    try:
        return await run_in_threadpool(run)
    except ToolError:
        raise
    except ForgePlanToolError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        logger.exception("MCP tool %s failed", getattr(function, "__name__", "?"))
        raise ToolError("Forge could not complete this request") from exc


def _range_args(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


@mcp.tool()
async def get_workouts(
    start_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive")] = None,
    end_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive; default today")] = None,
    days: Annotated[int | None, Field(ge=1, le=730, description="Last N days when start_date is omitted (default 365)")] = None,
    limit: Annotated[int, Field(ge=1, le=60)] = 20,
    offset: Annotated[int, Field(ge=0)] = 0,
    detail: Annotated[Literal["auto", "summary", "full"], Field(description="summary = one compact line per exercise (best for long ranges); full = every set with notes (max 15 workouts per call); auto = full for up to 10 workouts")] = "auto",
) -> dict[str, Any]:
    """Read completed Forge workouts for a date range (up to 730 days), newest first.

    The response reports total_matching, has_more and next_offset so you can page through
    long ranges. Prefer detail='summary' for ranges longer than a few weeks.
    """
    return await _call("get_workouts", _range_args(
        start_date=start_date, end_date=end_date, days=days, limit=limit, offset=offset, detail=detail,
    ))


@mcp.tool()
async def get_exercise_history(
    exercise_name: Annotated[str, Field(min_length=1, max_length=120)],
    start_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive")] = None,
    end_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive; default today")] = None,
    days: Annotated[int | None, Field(ge=1, le=730, description="Last N days when start_date is omitted (default 365)")] = None,
    limit: Annotated[int, Field(ge=1, le=60, description="Most recent sessions to list")] = 20,
) -> dict[str, Any]:
    """Read completed-set history for an exercise by its exact name within a date range.

    Includes in-workout notes, the best estimated 1RM per session, and a summary of the whole range.
    """
    return await _call("get_exercise_history", _range_args(
        exercise_name=exercise_name, start_date=start_date, end_date=end_date, days=days, limit=limit,
    ))


@mcp.tool()
async def get_nutrition_day(
    date: str | None = None,
    include_food_items: bool = False,
) -> dict[str, Any]:
    """Read what was tracked in Forge on YYYY-MM-DD (omit for today): calorie/macro totals, daily targets,
    the split by the user's own meals (e.g. Frühstück, Pre-Workout) and, with include_food_items, every food with amount and time."""
    arguments: dict[str, Any] = {"include_food_items": include_food_items}
    if date is not None:
        arguments["date"] = date
    return await _call("get_nutrition_day", arguments)


@mcp.tool()
async def get_nutrition_range(
    start_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive")] = None,
    end_date: Annotated[str | None, Field(description="YYYY-MM-DD, inclusive; default today")] = None,
    days: Annotated[int | None, Field(ge=1, le=180, description="Last N days when start_date is omitted (default 7)")] = None,
    granularity: Annotated[Literal["auto", "day", "week", "month"], Field(description="day = one row per day (max 31 days); week/month = averaged periods; auto picks by range length")] = "auto",
) -> dict[str, Any]:
    """Read nutrition for a date range (up to 180 days).

    Always returns a summary with averages and target attainment over logged days, plus either
    daily rows or weekly/monthly periods. Data comes from Forge's own food tracking.
    """
    return await _call("get_nutrition_range", _range_args(
        start_date=start_date, end_date=end_date, days=days, granularity=granularity,
    ))


@mcp.tool()
async def get_steps(date: str | None = None) -> dict[str, Any]:
    """Read step count for YYYY-MM-DD; omit date for today.

    Uses Google Health when the account is connected with the activity read scope (preferred).
    Falls back to Yazio if Google Health is unavailable.
    Google Health returns: available, source, date, steps.
    Yazio fallback also returns: activity_kcal, water_ml.
    """
    return await _call("get_steps", {"date": date} if date is not None else {})


@mcp.tool()
async def get_sleep(date: str | None = None) -> dict[str, Any]:
    """Read sleep duration and stage breakdown (light, deep, REM, awake) for the night ending on YYYY-MM-DD.

    Omit date for last night. Requires Google Health connection with sleep read scope.
    Returns total_sleep_min and a list of stages with start/end times and duration_min.
    """
    return await _call("get_sleep", {"date": date} if date is not None else {})


@mcp.tool()
async def get_weight_history(
    days: Annotated[int, Field(ge=7, le=365)] = 90,
) -> dict[str, Any]:
    """Read locally collected weight history for the recent period."""
    return await _call("get_weight_history", {"days": days})


# ── Analytics ────────────────────────────────────────────────────────────────────

class GoalScenario(BaseModel):
    name: str | None = Field(None, max_length=60)
    calorie_change_per_day: float = Field(0, ge=-2000, le=2000, description="Negative = eat less, positive = eat more")
    extra_steps_per_day: float = Field(0, ge=0, le=40000)


@mcp.tool()
async def get_volume_and_frequency_analysis(
    weeks: Annotated[int, Field(ge=1, le=26, description="Complete weeks to analyse (default 8)")] = 8,
    end_date: Annotated[str | None, Field(description="YYYY-MM-DD; default today")] = None,
) -> dict[str, Any]:
    """Weekly effective hard sets and frequency per muscle group, compared with MEV/MAV/MRV landmarks.

    Secondary muscles count 0.5 set. Flags neglected muscles and overreaching risk.
    """
    return await _call("get_volume_and_frequency_analysis", _range_args(weeks=weeks, end_date=end_date))


@mcp.tool()
async def get_strength_progression_analytics(
    exercise_name: Annotated[str | None, Field(max_length=120, description="Exact name for one lift with a timeline; omit for a summary of the most-trained lifts")] = None,
    start_date: str | None = None,
    end_date: str | None = None,
    days: Annotated[int | None, Field(ge=1, le=730, description="Default 90")] = None,
    top_n: Annotated[int, Field(ge=1, le=15)] = 8,
    plateau_weeks: Annotated[int, Field(ge=2, le=12, description="Window used to detect plateaus")] = 4,
) -> dict[str, Any]:
    """Estimated 1RM (Epley/Brzycki), tonnage and plateau detection, e.g. 'stalled for 5 weeks at 95-97.5 kg'."""
    return await _call("get_strength_progression_analytics", _range_args(
        exercise_name=exercise_name, start_date=start_date, end_date=end_date, days=days, top_n=top_n, plateau_weeks=plateau_weeks,
    ))


@mcp.tool()
async def get_metabolic_trend_analysis(
    windows: Annotated[list[Annotated[int, Field(ge=7, le=120)]] | None, Field(max_length=4, description="Window lengths in days; default [30, 60, 90]")] = None,
) -> dict[str, Any]:
    """Estimate real TDEE from logged intake (Forge food tracking) and the weight trend, with confidence and a metabolic-adaptation check."""
    return await _call("get_metabolic_trend_analysis", _range_args(windows=windows))


@mcp.tool()
async def get_macro_adherence_score(
    start_date: str | None = None,
    end_date: str | None = None,
    days: Annotated[int | None, Field(ge=1, le=120, description="Default 30")] = None,
    tolerance_pct: Annotated[int, Field(ge=1, le=30)] = 5,
) -> dict[str, Any]:
    """Share of days within calorie/protein goals, Mon-Thu vs Fri-Sun deviation, per-weekday averages and macro split."""
    return await _call("get_macro_adherence_score", _range_args(
        start_date=start_date, end_date=end_date, days=days, tolerance_pct=tolerance_pct,
    ))


@mcp.tool()
async def get_sleep_and_performance_correlation(
    start_date: str | None = None,
    end_date: str | None = None,
    days: Annotated[int | None, Field(ge=1, le=60, description="Default 45")] = None,
    sleep_target_hours: Annotated[int, Field(ge=5, le=10)] = 8,
) -> dict[str, Any]:
    """Correlate the previous night's sleep with trend-adjusted workout performance; includes 7-night sleep debt."""
    return await _call("get_sleep_and_performance_correlation", _range_args(
        start_date=start_date, end_date=end_date, days=days, sleep_target_hours=sleep_target_hours,
    ))


@mcp.tool()
async def get_performance_correlations(
    start_date: str | None = None,
    end_date: str | None = None,
    days: Annotated[int | None, Field(ge=1, le=120, description="Default 90")] = None,
) -> dict[str, Any]:
    """Personal performance patterns: morning vs evening training and previous-day step count."""
    return await _call("get_performance_correlations", _range_args(start_date=start_date, end_date=end_date, days=days))


@mcp.tool()
async def project_goal_timeline(
    target_weight_kg: Annotated[float, Field(ge=30, le=300)],
    scenarios: Annotated[list[GoalScenario] | None, Field(max_length=6, description="What-if cases; defaults to -200 kcal/day and +3000 steps/day when losing")] = None,
) -> dict[str, Any]:
    """Project when a target weight is reached from the current trend (earliest-latest corridor) and simulate scenarios."""
    return await _call("project_goal_timeline", _range_args(
        target_weight_kg=target_weight_kg,
        scenarios=[item.model_dump(exclude_none=True) for item in scenarios] if scenarios else None,
    ))


# ── Training plans, split and exercise library ──────────────────────────────────

@mcp.tool()
async def list_plans() -> dict[str, Any]:
    """List all training plans (routines) with IDs, ordered exercises and their set structure.

    Each exercise shows warmup_sets, working_sets and the individual sets with target reps/weight,
    the last performed values and the coach's current suggestion.
    """
    return await _call_sync(forge_plan_tools.list_plans)


@mcp.tool()
async def create_plan(
    name: Annotated[str, Field(min_length=1, max_length=255)],
    exercises: Annotated[list[PlanExerciseSpec], Field(max_length=30, description="Ordered exercises. Per exercise give warmup_sets and working_sets (e.g. 1 and 2), or explicit sets.")],
    description: Annotated[str | None, Field(max_length=500)] = None,
    plan_type: Literal["workout", "course"] = "workout",
    default_duration_minutes: Annotated[int | None, Field(ge=1, le=720, description="Courses only")] = None,
    position: Annotated[int | None, Field(ge=0, le=100, description="Display order; default: appended")] = None,
) -> dict[str, Any]:
    """Create a training plan. Exercises must already exist (see list_exercises / create_exercise).

    A plan without warmup_sets/working_sets/sets for an exercise gets 3 working sets by default.
    Courses (plan_type='course') hold no exercises and need default_duration_minutes.
    """
    return await _call_sync(
        forge_plan_tools.create_plan,
        name=name, description=description, plan_type=plan_type,
        default_duration_minutes=default_duration_minutes, position=position, exercises=exercises,
    )


@mcp.tool()
async def update_plan(
    plan_id: UUID,
    name: Annotated[str | None, Field(min_length=1, max_length=255)] = None,
    description: Annotated[str | None, Field(max_length=500, description="Empty string clears it")] = None,
    default_duration_minutes: Annotated[int | None, Field(ge=1, le=720)] = None,
    position: Annotated[int | None, Field(ge=0, le=100)] = None,
    exercises: Annotated[list[PlanExerciseSpec] | None, Field(max_length=30, description="The COMPLETE desired exercise list in the desired order. Omit to leave exercises untouched. Exercises already in the plan keep their sets, notes and machine profile unless you override them; omitted exercises are removed.")] = None,
) -> dict[str, Any]:
    """Edit a plan: rename it, reorder/add/remove exercises, or change warm-up and working sets.

    Only the fields you pass change. To change one exercise's sets, pass the full exercise list
    and set warmup_sets/working_sets (or sets) on that entry.
    """
    return await _call_sync(
        forge_plan_tools.update_plan,
        plan_id=plan_id, name=name, description=description,
        default_duration_minutes=default_duration_minutes, position=position, exercises=exercises,
    )


@mcp.tool()
async def delete_plan(
    plan_id: UUID,
    confirm: Annotated[bool, Field(description="Must be true. Ask the user before deleting.")] = False,
) -> dict[str, Any]:
    """Permanently delete a plan. It is also removed from the training split; workout history is kept."""
    return await _call_sync(forge_plan_tools.delete_plan, plan_id=plan_id, confirm=confirm)


@mcp.tool()
async def get_training_program() -> dict[str, Any]:
    """Read the training split (rhythm): mode, ordered routine slots, weekdays and the next routine."""
    return await _call_sync(forge_plan_tools.get_training_program)


@mcp.tool()
async def update_training_program(
    program_id: Annotated[UUID | None, Field(description="Default: the active program")] = None,
    name: Annotated[str | None, Field(min_length=1, max_length=255)] = None,
    mode: Annotated[Literal["rotation", "weekly"] | None, Field(description="rotation = routines run in slot order and repeat; weekly = routines are bound to weekdays")] = None,
    is_active: bool | None = None,
    routines: Annotated[list[ProgramRoutineSpec] | None, Field(max_length=30, description="The COMPLETE ordered slot list. In rotation mode a plan may repeat (A-B-A). In weekly mode every plan appears once with its weekdays.")] = None,
) -> dict[str, Any]:
    """Change the split: switch between rotation and weekly, reorder slots, or assign weekdays.

    Only the fields you pass change. This does not move the rotation pointer; the result shows the next routine.
    """
    return await _call_sync(
        forge_plan_tools.update_training_program,
        program_id=program_id, name=name, mode=mode, is_active=is_active, routines=routines,
    )


@mcp.tool()
async def list_exercises() -> dict[str, Any]:
    """List all exercises with IDs, equipment, muscle groups and machine profiles, plus the allowed option values."""
    return await _call_sync(forge_plan_tools.list_exercises)


@mcp.tool()
async def create_exercise(
    name: Annotated[str, Field(min_length=1, max_length=255)],
    primary_muscle_group: Annotated[str, Field(description="One of the muscle_groups from list_exercises options (e.g. Chest, Lats, Quadriceps)")],
    equipment: Literal["none", "barbell", "dumbbell", "kettlebell", "cable", "machine", "other"] = "other",
    icon: Annotated[str, Field(description="One of the icons from list_exercises options")] = "Dumbbell",
    secondary_muscle_groups: Annotated[list[str], Field(max_length=8)] = [],
    machine_profile_ids: Annotated[list[UUID] | None, Field(max_length=20, description="Machine/cable exercises only")] = None,
) -> dict[str, Any]:
    """Create a new exercise in the library."""
    return await _call_sync(
        forge_plan_tools.create_exercise,
        name=name, primary_muscle_group=primary_muscle_group, equipment=equipment, icon=icon,
        secondary_muscle_groups=list(secondary_muscle_groups), machine_profile_ids=machine_profile_ids,
    )


@mcp.tool()
async def update_exercise(
    exercise_id: UUID,
    name: Annotated[str | None, Field(min_length=1, max_length=255)] = None,
    primary_muscle_group: str | None = None,
    equipment: Literal["none", "barbell", "dumbbell", "kettlebell", "cable", "machine", "other"] | None = None,
    icon: str | None = None,
    secondary_muscle_groups: Annotated[list[str] | None, Field(max_length=8, description="Replaces the whole list")] = None,
    machine_profile_ids: Annotated[list[UUID] | None, Field(max_length=20, description="Replaces the linked profiles")] = None,
) -> dict[str, Any]:
    """Edit an exercise. Only the fields you pass change. Past workouts keep their original snapshot."""
    return await _call_sync(
        forge_plan_tools.update_exercise,
        exercise_id=exercise_id, name=name, primary_muscle_group=primary_muscle_group, equipment=equipment,
        icon=icon, secondary_muscle_groups=secondary_muscle_groups, machine_profile_ids=machine_profile_ids,
    )


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
