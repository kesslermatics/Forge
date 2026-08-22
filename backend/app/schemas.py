"""
Pydantic schemas for request/response validation.
"""
from pydantic import BaseModel, Field
from typing import Optional, Any, Literal
from uuid import UUID
from datetime import date


# ============ User Schemas ============

class UserCreate(BaseModel):
    """Schema for user registration."""
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=100)


class UserLogin(BaseModel):
    """Schema for user login."""
    username: str
    password: str


class UserResponse(BaseModel):
    """Schema for user response (excludes sensitive data)."""
    id: UUID
    username: str
    has_yazio: bool = False
    current_goal: Optional[str] = None
    target_weight: Optional[float] = None
    first_name: Optional[str] = None
    height_cm: Optional[float] = None
    language: str = "de"
    training_plan: Optional[list[str]] = None
    
    class Config:
        from_attributes = True


class UserInDB(BaseModel):
    """Schema for user stored in database."""
    id: UUID
    username: str
    hashed_password: str
    hevy_api_key: Optional[str] = None
    yazio_email: Optional[str] = None
    yazio_password: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============ Yazio Schemas ============

class YazioCredentialsUpdate(BaseModel):
    """Schema for saving Yazio credentials."""
    yazio_email: str = Field(..., min_length=1, max_length=255)
    yazio_password: str = Field(..., min_length=1, max_length=255)


class YazioCredentialsResponse(BaseModel):
    """Schema for Yazio credentials update response."""
    message: str
    has_yazio: bool


# ============ Token Schemas ============

class Token(BaseModel):
    """Schema for JWT token response."""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Schema for token payload data."""
    username: Optional[str] = None
    user_id: Optional[str] = None


# ============ Generic Responses ============

class MessageResponse(BaseModel):
    """Generic message response."""
    message: str


# ============ Goal Schemas ============

class GoalUpdate(BaseModel):
    """Schema for updating user goal and target weight."""
    current_goal: str = Field(..., min_length=1, max_length=100,
                              description="e.g. Lean Bulk, Cut, Maintain, Recomp")
    target_weight: Optional[float] = Field(None, gt=0, le=500,
                                           description="Target weight in kg")


class GoalResponse(BaseModel):
    """Schema for goal update response."""
    message: str
    current_goal: Optional[str] = None
    target_weight: Optional[float] = None


# ============ Profile Schemas ============

class ProfileUpdate(BaseModel):
    """User-managed identity and body data, excluding credentials and daily weight."""
    first_name: Optional[str] = Field(None, max_length=100)
    height_cm: Optional[float] = Field(None, ge=80, le=280)


class ProfileResponse(BaseModel):
    message: str
    first_name: Optional[str] = None
    height_cm: Optional[float] = None


# ============ Language Schemas ============

class LanguageUpdate(BaseModel):
    """Schema for updating user language."""
    language: str = Field(..., pattern="^(de|en)$", description="Language code: 'de' or 'en'")


class LanguageResponse(BaseModel):
    """Schema for language update response."""
    message: str
    language: str


# ============ Training Plan Schemas ============

class TrainingPlanUpdate(BaseModel):
    """Schema for updating the user's training plan (list of workout names)."""
    workout_names: list[str] = Field(..., min_length=0, max_length=20,
                                      description="List of workout names that form the current plan")


class TrainingPlanResponse(BaseModel):
    """Schema for training plan update response."""
    message: str
    training_plan: list[str]


# ============ Briefing Schemas ============

class NutritionReview(BaseModel):
    """Per-macro nutrition breakdown from the AI."""
    calories: str
    protein: str
    carbs: str
    fat: str


class BriefingData(BaseModel):
    """The AI-generated briefing payload."""
    nutrition_review: NutritionReview
    workout_suggestion: str
    daily_mission: str


class BriefingResponse(BaseModel):
    """Schema returned to frontend for today's briefing."""
    id: UUID
    date: date
    briefing_data: Any     # raw JSON from the AI
    created_at: Any

    class Config:
        from_attributes = True


# ============ Native Forge Training Planning ============

ForgeEquipment = Literal["none", "barbell", "dumbbell", "kettlebell", "machine", "other"]


class ForgeMachineProfileInput(BaseModel):
    id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=500)


class ForgeMachineProfileResponse(ForgeMachineProfileInput):
    id: UUID

    class Config:
        from_attributes = True


class ForgeExerciseInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    icon: str = Field("Dumbbell", min_length=1, max_length=64)
    equipment: ForgeEquipment = "other"
    primary_muscle_group: str = Field(..., min_length=1, max_length=64)
    secondary_muscle_groups: list[str] = Field(default_factory=list, max_length=8)
    machine_profiles: list[ForgeMachineProfileInput] = Field(default_factory=list, max_length=20)


class ForgeExerciseResponse(BaseModel):
    id: UUID
    name: str
    icon: str
    equipment: ForgeEquipment
    primary_muscle_group: str
    secondary_muscle_groups: list[str]
    machine_profiles: list[ForgeMachineProfileResponse]

    class Config:
        from_attributes = True


class ForgeExerciseHistorySetResponse(BaseModel):
    position: int
    set_type: Literal["warmup", "working"]
    actual_weight_kg: Optional[float] = None
    actual_reps: Optional[int] = None
    completed: bool
    note: Optional[str] = None


class ForgeExerciseHistorySessionResponse(BaseModel):
    id: UUID
    name: str
    completed_at: Any
    started_at: Any
    machine_profile_id: Optional[UUID] = None
    machine_profile_name: Optional[str] = None
    sets: list[ForgeExerciseHistorySetResponse]


class ForgeExerciseHistoryResponse(BaseModel):
    exercise: ForgeExerciseResponse
    sessions: list[ForgeExerciseHistorySessionResponse]


class ForgePlanSetInput(BaseModel):
    set_type: Literal["warmup", "working"] = "working"
    previous_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    previous_reps: Optional[int] = Field(None, ge=0, le=200)
    current_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    current_reps: Optional[int] = Field(None, ge=0, le=200)
    coach_suggested_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    coach_suggested_reps: Optional[int] = Field(None, ge=0, le=200)
    note: Optional[str] = Field(None, max_length=300)


class ForgePlanSetResponse(ForgePlanSetInput):
    id: UUID
    position: int

    class Config:
        from_attributes = True


class ForgePlanExerciseInput(BaseModel):
    exercise_id: UUID
    machine_profile_id: Optional[UUID] = None
    notes: Optional[str] = Field(None, max_length=500)
    sets: list[ForgePlanSetInput] = Field(default_factory=list, max_length=12)


class ForgePlanExerciseResponse(BaseModel):
    id: UUID
    position: int
    notes: Optional[str] = None
    exercise: ForgeExerciseResponse
    machine_profile: Optional[ForgeMachineProfileResponse] = None
    sets: list[ForgePlanSetResponse]

    class Config:
        from_attributes = True


class ForgePlanInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    position: int = Field(0, ge=0, le=100)
    exercises: list[ForgePlanExerciseInput] = Field(default_factory=list, max_length=30)


class ForgePlanResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    position: int
    exercises: list[ForgePlanExerciseResponse]

    class Config:
        from_attributes = True


class ForgeExerciseDraftRequest(BaseModel):
    instructions: str = Field(..., min_length=3, max_length=2000)
    # Supplied by the web client from Lucide's installed dynamic icon catalogue.
    # This lets the model choose a real renderable icon without hardcoding a stale list.
    allowed_icons: list[str] = Field(default_factory=list, max_length=2500)


class ForgePlanDraftRequest(BaseModel):
    instructions: str = Field(..., min_length=3, max_length=2000)
    exercise_ids: list[UUID] = Field(..., min_length=1, max_length=30)
    base_plan_id: Optional[UUID] = None


class ForgeDraftResponse(BaseModel):
    draft: dict


# ============ Native Forge Programs and Sessions ============

ForgeProgramMode = Literal["rotation", "weekly"]


class ForgeProgramRoutineInput(BaseModel):
    plan_id: UUID
    weekdays: list[int] = Field(default_factory=list, max_length=7)


class ForgeProgramInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    mode: ForgeProgramMode = "rotation"
    is_active: bool = True
    routines: list[ForgeProgramRoutineInput] = Field(default_factory=list, max_length=30)


class ForgeProgramRoutineResponse(BaseModel):
    id: UUID
    position: int
    weekdays: list[int]
    plan: ForgePlanResponse


class ForgeProgramResponse(BaseModel):
    id: UUID
    name: str
    mode: ForgeProgramMode
    is_active: bool
    rotation_cursor: int
    routines: list[ForgeProgramRoutineResponse]


class ForgeTodayResponse(BaseModel):
    mode: Optional[ForgeProgramMode] = None
    program: Optional[ForgeProgramResponse] = None
    routine: Optional[ForgePlanResponse] = None
    options: list[ForgePlanResponse] = Field(default_factory=list)
    message: str


class ForgeSessionSetInput(BaseModel):
    set_type: Literal["warmup", "working"] = "working"
    target_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    target_reps: Optional[int] = Field(None, ge=0, le=200)
    actual_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    actual_reps: Optional[int] = Field(None, ge=0, le=200)
    coach_suggested_weight_kg: Optional[float] = Field(None, ge=0, le=1000)
    coach_suggested_reps: Optional[int] = Field(None, ge=0, le=200)
    completed: bool = False
    note: Optional[str] = Field(None, max_length=300)


class ForgeSessionSetResponse(ForgeSessionSetInput):
    id: UUID
    position: int


class ForgeSessionCoachGuidanceResponse(BaseModel):
    progression_status: Literal["INCREASE_WEIGHT", "KEEP_PROGRESSING", "STAGNATED", "REGRESSED", "FIRST_SESSION"]
    rep_range: str
    rationale: str


class ForgeSessionExerciseInput(BaseModel):
    exercise_id: Optional[UUID] = None
    name: Optional[str] = Field(None, max_length=255)
    machine_profile_id: Optional[UUID] = None
    notes: Optional[str] = Field(None, max_length=500)
    sets: list[ForgeSessionSetInput] = Field(default_factory=list, max_length=20)


class ForgeSessionExerciseResponse(BaseModel):
    id: UUID
    source_exercise_id: Optional[UUID] = None
    name: str
    icon: str
    equipment: str
    primary_muscle_group: str
    secondary_muscle_groups: list[str]
    machine_profile_id: Optional[UUID] = None
    machine_profile_name: Optional[str] = None
    notes: Optional[str] = None
    coach_guidance: Optional[ForgeSessionCoachGuidanceResponse] = None
    position: int
    sets: list[ForgeSessionSetResponse]


class ForgeSessionMessageResponse(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    proposed_action: Optional[dict] = None
    action_status: Optional[str] = None
    created_at: Any


class ForgeSessionResponse(BaseModel):
    id: UUID
    program_id: Optional[UUID] = None
    source_plan_id: Optional[UUID] = None
    name: str
    status: Literal["active", "completed"]
    started_at: Any
    completed_at: Optional[Any] = None
    exercises: list[ForgeSessionExerciseResponse]
    messages: list[ForgeSessionMessageResponse] = Field(default_factory=list)


class ForgeSessionSummaryResponse(BaseModel):
    """Compact, immutable completed-session data for the Forge workout history."""
    id: UUID
    name: str
    status: Literal["completed"]
    source_plan_id: Optional[UUID] = None
    started_at: Any
    completed_at: Any
    duration_seconds: int
    completed_sets: int
    total_sets: int


class ForgeStartSessionRequest(BaseModel):
    plan_id: UUID
    program_id: Optional[UUID] = None


class ForgeSessionChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


class ForgeApplySessionActionRequest(BaseModel):
    message_id: UUID


class ForgeSessionExerciseUpdate(BaseModel):
    machine_profile_id: Optional[UUID] = None
    notes: Optional[str] = Field(None, max_length=500)


# ============ Private Forge Progress Photos ============

ForgeProgressPhotoView = Literal["front", "side", "back", "other"]


class ForgeProgressPhotoUpdate(BaseModel):
    taken_on: Optional[date] = None
    view: Optional[ForgeProgressPhotoView] = None
    note: Optional[str] = Field(None, max_length=500)


class ForgeProgressPhotoContextResponse(BaseModel):
    weight_kg: Optional[float] = None
    current_goal: Optional[str] = None
    target_weight_kg: Optional[float] = None
    workout_names: list[str] = Field(default_factory=list)


class ForgeProgressPhotoResponse(BaseModel):
    id: UUID
    taken_on: date
    view: ForgeProgressPhotoView
    note: Optional[str] = None
    byte_size: int
    width: int
    height: int
    created_at: Any
    updated_at: Optional[Any] = None
    context: ForgeProgressPhotoContextResponse


class ForgeProgressPhotoListResponse(BaseModel):
    items: list[ForgeProgressPhotoResponse]
    total: int


# ============ Monthly Forge Challenges ============

class MonthlyChallengeResponse(BaseModel):
    id: UUID
    slot: int
    category: Literal["consistency", "strength", "weight", "nutrition", "quality"]
    metric: str
    title: str
    description: str
    icon: str
    unit: str
    baseline_value: float
    current_value: float
    target_value: float
    progress_percent: float
    status: Literal["active", "completed"]
    completed_at: Optional[Any] = None
    completion_stats: Optional[dict] = None


class MonthlyChallengeCycleResponse(BaseModel):
    id: UUID
    month_start: date
    total_challenges: int
    completed_challenges: int
    completion_percent: float
    challenges: list[MonthlyChallengeResponse]
    latest_checkin: Optional[dict] = None
    latest_checkin_date: Optional[date] = None


class MonthlyChallengeCheckinResponse(BaseModel):
    date: date
    checkin: dict
