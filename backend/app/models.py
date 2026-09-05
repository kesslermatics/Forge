"""
SQLAlchemy database models.
"""
import uuid
from sqlalchemy import Column, String, Float, Boolean, Date, DateTime, ForeignKey, Integer, JSON, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class User(Base):
    """User model for authentication and API key storage."""
    
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    hevy_api_key = Column(String(512), nullable=True)       # Encrypted with Fernet
    yazio_email = Column(String(512), nullable=True)         # Encrypted with Fernet
    yazio_password = Column(String(512), nullable=True)      # Encrypted with Fernet
    first_name = Column(String(100), nullable=True)          # From Yazio profile
    height_cm = Column(Float, nullable=True)                 # User-managed profile data
    language = Column(String(5), nullable=False, server_default="de")  # "de" or "en"
    training_plan = Column(JSON, nullable=True)                          # List of workout names in current plan
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    briefings = relationship("MorningBriefing", back_populates="user", cascade="all, delete-orphan")
    workout_reviews = relationship("WorkoutReview", back_populates="user", cascade="all, delete-orphan")
    weight_entries = relationship("WeightEntry", back_populates="user", cascade="all, delete-orphan")
    forge_exercises = relationship("ForgeExercise", back_populates="user", cascade="all, delete-orphan")
    forge_plans = relationship("ForgeTrainingPlan", back_populates="user", cascade="all, delete-orphan")
    forge_programs = relationship("ForgeTrainingProgram", back_populates="user", cascade="all, delete-orphan")
    forge_sessions = relationship("ForgeWorkoutSession", back_populates="user", cascade="all, delete-orphan")
    forge_progress_photos = relationship("ForgeProgressPhoto", back_populates="user", cascade="all, delete-orphan")
    monthly_challenge_cycles = relationship("MonthlyChallengeCycle", back_populates="user", cascade="all, delete-orphan")
    monthly_challenge_checkins = relationship("MonthlyChallengeCheckin", back_populates="user", cascade="all, delete-orphan")
    chat_conversations = relationship("ChatConversation", back_populates="user", cascade="all, delete-orphan")
    google_health_connection = relationship("GoogleHealthConnection", back_populates="user", cascade="all, delete-orphan", uselist=False)
    google_health_exports = relationship("GoogleHealthWorkoutExport", back_populates="user", cascade="all, delete-orphan")
    google_health_oauth_states = relationship("GoogleHealthOAuthState", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, username={self.username})>"


class ChatConversation(Base):
    """A user-owned global Coach conversation."""

    __tablename__ = "chat_conversations"
    __table_args__ = (
        Index("ix_chat_conversations_user_updated", "user_id", "updated_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(160), nullable=False, server_default="Neuer Chat")
    summary = Column(String(12000), nullable=True)
    summary_until_sequence = Column(Integer, nullable=True)
    next_sequence = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="chat_conversations")
    messages = relationship(
        "ChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ChatMessage.sequence",
    )


class ChatMessage(Base):
    """A persisted user or assistant message in a global Coach conversation."""

    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "sequence", name="uq_chat_message_sequence"),
        Index("ix_chat_messages_conversation_sequence", "conversation_id", "sequence"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False)
    role = Column(String(16), nullable=False)
    content = Column(String(16000), nullable=False)
    status = Column(String(16), nullable=False, server_default="completed")
    agent_details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("ChatConversation", back_populates="messages")


class MonthlyChallengeCycle(Base):
    """Frozen monthly challenge selection and durable completion summary for one account."""

    __tablename__ = "monthly_challenge_cycles"
    __table_args__ = (UniqueConstraint("user_id", "month_start", name="uq_monthly_challenge_cycle_user_month"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    month_start = Column(Date, nullable=False, index=True)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    total_challenges = Column(Integer, nullable=False, server_default="0")
    completed_challenges = Column(Integer, nullable=False, server_default="0")
    completion_percent = Column(Float, nullable=False, server_default="0")
    finalized_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="monthly_challenge_cycles")
    challenges = relationship("MonthlyChallenge", back_populates="cycle", cascade="all, delete-orphan", order_by="MonthlyChallenge.slot")
    checkins = relationship("MonthlyChallengeCheckin", back_populates="cycle", cascade="all, delete-orphan", order_by="MonthlyChallengeCheckin.date")


class MonthlyChallenge(Base):
    """One measurable card in a monthly challenge cycle; target selection remains immutable."""

    __tablename__ = "monthly_challenges"
    __table_args__ = (
        UniqueConstraint("cycle_id", "slot", name="uq_monthly_challenge_slot"),
        UniqueConstraint("cycle_id", "category", name="uq_monthly_challenge_category"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cycle_id = Column(UUID(as_uuid=True), ForeignKey("monthly_challenge_cycles.id", ondelete="CASCADE"), nullable=False, index=True)
    slot = Column(Integer, nullable=False)
    category = Column(String(32), nullable=False)
    metric = Column(String(80), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(String(500), nullable=False)
    icon = Column(String(64), nullable=False)
    unit = Column(String(32), nullable=False)
    baseline_value = Column(Float, nullable=False, server_default="0")
    target_value = Column(Float, nullable=False)
    rules = Column(JSON, nullable=False, default=dict)
    status = Column(String(16), nullable=False, server_default="active")
    completed_at = Column(DateTime(timezone=True), nullable=True)
    completion_stats = Column(JSON, nullable=True)
    final_stats = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cycle = relationship("MonthlyChallengeCycle", back_populates="challenges")


class MonthlyChallengeCheckin(Base):
    """Idempotent daily metrics and short AI wording for one monthly challenge cycle."""

    __tablename__ = "monthly_challenge_checkins"
    __table_args__ = (UniqueConstraint("cycle_id", "date", name="uq_monthly_challenge_checkin_cycle_date"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cycle_id = Column(UUID(as_uuid=True), ForeignKey("monthly_challenge_cycles.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    metrics_snapshot = Column(JSON, nullable=False, default=dict)
    progress_snapshot = Column(JSON, nullable=False, default=dict)
    checkin_data = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cycle = relationship("MonthlyChallengeCycle", back_populates="checkins")
    user = relationship("User", back_populates="monthly_challenge_checkins")


class MorningBriefing(Base):
    """Stores the AI-generated daily morning briefing per user."""
    
    __tablename__ = "morning_briefings"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_user_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    briefing_data = Column(JSON, nullable=False)             # Full AI JSON response
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="briefings")

    def __repr__(self):
        return f"<MorningBriefing(user_id={self.user_id}, date={self.date})>"


class WorkoutReview(Base):
    """
    Stores AI-generated session reviews & workout tips per Hevy workout.
    Generated automatically by the background scheduler.
    """

    __tablename__ = "workout_reviews"
    __table_args__ = (
        UniqueConstraint("user_id", "hevy_workout_id", name="uq_user_workout"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    hevy_workout_id = Column(String(64), nullable=False, index=True)   # Unique workout ID from Hevy
    workout_name = Column(String(255), nullable=False, index=True)     # e.g. "Push Tag", "Leg Day"
    workout_date = Column(DateTime(timezone=True), nullable=False)     # When the workout took place
    review_data = Column(JSON, nullable=False)                         # Full AI session review JSON
    tips_data = Column(JSON, nullable=True)                            # Full AI workout tips JSON
    is_read = Column(Boolean, nullable=False, server_default="false")  # Unread badge support
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="workout_reviews")

    def __repr__(self):
        return f"<WorkoutReview(user_id={self.user_id}, workout={self.workout_name}, date={self.workout_date})>"


class WeightEntry(Base):
    """
    Stores daily weight readings collected from Yazio.
    One entry per user per date — auto-inserted whenever we fetch Yazio data.
    """

    __tablename__ = "weight_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_user_weight_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    weight_kg = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="weight_entries")

    def __repr__(self):
        return f"<WeightEntry(user_id={self.user_id}, date={self.date}, weight={self.weight_kg})>"


class ForgeExercise(Base):
    """A user-owned canonical exercise; machine variants live in child profiles."""

    __tablename__ = "forge_exercises"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_forge_exercise_user_name"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    icon = Column(String(64), nullable=False, server_default="Dumbbell")
    equipment = Column(String(16), nullable=False, server_default="other")
    primary_muscle_group = Column(String(64), nullable=False)
    secondary_muscle_groups = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="forge_exercises")
    machine_profiles = relationship("ForgeMachineProfile", back_populates="exercise", cascade="all, delete-orphan")
    plan_exercises = relationship("ForgePlanExercise", back_populates="exercise")


class ForgeMachineProfile(Base):
    """A machine-specific loading profile for one canonical movement."""

    __tablename__ = "forge_machine_profiles"
    __table_args__ = (UniqueConstraint("exercise_id", "name", name="uq_forge_machine_profile_name"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)  # e.g. Life Fitness, Matrix
    model = Column(String(100), nullable=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    exercise = relationship("ForgeExercise", back_populates="machine_profiles")
    plan_exercises = relationship("ForgePlanExercise", back_populates="machine_profile")
    session_exercises = relationship("ForgeSessionExercise", back_populates="machine_profile")


class ForgeTrainingPlan(Base):
    """A named, user-owned training day/plan with ordered exercises."""

    __tablename__ = "forge_training_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    plan_type = Column(String(16), nullable=False, server_default="workout")
    default_duration_minutes = Column(Integer, nullable=True)
    position = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="forge_plans")
    exercises = relationship(
        "ForgePlanExercise",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="ForgePlanExercise.position",
    )


class ForgePlanExercise(Base):
    """One selected canonical exercise (and optional machine profile) within a plan."""

    __tablename__ = "forge_plan_exercises"
    __table_args__ = (UniqueConstraint("plan_id", "position", name="uq_forge_plan_exercise_position"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("forge_training_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_exercises.id", ondelete="RESTRICT"), nullable=False, index=True)
    machine_profile_id = Column(UUID(as_uuid=True), ForeignKey("forge_machine_profiles.id", ondelete="SET NULL"), nullable=True)
    position = Column(Integer, nullable=False)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    plan = relationship("ForgeTrainingPlan", back_populates="exercises")
    exercise = relationship("ForgeExercise", back_populates="plan_exercises")
    machine_profile = relationship("ForgeMachineProfile", back_populates="plan_exercises")
    sets = relationship(
        "ForgePlanSet",
        back_populates="plan_exercise",
        cascade="all, delete-orphan",
        order_by="ForgePlanSet.position",
    )


class ForgePlanSet(Base):
    """A prescribed set with history, editable target, and coach recommendation."""

    __tablename__ = "forge_plan_sets"
    __table_args__ = (UniqueConstraint("plan_exercise_id", "position", name="uq_forge_plan_set_position"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_plan_exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False)
    set_type = Column(String(16), nullable=False, server_default="working")
    previous_weight_kg = Column(Float, nullable=True)
    previous_reps = Column(Integer, nullable=True)
    current_weight_kg = Column(Float, nullable=True)
    current_reps = Column(Integer, nullable=True)
    coach_suggested_weight_kg = Column(Float, nullable=True)
    coach_suggested_reps = Column(Integer, nullable=True)
    note = Column(String(300), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    plan_exercise = relationship("ForgePlanExercise", back_populates="sets")


class ForgeTrainingProgram(Base):
    """An active program that orders native routines by rotation or weekday schedule."""

    __tablename__ = "forge_training_programs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    mode = Column(String(16), nullable=False, server_default="rotation")
    is_active = Column(Boolean, nullable=False, server_default="true")
    rotation_cursor = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="forge_programs")
    routines = relationship(
        "ForgeProgramRoutine",
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="ForgeProgramRoutine.position",
    )
    sessions = relationship("ForgeWorkoutSession", back_populates="program")


class ForgeProgramRoutine(Base):
    """Links one routine template to a program slot and optionally its weekdays.

    A rotation may deliberately repeat the same routine in several slots (for example
    A-B-A), so identity is the ordered slot rather than the routine itself.
    """

    __tablename__ = "forge_program_routines"
    __table_args__ = (UniqueConstraint("program_id", "position", name="uq_forge_program_routine_position"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    program_id = Column(UUID(as_uuid=True), ForeignKey("forge_training_programs.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("forge_training_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False)
    weekdays = Column(JSON, nullable=False, default=list)  # Monday=0 through Sunday=6
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    program = relationship("ForgeTrainingProgram", back_populates="routines")
    plan = relationship("ForgeTrainingPlan")


class ForgeWorkoutSession(Base):
    """An editable snapshot of a routine at the moment a user starts training."""

    __tablename__ = "forge_workout_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    program_id = Column(UUID(as_uuid=True), ForeignKey("forge_training_programs.id", ondelete="SET NULL"), nullable=True, index=True)
    source_plan_id = Column(UUID(as_uuid=True), ForeignKey("forge_training_plans.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    status = Column(String(16), nullable=False, server_default="active")
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    # One immutable, server-validated Gemini briefing for this session snapshot.
    start_coaching = Column(JSON, nullable=True)

    user = relationship("User", back_populates="forge_sessions")
    program = relationship("ForgeTrainingProgram", back_populates="sessions")
    exercises = relationship(
        "ForgeSessionExercise",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ForgeSessionExercise.position",
    )
    messages = relationship(
        "ForgeSessionMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ForgeSessionMessage.created_at",
    )


class ForgeSessionExercise(Base):
    """A session-local exercise snapshot, allowing live deviation from the routine."""

    __tablename__ = "forge_session_exercises"
    __table_args__ = (UniqueConstraint("session_id", "position", name="uq_forge_session_exercise_position"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("forge_workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    source_exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_exercises.id", ondelete="SET NULL"), nullable=True)
    source_plan_exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_plan_exercises.id", ondelete="SET NULL"), nullable=True)
    source_machine_profile_id = Column(UUID(as_uuid=True), ForeignKey("forge_machine_profiles.id", ondelete="RESTRICT"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    icon = Column(String(64), nullable=False, server_default="Dumbbell")
    equipment = Column(String(16), nullable=False, server_default="other")
    primary_muscle_group = Column(String(64), nullable=False)
    secondary_muscle_groups = Column(JSON, nullable=False, default=list)
    machine_profile_name = Column(String(100), nullable=True)
    notes = Column(String(500), nullable=True)
    coach_guidance = Column(JSON, nullable=True)
    # Coaching generated after this exercise was deliberately added live.
    addition_coaching = Column(JSON, nullable=True)
    position = Column(Integer, nullable=False)

    session = relationship("ForgeWorkoutSession", back_populates="exercises")
    machine_profile = relationship("ForgeMachineProfile", back_populates="session_exercises")
    sets = relationship(
        "ForgeSessionSet",
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        order_by="ForgeSessionSet.position",
    )


class ForgeSessionSet(Base):
    """A live set with planned, actual, and coach-proposed values."""

    __tablename__ = "forge_session_sets"
    __table_args__ = (UniqueConstraint("session_exercise_id", "position", name="uq_forge_session_set_position"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_exercise_id = Column(UUID(as_uuid=True), ForeignKey("forge_session_exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(Integer, nullable=False)
    set_type = Column(String(16), nullable=False, server_default="working")
    target_weight_kg = Column(Float, nullable=True)
    target_reps = Column(Integer, nullable=True)
    actual_weight_kg = Column(Float, nullable=True)
    actual_reps = Column(Integer, nullable=True)
    coach_suggested_weight_kg = Column(Float, nullable=True)
    coach_suggested_reps = Column(Integer, nullable=True)
    completed = Column(Boolean, nullable=False, server_default="false")
    note = Column(String(300), nullable=True)

    session_exercise = relationship("ForgeSessionExercise", back_populates="sets")


class ForgeSessionMessage(Base):
    """Persisted, session-scoped coaching chat with an optional pending action."""

    __tablename__ = "forge_session_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("forge_workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False)
    content = Column(String(4000), nullable=False)
    proposed_action = Column(JSON, nullable=True)
    action_status = Column(String(16), nullable=True)  # pending, applied, dismissed
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ForgeWorkoutSession", back_populates="messages")


class ForgeProgressPhoto(Base):
    """Private, user-owned figure snapshot metadata; image bytes stay in backend-only storage."""

    __tablename__ = "forge_progress_photos"
    __table_args__ = (
        Index("ix_forge_progress_photos_user_taken_created", "user_id", "taken_on", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    taken_on = Column(Date, nullable=False)
    view = Column(String(16), nullable=False, server_default="front")
    note = Column(String(500), nullable=True)
    storage_key = Column(String(512), nullable=False)
    content_type = Column(String(100), nullable=False, server_default="image/webp")
    byte_size = Column(Integer, nullable=False)
    width = Column(Integer, nullable=False)
    height = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="forge_progress_photos")


class GoogleHealthConnection(Base):
    """Encrypted OAuth credentials and connection state for one Google Health account."""

    __tablename__ = "google_health_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    refresh_token = Column(String(4096), nullable=False)
    access_token = Column(String(4096), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    scope = Column(String(2000), nullable=False)
    status = Column(String(32), nullable=False, server_default="connected")
    last_error = Column(String(1000), nullable=True)
    connected_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="google_health_connection")


class GoogleHealthWorkoutExport(Base):
    """One durable, idempotent export attempt per completed Forge session."""

    __tablename__ = "google_health_workout_exports"
    __table_args__ = (UniqueConstraint("session_id", name="uq_google_health_export_session"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("forge_workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(32), nullable=False, server_default="pending")
    external_data_point_name = Column(String(512), nullable=True)
    last_error = Column(String(1000), nullable=True)
    attempt_count = Column(Integer, nullable=False, server_default="0")
    attempted_at = Column(DateTime(timezone=True), nullable=True)
    exported_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="google_health_exports")
    session = relationship("ForgeWorkoutSession")


class GoogleHealthOAuthState(Base):
    """Short-lived, single-use OAuth CSRF state bound to one local account."""

    __tablename__ = "google_health_oauth_states"

    state = Column(String(128), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="google_health_oauth_states")
