/**
 * API utility for communicating with the FastAPI backend.
 */

const API_URL = import.meta.env.VITE_API_URL || 'https://hevy-ai-coach-production.up.railway.app';

/* ── Token helpers ──────────────────────────────────────── */

export const getToken  = (): string | null => localStorage.getItem('token');
export const setToken  = (t: string): void => { localStorage.setItem('token', t); };
export const removeToken = (): void        => { localStorage.removeItem('token'); };
export const isAuthenticated = (): boolean => getToken() !== null;

/* ── Generic request ────────────────────────────────────── */

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `Error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function apiBlob(endpoint: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_URL}${endpoint}`, { headers, cache: 'no-store' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `Error ${res.status}`);
  }
  return res.blob();
}

/* ── Auth endpoints ─────────────────────────────────────── */

export const registerUser = (username: string, password: string) =>
  apiRequest<{ message: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const loginUser = async (username: string, password: string) => {
  const data = await apiRequest<{ access_token: string; token_type: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.access_token);
  return data;
};

export const logoutUser = () => { removeToken(); };

/* ── User endpoints ─────────────────────────────────────── */

export interface UserInfo {
  id: string;
  username: string;
  has_yazio: boolean;
  current_goal: string | null;
    target_weight: number | null;
  first_name: string | null;
  height_cm: number | null;
  language: 'de' | 'en';
  training_plan: string[] | null;
}

export const getMe = () => apiRequest<UserInfo>('/user/me');

export const saveYazioCredentials = (yazio_email: string, yazio_password: string) =>
  apiRequest<{ message: string; has_yazio: boolean }>('/user/yazio', {
    method: 'POST',
    body: JSON.stringify({ yazio_email, yazio_password }),
  });

/* ── Goal endpoints ─────────────────────────────────────── */

export const saveGoal = (current_goal: string, target_weight?: number | null) =>
  apiRequest<{ message: string; current_goal: string; target_weight: number | null }>('/user/goal', {
    method: 'POST',
    body: JSON.stringify({ current_goal, target_weight: target_weight ?? null }),
  });

export const updateLanguage = (language: 'de' | 'en') =>
  apiRequest<{ message: string; language: string }>('/user/language', {
    method: 'POST',
    body: JSON.stringify({ language }),
  });

export const updateUserProfile = (data: { first_name?: string | null; height_cm?: number | null }) =>
  apiRequest<{ message: string; first_name: string | null; height_cm: number | null }>('/user/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

/* ── Briefing endpoints ─────────────────────────────────── */

export interface NutritionReview {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export interface ExerciseHistory {
  date: string;
  best_set: string;
  e1rm: number;
  volume_kg: number;
}

export interface ExerciseReview {
  name: string;
  muscle_group: string;
  best_set: string;
  total_volume_kg: number;
  estimated_1rm: number;
  rank: string;
  rank_index: number;
  rank_percentile: string;
  rank_next: string;
  rank_next_target: string;
  trend: 'up' | 'down' | 'stable' | 'new';
  is_pr: boolean;
  pr_type: '1rm' | 'volume' | 'both' | 'none';
  history: ExerciseHistory[];
  feedback: string;
  next_target: string;
}

export interface LastSession {
  title: string;
  date: string;
  duration_min: number | null;
  overall_feedback: string;
  exercises: ExerciseReview[];
}

export interface NextSession {
  title: string;
  reasoning: string;
  focus_muscles: string[];
  suggested_exercises: string[];
}

export interface BriefingData {
  nutrition_review: NutritionReview;
  workout_suggestion: string;
  weight_trend: string;
  daily_mission?: string;
  weather_note: string;
  muscle_recovery: Record<string, number>;
}

export interface SessionReviewData {
  last_session: LastSession | null;
  next_session: NextSession | null;
}

export interface Briefing {
  id: string;
  date: string;
  briefing_data: BriefingData;
  created_at: string;
}

export const getTodayBriefing = (lat?: number, lon?: number) => {
  const params = lat != null && lon != null ? `?lat=${lat}&lon=${lon}` : '';
  return apiRequest<Briefing>(`/api/briefing/today${params}`);
};

export const regenerateBriefing = (lat?: number, lon?: number) => {
  const params = lat != null && lon != null ? `?lat=${lat}&lon=${lon}` : '';
  return apiRequest<Briefing>(`/api/briefing/regenerate${params}`, { method: 'POST' });
};

export const getSessionReview = () =>
  apiRequest<SessionReviewData>('/api/briefing/session-review', { method: 'POST' });

/* ── Weather ────────────────────────────────────────────── */

export interface WeatherData {
  temperature_c: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  windspeed_kmh: number | null;
  condition: string;
  daily_condition: string;
  emoji: string;
  is_day: boolean;
}

export const getWeather = (lat: number, lon: number) =>
  apiRequest<WeatherData>(`/api/briefing/weather?lat=${lat}&lon=${lon}`);

/* ── Workout picker + tips ──────────────────────────────── */

export interface WorkoutListItem {
  index: number;
  title: string;
  date: string;
  duration_min: number | null;
  exercise_names: string[];
}

export interface SetTarget {
  set_number: number;
  weight_kg: number;
  reps: number;
  note: string;
}

export interface ExerciseTarget {
  name: string;
  progression_status?: 'INCREASE_WEIGHT' | 'KEEP_PROGRESSING' | 'STAGNATED' | 'REGRESSED' | 'FIRST_SESSION';
  set_targets: SetTarget[];
  reasoning: string;
}

export interface NewExerciseSuggestion {
  name: string;
  why: string;
  suggested_sets_reps: string;
}

export interface WorkoutTips {
  workout_title: string;
  nutrition_context: string;
  exercise_targets: ExerciseTarget[];
  new_exercises_to_try: NewExerciseSuggestion[];
  general_advice: string;
}

export const getWorkoutList = () =>
  apiRequest<WorkoutListItem[]>('/api/briefing/workouts');

export const getWorkoutTips = (workout_name: string, force_regenerate = false) =>
  apiRequest<WorkoutTips>('/api/briefing/workout-tips', {
    method: 'POST',
    body: JSON.stringify({ workout_name, force_regenerate }),
  });

/* ── Workout Reviews (pre-generated by scheduler) ──────── */

export interface WorkoutReviewItem {
  id: string;
  hevy_workout_id: string;
  workout_name: string;
  workout_date: string;
  is_read: boolean;
  has_review: boolean;
  has_tips: boolean;
  review_data: SessionReviewData | null;
  tips_data: WorkoutTips | null;
  created_at: string;
}

export const getWorkoutReviews = (limit = 20) =>
  apiRequest<WorkoutReviewItem[]>(`/api/briefing/workout-reviews?limit=${limit}`);

export const markReviewRead = (reviewId: string) =>
  apiRequest<{ message: string }>(`/api/briefing/workout-reviews/${reviewId}/read`, { method: 'POST' });

export const getUnreadCount = () =>
  apiRequest<{ unread_count: number }>('/api/briefing/unread-count');

export const triggerReviewCheck = () =>
  apiRequest<{ message: string; new_reviews: number }>('/api/briefing/trigger-review', { method: 'POST' });

/* ── Activity Heatmap ───────────────────────────────────── */

export interface WorkoutDate {
  date: string;
  title: string;
  duration_min: number | null;
}

export interface NutritionDate {
  date: string;
  calories: number;
  protein: number;
}

export interface ActivityHeatmapData {
  workouts: WorkoutDate[];
  nutrition: NutritionDate[];
}

export const getActivityHeatmap = () =>
  apiRequest<ActivityHeatmapData>('/api/briefing/activity-heatmap');

/* ── Training Plan ──────────────────────────────────────── */

export const getTrainingPlan = () =>
  apiRequest<{ message: string; training_plan: string[] }>('/user/training-plan');

export const saveTrainingPlan = (workout_names: string[]) =>
  apiRequest<{ message: string; training_plan: string[] }>('/user/training-plan', {
    method: 'POST',
    body: JSON.stringify({ workout_names }),
  });

/* ── AI Coach Chat ──────────────────────────────────────── */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const sendChatMessage = (message: string, conversation_history: ChatMessage[]) =>
  apiRequest<{ response: string }>('/api/briefing/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversation_history }),
  });

/* ── Weight History ─────────────────────────────────────── */

export interface WeightHistoryEntry {
  date: string;
  weight_kg: number;
}

export interface WeightHistoryData {
  entries: WeightHistoryEntry[];
  start_weight: number | null;
  current_weight: number | null;
  count: number;
}

export const getWeightHistory = (days = 90) =>
  apiRequest<WeightHistoryData>(`/api/briefing/weight-history?days=${days}`);

/* ── Macro-Performance Correlation ──────────────────── */

export interface MacroPerformanceDataPoint {
  workout_date: string;
  workout_title: string;
  volume: number;
  best_e1rm: number;
  duration_min: number | null;
  prev_day_calories: number;
  prev_day_protein: number;
  prev_day_carbs: number;
  prev_day_fat: number;
  calorie_goal: number;
  protein_goal: number;
}

export interface MacroInsight {
  type: string;
  message_de: string;
  message_en: string;
  diff_percent: number;
  threshold?: number;
}

export interface MacroPerformanceData {
  data_points: MacroPerformanceDataPoint[];
  insights: MacroInsight[];
  has_enough_data: boolean;
  total_correlated_workouts: number;
}

export const getMacroPerformance = () =>
  apiRequest<MacroPerformanceData>('/api/briefing/macro-performance');

/* ── Progressive Overload ───────────────────────────── */

export interface ExerciseProgressDataPoint {
  date: string;
  best_set: string;
  e1rm: number;
  volume: number;
  sets: number;
  reps: number;
  muscle_group: string;
}

export interface ExerciseProgress {
  name: string;
  muscle_group: string;
  data_points: ExerciseProgressDataPoint[];
  sessions_count: number;
  first_e1rm: number;
  latest_e1rm: number;
  peak_e1rm: number;
  change_percent: number;
}

export const getProgressiveOverload = () =>
  apiRequest<ExerciseProgress[]>('/api/briefing/progressive-overload');

/* ── Streaks ────────────────────────────────────────── */

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  total_active_weeks: number;
}

export interface StreaksData {
  training: StreakInfo;
  nutrition: StreakInfo;
  combined: StreakInfo;
}

export const getStreaks = () =>
  apiRequest<StreaksData>('/api/briefing/streaks');

/* ── Weekly / Monthly Reports ───────────────────────── */

export interface ReportTraining {
  workouts_count: number;
  total_volume_kg: number;
  total_sets: number;
  total_duration_min: number;
  muscle_groups: Record<string, number>;
  workout_names?: string[];
  best_e1rms?: Record<string, number>;
}

export interface ReportNutrition {
  days_tracked: number;
  avg_calories: number;
  avg_protein: number;
  avg_carbs?: number;
  avg_fat?: number;
  calorie_goal?: number;
  protein_goal?: number;
}

export interface ReportWeight {
  start: number | null;
  end: number | null;
  change: number | null;
}

export interface WeeklyReport {
  week_start: string;
  week_end: string;
  week_offset: number;
  training: ReportTraining;
  nutrition: ReportNutrition;
  weight: ReportWeight;
}

export interface MonthlyReport {
  month: string;
  month_start: string;
  month_end: string;
  month_offset: number;
  training: ReportTraining;
  nutrition: ReportNutrition;
  weight: ReportWeight;
}

export const getWeeklyReport = (weekOffset = 0) =>
  apiRequest<{ current: WeeklyReport; previous: WeeklyReport }>(`/api/briefing/weekly-report?week_offset=${weekOffset}`);

export const getMonthlyReport = (monthOffset = 0) =>
  apiRequest<{ current: MonthlyReport; previous: MonthlyReport }>(`/api/briefing/monthly-report?month_offset=${monthOffset}`);

/* ── Achievements ───────────────────────────────────── */

export interface Achievement {
  id: string;
  name_de: string;
  name_en: string;
  desc_de: string;
  desc_en: string;
  icon: string;
  category: string;
  unlocked: boolean;
  unlocked_date: string | null;
  progress: number;
  target: number;
}

export const getAchievements = () =>
  apiRequest<Achievement[]>('/api/briefing/achievements');

/* ── Today's Nutrition ──────────────────────────────── */

export interface NutritionMacros {
  calories: number; protein: number; carbs: number; fat: number;
  sugar: number; fiber: number; saturated: number; salt: number;
}

export interface FoodItem {
  name: string;
  brand: string;
  amount: number;
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface TodayNutrition {
  totals: NutritionMacros;
  goals: NutritionMacros;
  meals: Record<string, NutritionMacros>;
  food_items?: Record<string, FoodItem[]>;
  water_ml: number;
  error?: string;
}

export const getTodayNutrition = () =>
  apiRequest<TodayNutrition>('/api/briefing/today-nutrition');

/* ── Nutrition History ──────────────────────────────── */

export interface NutritionDay {
  date: string;
  totals: NutritionMacros;
  goals: NutritionMacros;
}

export interface NutritionHistoryData {
  days: NutritionDay[];
  error?: string;
}

export const getNutritionHistory = (days = 7) =>
  apiRequest<NutritionHistoryData>(`/api/briefing/nutrition-history?days=${days}`);

/* ── Food Statistics ────────────────────────────────── */

export interface TopFood {
  name: string;
  brand: string;
  count: number;
}

export interface TopProteinFood {
  name: string;
  brand: string;
  protein_g: number;
}

export interface TopCalorieFood {
  name: string;
  brand: string;
  calories: number;
}

export interface TopBrand {
  brand: string;
  count: number;
}

export interface NewFood {
  name: string;
  brand: string;
  first_seen: string;
}

export interface FoodStatisticsData {
  top_foods: TopFood[];
  top_protein: TopProteinFood[];
  top_calories: TopCalorieFood[];
  top_brands: TopBrand[];
  new_this_week: NewFood[];
  days_analyzed: number;
  error?: string;
}

export const getFoodStatistics = (days = 30) =>
  apiRequest<FoodStatisticsData>(`/api/briefing/food-statistics?days=${days}`);

/* ── Nutrition Analysis (AI) ────────────────────────── */

export interface NutritionAnalysis {
  analysis: string;
}

export const getNutritionAnalysis = () =>
  apiRequest<NutritionAnalysis>('/api/briefing/nutrition-analysis', {
    method: 'POST',
  });


/* ── Native Forge planning ─────────────────────────────── */

export type ForgeEquipment = 'none' | 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'other';
export type ForgeSetType = 'warmup' | 'working';

export interface ForgeMachineProfile {
  id: string;
  name: string;
  model: string | null;
  notes: string | null;
}

export interface ForgeMachineProfileInput {
  id?: string;
  name: string;
  model?: string | null;
  notes?: string | null;
}

export interface ForgeExercise {
  id: string;
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profiles: ForgeMachineProfile[];
}

export interface ForgeExerciseInput {
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profiles: ForgeMachineProfileInput[];
}

export interface ForgeExerciseHistorySet {
  position: number;
  set_type: ForgeSetType;
  actual_weight_kg: number | null;
  actual_reps: number | null;
  completed: boolean;
  note: string | null;
}

export interface ForgeExerciseHistorySession {
  id: string;
  name: string;
  completed_at: string;
  started_at: string;
  machine_profile_id: string | null;
  machine_profile_name: string | null;
  sets: ForgeExerciseHistorySet[];
}

export interface ForgeExerciseHistory {
  exercise: ForgeExercise;
  sessions: ForgeExerciseHistorySession[];
}

export interface ForgePlanSet {
  id: string;
  position: number;
  set_type: ForgeSetType;
  previous_weight_kg: number | null;
  previous_reps: number | null;
  current_weight_kg: number | null;
  current_reps: number | null;
  coach_suggested_weight_kg: number | null;
  coach_suggested_reps: number | null;
  note: string | null;
}

export interface ForgePlanSetInput {
  set_type: ForgeSetType;
  previous_weight_kg?: number | null;
  previous_reps?: number | null;
  current_weight_kg?: number | null;
  current_reps?: number | null;
  coach_suggested_weight_kg?: number | null;
  coach_suggested_reps?: number | null;
  note?: string | null;
}

export interface ForgePlanExercise {
  id: string;
  position: number;
  notes: string | null;
  exercise: ForgeExercise;
  machine_profile: ForgeMachineProfile | null;
  sets: ForgePlanSet[];
}

export interface ForgePlanExerciseInput {
  exercise_id: string;
  machine_profile_id?: string | null;
  notes?: string | null;
  sets: ForgePlanSetInput[];
}

export interface ForgePlan {
  id: string;
  name: string;
  description: string | null;
  position: number;
  exercises: ForgePlanExercise[];
}

export interface ForgePlanInput {
  name: string;
  description?: string | null;
  position: number;
  exercises: ForgePlanExerciseInput[];
}

export const getForgeExercises = () => apiRequest<ForgeExercise[]>('/api/forge/exercises');
export const getForgeExerciseHistory = (id: string, machineProfileId?: string | null) => {
  const query = machineProfileId ? `?machine_profile_id=${encodeURIComponent(machineProfileId)}` : '';
  return apiRequest<ForgeExerciseHistory>(`/api/forge/exercises/${id}/history${query}`);
};
export const createForgeExercise = (data: ForgeExerciseInput) =>
  apiRequest<ForgeExercise>('/api/forge/exercises', { method: 'POST', body: JSON.stringify(data) });
export const updateForgeExercise = (id: string, data: ForgeExerciseInput) =>
  apiRequest<ForgeExercise>(`/api/forge/exercises/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteForgeExercise = (id: string) =>
  apiRequest<void>(`/api/forge/exercises/${id}`, { method: 'DELETE' });
export const generateForgeExerciseDraft = (instructions: string, allowed_icons: string[]) =>
  apiRequest<{ draft: ForgeExerciseInput }>('/api/forge/drafts/exercise', {
    method: 'POST', body: JSON.stringify({ instructions, allowed_icons }),
  });

export const getForgePlans = () => apiRequest<ForgePlan[]>('/api/forge/plans');
export const createForgePlan = (data: ForgePlanInput) =>
  apiRequest<ForgePlan>('/api/forge/plans', { method: 'POST', body: JSON.stringify(data) });
export const updateForgePlan = (id: string, data: ForgePlanInput) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteForgePlan = (id: string) =>
  apiRequest<void>(`/api/forge/plans/${id}`, { method: 'DELETE' });
export const generateForgePlanDraft = (instructions: string, exercise_ids: string[], base_plan_id?: string) =>
  apiRequest<{ draft: ForgePlanInput }>('/api/forge/drafts/plan', {
    method: 'POST', body: JSON.stringify({ instructions, exercise_ids, base_plan_id: base_plan_id ?? null }),
  });


/* ── Native Forge programs and live sessions ───────────── */

export type ForgeProgramMode = 'rotation' | 'weekly';

export interface ForgeProgramRoutine {
  id: string;
  position: number;
  weekdays: number[];
  plan: ForgePlan;
}

export interface ForgeProgram {
  id: string;
  name: string;
  mode: ForgeProgramMode;
  is_active: boolean;
  rotation_cursor: number;
  routines: ForgeProgramRoutine[];
}

export interface ForgeProgramInput {
  name: string;
  mode: ForgeProgramMode;
  is_active: boolean;
  routines: Array<{ plan_id: string; weekdays: number[] }>;
}

export interface ForgeToday {
  mode: ForgeProgramMode | null;
  program: ForgeProgram | null;
  routine: ForgePlan | null;
  options: ForgePlan[];
  message: string;
}

export interface ForgeSessionSet {
  id: string;
  position: number;
  set_type: ForgeSetType;
  target_weight_kg: number | null;
  target_reps: number | null;
  actual_weight_kg: number | null;
  actual_reps: number | null;
  coach_suggested_weight_kg: number | null;
  coach_suggested_reps: number | null;
  completed: boolean;
  note: string | null;
}

export interface ForgeSessionSetInput {
  set_type: ForgeSetType;
  target_weight_kg?: number | null;
  target_reps?: number | null;
  actual_weight_kg?: number | null;
  actual_reps?: number | null;
  coach_suggested_weight_kg?: number | null;
  coach_suggested_reps?: number | null;
  completed: boolean;
  note?: string | null;
}

export interface ForgeSessionCoachGuidance {
  progression_status: 'INCREASE_WEIGHT' | 'KEEP_PROGRESSING' | 'STAGNATED' | 'REGRESSED' | 'FIRST_SESSION';
  rep_range: string;
  rationale: string;
}

export interface ForgeSessionExercise {
  id: string;
  source_exercise_id: string | null;
  machine_profile_id: string | null;
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profile_name: string | null;
  notes: string | null;
  coach_guidance: ForgeSessionCoachGuidance | null;
  position: number;
  sets: ForgeSessionSet[];
}

export interface ForgeSessionAction {
  type: 'adjust_set' | 'add_set' | 'add_exercise';
  title: string;
  payload: Record<string, unknown>;
}

export interface ForgeSessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposed_action: ForgeSessionAction | null;
  action_status: 'pending' | 'applied' | 'dismissed' | null;
  created_at: string;
}

export interface ForgeSession {
  id: string;
  program_id: string | null;
  source_plan_id: string | null;
  name: string;
  status: 'active' | 'completed';
  started_at: string;
  completed_at: string | null;
  exercises: ForgeSessionExercise[];
  messages: ForgeSessionMessage[];
}

export interface ForgeSessionSummary {
  id: string;
  name: string;
  status: 'completed';
  source_plan_id: string | null;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  completed_sets: number;
  total_sets: number;
}

export const getForgePrograms = () => apiRequest<ForgeProgram[]>('/api/forge/programs');
export const createForgeProgram = (data: ForgeProgramInput) =>
  apiRequest<ForgeProgram>('/api/forge/programs', { method: 'POST', body: JSON.stringify(data) });
export const updateForgeProgram = (id: string, data: ForgeProgramInput) =>
  apiRequest<ForgeProgram>(`/api/forge/programs/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteForgeProgram = (id: string) =>
  apiRequest<void>(`/api/forge/programs/${id}`, { method: 'DELETE' });
export const getForgeToday = () => apiRequest<ForgeToday>('/api/forge/today');

export const startForgeSession = (plan_id: string, program_id?: string | null) =>
  apiRequest<ForgeSession>('/api/forge/sessions', { method: 'POST', body: JSON.stringify({ plan_id, program_id: program_id ?? null }) });
export const getActiveForgeSession = () => apiRequest<ForgeSession | null>('/api/forge/sessions/active');
export const listForgeSessions = (limit = 50, offset = 0) =>
  apiRequest<ForgeSessionSummary[]>(`/api/forge/sessions?limit=${limit}&offset=${offset}`);
export const getForgeSession = (id: string) => apiRequest<ForgeSession>(`/api/forge/sessions/${id}`);
export const deleteForgeSession = (id: string) =>
  apiRequest<void>(`/api/forge/sessions/${id}`, { method: 'DELETE' });
export const addForgeSessionExercise = (sessionId: string, data: { exercise_id?: string; name?: string; machine_profile_id?: string | null; notes?: string | null; sets: ForgeSessionSetInput[] }) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises`, { method: 'POST', body: JSON.stringify(data) });
export const updateForgeSessionSet = (sessionId: string, setId: string, data: ForgeSessionSetInput) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/sets/${setId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const addForgeSessionSet = (sessionId: string, sessionExerciseId: string, data: ForgeSessionSetInput) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}/sets`, { method: 'POST', body: JSON.stringify(data) });
export const deleteForgeSessionSet = (sessionId: string, setId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/sets/${setId}`, { method: 'DELETE' });
export const deleteForgeSessionExercise = (sessionId: string, sessionExerciseId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}`, { method: 'DELETE' });
export const completeForgeSession = (sessionId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/complete`, { method: 'POST' });
export const sendForgeSessionChat = (sessionId: string, message: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/chat`, { method: 'POST', body: JSON.stringify({ message }) });
export const applyForgeSessionAction = (sessionId: string, message_id: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/actions/apply`, { method: 'POST', body: JSON.stringify({ message_id }) });
export const dismissForgeSessionAction = (sessionId: string, message_id: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/actions/dismiss`, { method: 'POST', body: JSON.stringify({ message_id }) });

export const updateForgeSessionExercise = (sessionId: string, sessionExerciseId: string, data: { machine_profile_id?: string | null; notes?: string | null }) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}`, { method: 'PATCH', body: JSON.stringify(data) });

export const refreshForgePlanCoachTargets = (planId: string) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${planId}/coach-targets`, { method: 'POST' });


/* ── Private Forge progress photos ───────────────────── */

export type ForgeProgressPhotoView = 'front' | 'side' | 'back' | 'other';

export interface ForgeProgressPhotoContext {
  weight_kg: number | null;
  current_goal: string | null;
  target_weight_kg: number | null;
  workout_names: string[];
}

export interface ForgeProgressPhoto {
  id: string;
  taken_on: string;
  view: ForgeProgressPhotoView;
  note: string | null;
  byte_size: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string | null;
  context: ForgeProgressPhotoContext;
}

export interface ForgeProgressPhotoList {
  items: ForgeProgressPhoto[];
  total: number;
}

export const listForgeProgressPhotos = (limit = 50, offset = 0) =>
  apiRequest<ForgeProgressPhotoList>(`/api/forge/progress-photos?limit=${limit}&offset=${offset}`);
export const createForgeProgressPhoto = (form: FormData) =>
  apiRequest<ForgeProgressPhoto>('/api/forge/progress-photos', { method: 'POST', body: form });
export const updateForgeProgressPhoto = (id: string, data: { taken_on?: string; view?: ForgeProgressPhotoView; note?: string | null }) =>
  apiRequest<ForgeProgressPhoto>(`/api/forge/progress-photos/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteForgeProgressPhoto = (id: string) =>
  apiRequest<void>(`/api/forge/progress-photos/${id}`, { method: 'DELETE' });
export const fetchForgeProgressPhotoImage = (id: string) =>
  apiBlob(`/api/forge/progress-photos/${id}/image`);
