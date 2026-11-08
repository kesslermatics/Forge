/**
 * API utility for communicating with the FastAPI backend.
 */

const API_URL = import.meta.env.VITE_API_URL || 'https://forge.kesslermatics.com/api';

/* ── Token helpers ──────────────────────────────────────── */

export const getToken  = (): string | null => localStorage.getItem('token');
export const setToken  = (t: string): void => { localStorage.setItem('token', t); };
export const removeToken = (): void        => { localStorage.removeItem('token'); };
export const isAuthenticated = (): boolean => getToken() !== null;

/* ── Generic request ────────────────────────────────────── */

function apiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string'
        ? (item as { msg: string }).msg
        : null)
      .filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join(' · ');
  }
  return fallback;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const payload: unknown = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Error ${res.status}`));
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
    const payload: unknown = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Error ${res.status}`));
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
  has_google_health: boolean;
  first_name: string | null;
  height_cm: number | null;
  language: 'de' | 'en';
  training_plan: string[] | null;
}

export const getMe = () => apiRequest<UserInfo>('/user/me');

export interface PersonalApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedPersonalApiKey extends PersonalApiKey {
  api_key: string;
}

export const listPersonalApiKeys = () =>
  apiRequest<{ items: PersonalApiKey[] }>('/user/api-keys');

export const createPersonalApiKey = (name: string) =>
  apiRequest<CreatedPersonalApiKey>('/user/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const revokePersonalApiKey = (id: string) =>
  apiRequest<void>(`/user/api-keys/${id}`, { method: 'DELETE' });

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

export interface GoogleHealthStatus {
  configured: boolean;
  connected: boolean;
  status: 'not_connected' | 'connected' | 'reauthorization_required' | string;
  last_error: string | null;
  last_exported_at: string | null;
  failed_exports: number;
}

export const getGoogleHealthStatus = () => apiRequest<GoogleHealthStatus>('/user/google-health');
export const startGoogleHealthConnection = () =>
  apiRequest<{ authorization_url: string }>('/user/google-health/connect', { method: 'POST' });
export const disconnectGoogleHealth = () =>
  apiRequest<GoogleHealthStatus>('/user/google-health', { method: 'DELETE' });

/* ── Coaching endpoints ─────────────────────────────────── */

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

export interface SessionReviewData {
  last_session: LastSession | null;
  next_session: NextSession | null;
}

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





/* ── Training Plan ──────────────────────────────────────── */

export const getTrainingPlan = () =>
  apiRequest<{ message: string; training_plan: string[] }>('/user/training-plan');

export const saveTrainingPlan = (workout_names: string[]) =>
  apiRequest<{ message: string; training_plan: string[] }>('/user/training-plan', {
    method: 'POST',
    body: JSON.stringify({ workout_names }),
  });

/* ── AI Coach Chat ──────────────────────────────────────── */

/* ── AI Coach Chat ──────────────────────────────────────── */

export interface ChatAgentDetail {
  type: 'tool' | 'thinking' | 'summary';
  text?: string;
  label?: string;
  tool?: string;
  round?: number;
  call?: number;
  status?: 'completed' | 'error';
}

export interface ChatMessage {
  id?: string;
  sequence?: number;
  role: 'user' | 'assistant';
  content: string;
  status?: 'completed' | 'aborted' | 'error';
  agent_details?: ChatAgentDetail[];
  created_at?: string | null;
}

export interface ChatConversation {
  id: string;
  title: string;
  summary: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  messages?: ChatMessage[];
}

export interface ChatStreamEvent {
  type: 'round_started' | 'tool_started' | 'tool_finished' | 'thinking' | 'summary_started' | 'summary_finished' | 'completed' | 'error';
  round?: number;
  max_rounds?: number;
  tool?: string;
  label?: string;
  text?: string;
  call?: number;
  max_calls?: number;
  message?: ChatMessage | string;
  conversation?: ChatConversation;
}

// A fresh, private conversation is created whenever the Coach page opens.
// Deliberately no list, rename, or delete API is exposed: there is no chat history UI.
export const createChatConversation = () =>
  apiRequest<ChatConversation>('/api/briefing/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const streamChatMessage = async (
  conversationId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  messageId?: string,
): Promise<void> => {
  const token = getToken();
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api/briefing/chat/conversations/${conversationId}/messages/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(messageId ? { message, message_id: messageId } : { message }),
    signal,
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Error ${response.status}`));
  }
  if (!response.body) throw new Error('Der Chat-Stream ist nicht verfügbar.');
  await readEventStream(response.body, onEvent);
};

/** Parses a server-sent-events body (`data: {json}` blocks) and hands each event to `onEvent`. */
async function readEventStream<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (block: string) => {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data: '))
      .map(line => line.slice(6))
      .join('');
    if (!data) return;
    onEvent(JSON.parse(data) as T);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
}


/* ── Weight History ─────────────────────────────────────── */

export interface WeightHistoryEntry {
  date: string;
  weight_kg: number;
}

/** One stored weighing; a day can have several. `time` is the Berlin time of day (HH:MM). */
export interface WeightMeasurement extends WeightHistoryEntry {
  id: string;
  time: string | null;
}

export interface WeightHistoryData {
  /** One value per day: the mean of that day's measurements. */
  entries: WeightHistoryEntry[];
  /** Today's single measurements, oldest first. */
  today: WeightMeasurement[];
  /** Newest measurement overall, independent of the requested window. */
  latest: WeightMeasurement | null;
  start_weight: number | null;
  current_weight: number | null;
  /** Weight goal from the profile (all null when unset). */
  goal: { start_kg: number | null; start_date: string | null; target_kg: number | null; target_date: string | null };
  count: number;
}

/** `keepalive` lets the request finish while the app is being closed or sent to the background. */
export const saveWeight = (weightKg: number, date: string, keepalive = false) =>
  apiRequest<WeightMeasurement>('/api/briefing/weight', {
    method: 'PUT',
    body: JSON.stringify({ weight_kg: weightKg, date }),
    keepalive,
  });

export const deleteWeight = (id: string) =>
  apiRequest<void>(`/api/briefing/weight/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface ClothingItem { id: string; name: string; weight_g: number; icon: string }
export type ClothingItemInput = Omit<ClothingItem, 'id'> & { id?: string };

/** Things worn while weighing; the list is fixed per user and subtracted on tap. */
export const getWeightClothing = () => apiRequest<{ items: ClothingItem[] }>('/api/briefing/weight-clothing');
export const saveWeightClothing = (items: ClothingItemInput[]) =>
  apiRequest<{ items: ClothingItem[] }>('/api/briefing/weight-clothing', { method: 'PUT', body: JSON.stringify({ items }) });

export const getWeightHistory = (startDate: string | null = null, days = 90) => {
  const params = startDate
    ? `start_date=${encodeURIComponent(startDate)}`
    : `days=${days}`;
  return apiRequest<WeightHistoryData>(`/api/briefing/weight-history?${params}`);
};

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

export interface ConsistencyDay {
  date: string;
  training: boolean;
  nutrition: boolean;
}

export interface ConsistencyData {
  days: ConsistencyDay[];
  nutrition_streak_days: number;
  training_streak_weeks: number;
  training_sessions_this_week: number;
  training_weekly_goal: number;
}

export const getConsistency = () =>
  apiRequest<ConsistencyData>('/api/briefing/consistency');

/* ── Native food tracking ───────────────────────────── */

export type FoodSource = 'bls' | 'off';
export type FoodUnit = 'g' | 'ml';

export interface TrackMacros {
  kcal: number; protein: number; carbs: number; fat: number;
  sugar: number; fiber: number; saturated: number; salt: number;
}

export interface MealSlot { id: string; name: string; position: number }

export interface MealSlotDay extends MealSlot { totals: TrackMacros; entry_count: number }

/** Daily targets; null until the user has set them. */
export interface NutritionGoals { kcal: number; protein: number; carbs: number; fat: number; sugar: number | null; salt: number | null; fiber: number | null }

export interface TrackDay {
  date: string;
  totals: TrackMacros;
  goals: NutritionGoals | null;
  entry_count: number;
  slots: MealSlotDay[];
  unassigned: { totals: TrackMacros; entry_count: number };
}

export interface FoodSummary {
  source: FoodSource;
  source_id: string;
  name: string;
  brand: string | null;
  unit: FoodUnit;
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
  serving_g: number | null;
  serving_label: string | null;
  tracked_count: number;
  default_amount: number;
}

export interface FoodNutrient { k: string; l: string; u: string; v: number; g: string }

export interface FoodServing { label: string; detail: string | null; amount: number }

export interface FoodDetail extends FoodSummary {
  name_alt: string | null;
  sugar: number | null; fiber: number | null; saturated: number | null; salt: number | null;
  nutrients: FoodNutrient[];
  package_g: number | null;
  quantity_label: string | null;
  ingredients: string | null;
  allergens: string[];
  quality: 'ok' | 'incomplete' | 'suspect';
  servings: FoodServing[];
  attribution: string;
  trackable: boolean;
}

export interface TrackEntry extends Omit<TrackMacros, 'sugar' | 'fiber' | 'saturated' | 'salt'> {
  id: string;
  date: string;
  slot_id: string | null;
  source: FoodSource;
  source_id: string;
  name: string;
  brand: string | null;
  unit: FoodUnit;
  amount: number;
  sugar: number | null; fiber: number | null; saturated: number | null; salt: number | null;
  per_100: Record<keyof TrackMacros, number | null>;
  logged_at: string;
}

export const getMealSlots = () => apiRequest<{ items: MealSlot[] }>('/api/nutrition/slots');
export const createMealSlot = (name: string) =>
  apiRequest<MealSlot>('/api/nutrition/slots', { method: 'POST', body: JSON.stringify({ name }) });
export const renameMealSlot = (id: string, name: string) =>
  apiRequest<MealSlot>(`/api/nutrition/slots/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
export const reorderMealSlots = (slotIds: string[]) =>
  apiRequest<{ items: MealSlot[] }>('/api/nutrition/slots/order', { method: 'PUT', body: JSON.stringify({ slot_ids: slotIds }) });
export const deleteMealSlot = (id: string) =>
  apiRequest<void>(`/api/nutrition/slots/${id}`, { method: 'DELETE' });

export const getTrackDay = (date: string) =>
  apiRequest<TrackDay>(`/api/nutrition/day?date=${encodeURIComponent(date)}`);
export interface OverviewTotals { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; salt: number }
export interface OverviewWeekDay { date: string; kcal: number; logged: boolean; goal_kcal: number | null; future: boolean }
export interface OverviewDay {
  date: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number; logged: boolean;
  goal_kcal: number | null; goal_protein: number | null; goal_fiber: number | null;
}
export interface OverviewWeek { start: string; avg_kcal: number | null; logged_days: number; avg_weight_kg: number | null }
export interface OverviewMeal { name: string; kcal: number }
export interface OverviewFood { source: FoodSource; source_id: string; name: string; brand: string | null; count: number; avg_kcal: number }
export interface NutritionOverview {
  today: { date: string; totals: OverviewTotals; goals: NutritionGoals | null };
  week: OverviewWeekDay[];
  streak_days: number;
  /** Last 30 days, oldest first. */
  days: OverviewDay[];
  /** Last 8 Monday-based weeks, oldest first. */
  weeks: OverviewWeek[];
  weight_kg: number | null;
  meals: Record<'7' | '30', OverviewMeal[]>;
  top_foods: Record<'7' | '30', OverviewFood[]>;
}
export const getNutritionOverview = () => apiRequest<NutritionOverview>('/api/nutrition/overview');

export const getTrackEntries = (date: string, slotId: string | null) =>
  apiRequest<{ items: TrackEntry[]; totals: TrackMacros }>(
    `/api/nutrition/entries?date=${encodeURIComponent(date)}${slotId ? `&slot_id=${slotId}` : '&unassigned=true'}`);
/** Every entry of the day, across all meals. */
export const getTrackDayEntries = (date: string) =>
  apiRequest<{ items: TrackEntry[]; totals: TrackMacros }>(`/api/nutrition/entries?date=${encodeURIComponent(date)}`);
export const createTrackEntry = (data: { date: string; slot_id: string | null; source: FoodSource; source_id: string; amount: number }) =>
  apiRequest<TrackEntry>('/api/nutrition/entries', { method: 'POST', body: JSON.stringify(data) });
export const updateTrackEntry = (id: string, amount: number) =>
  apiRequest<TrackEntry>(`/api/nutrition/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ amount }) });
export const deleteTrackEntry = (id: string) =>
  apiRequest<void>(`/api/nutrition/entries/${id}`, { method: 'DELETE' });

export const getRecentFoods = () => apiRequest<{ items: FoodSummary[] }>('/api/nutrition/recent');

/* ── Free-text tracking ("100g Hähnchen von Lidl, 200g Kartoffeln") ── */

export interface SmartTrackItem {
  index: number;
  name: string;
  brand: string | null;
  amount: number;
  unit: FoodUnit;
  /** The amount was guessed by the model ("eine Banane", "bisschen Öl"). */
  estimated: boolean;
}

/** A catalog product offered as choice; same fields as the search result. */
export type SmartTrackOption = Pick<FoodSummary, 'source' | 'source_id' | 'name' | 'brand' | 'unit' | 'kcal' | 'protein' | 'carbs' | 'fat'>;

export type SmartTrackEvent =
  | { type: 'parsed'; items: SmartTrackItem[] }
  | { type: 'item'; index: number; status: 'tracked' | 'ambiguous' | 'not_found' | 'error'; entry: TrackEntry | null; alternatives: SmartTrackOption[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export const streamSmartTrack = async (
  data: { text?: string; image?: string; date: string; slot_id: string | null },
  onEvent: (event: SmartTrackEvent) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const token = getToken();
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api/nutrition/smart-track`, { method: 'POST', headers, body: JSON.stringify(data), signal });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Error ${response.status}`));
  }
  if (!response.body) throw new Error('Der Stream ist nicht verfügbar.');
  await readEventStream(response.body, onEvent);
};
export const searchFoods = (query: string, signal?: AbortSignal) =>
  apiRequest<{ query: string; items: FoodSummary[] }>(`/api/nutrition/search?q=${encodeURIComponent(query)}`, { signal });
export const lookupBarcode = (code: string) =>
  apiRequest<FoodDetail>(`/api/nutrition/barcode/${encodeURIComponent(code)}`);
export const getFoodDetail = (source: FoodSource, sourceId: string) =>
  apiRequest<FoodDetail>(`/api/nutrition/foods/${source}/${encodeURIComponent(sourceId)}`);

/* ── Native Forge planning ─────────────────────────────── */

export type ForgeEquipment = 'none' | 'barbell' | 'dumbbell' | 'kettlebell' | 'cable' | 'machine' | 'other';
export type ForgeSetType = 'warmup' | 'working';

export type ForgeLoadingSystem = 'selectorized' | 'plate_loaded' | 'fixed' | 'other' | 'unknown';
export type ForgeLoadBasis = 'displayed_total' | 'per_side' | 'unknown';

export interface ForgeMachineProfile {
  id: string;
  name: string;
  model: string | null;
  notes: string | null;
  loading_system: ForgeLoadingSystem;
  load_basis: ForgeLoadBasis;
  available_weights_kg: number[];
  exercise_ids: string[];
}

export interface ForgeMachineProfileInput {
  id?: string;
  name: string;
  model?: string | null;
  notes?: string | null;
  loading_system?: ForgeLoadingSystem;
  load_basis?: ForgeLoadBasis;
  available_weights_kg?: number[];
  exercise_ids?: string[];
}

export interface ForgeLastPerformance {
  completed_at: string;
  machine_profile_id: string | null;
  machine_profile_name: string | null;
  sets: Array<{
    position: number;
    set_type: ForgeSetType;
    actual_weight_kg: number | null;
    actual_reps: number;
  }>;
}

export interface ForgeExercise {
  id: string;
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profiles: ForgeMachineProfile[];
  available_machine_profiles: ForgeMachineProfile[];
  last_performance?: ForgeLastPerformance | null;
}

export interface ForgeExerciseInput {
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profile_ids: string[];
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
  session_note?: string | null;
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

export type ForgePlanType = 'workout' | 'course';

export interface ForgePlan {
  id: string;
  name: string;
  description: string | null;
  plan_type: ForgePlanType;
  default_duration_minutes: number | null;
  position: number;
  has_image: boolean;
  exercises: ForgePlanExercise[];
}

export interface ForgePlanInput {
  name: string;
  description?: string | null;
  plan_type: ForgePlanType;
  default_duration_minutes?: number | null;
  position: number;
  exercises: ForgePlanExerciseInput[];
}

export const getForgeMachineProfiles = () => apiRequest<ForgeMachineProfile[]>('/api/forge/machine-profiles');
export const createForgeMachineProfile = (data: ForgeMachineProfileInput) =>
  apiRequest<ForgeMachineProfile>('/api/forge/machine-profiles', { method: 'POST', body: JSON.stringify(data) });
export const updateForgeMachineProfile = (id: string, data: ForgeMachineProfileInput) =>
  apiRequest<ForgeMachineProfile>(`/api/forge/machine-profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteForgeMachineProfile = (id: string) =>
  apiRequest<void>(`/api/forge/machine-profiles/${id}`, { method: 'DELETE' });

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
  apiRequest<{ draft: ForgeExerciseInput & { duplicate_of?: string | null } }>('/api/forge/drafts/exercise', {
    method: 'POST', body: JSON.stringify({ instructions, allowed_icons }),
  });

/** Structure-only view of a training-day exercise used by the editor and the AI rework. */
export interface ForgePlanStructureExercise {
  exercise_id: string;
  machine_profile_id: string | null;
  warmup_sets: number;
  working_sets: number;
  notes: string | null;
}

export interface ForgePlanEditDraft {
  name: string;
  description: string | null;
  summary: string;
  exercises: ForgePlanStructureExercise[];
}

/** Ask the AI to rework an unsaved plan structure; nothing is persisted. */
export const generateForgePlanEditDraft = (data: { instructions: string; name: string; description: string | null; exercises: ForgePlanStructureExercise[] }) =>
  apiRequest<{ draft: ForgePlanEditDraft }>('/api/forge/drafts/plan-edit', { method: 'POST', body: JSON.stringify(data) });

export const getForgePlans = () => apiRequest<ForgePlan[]>('/api/forge/plans');
export const createForgePlan = (data: ForgePlanInput) =>
  apiRequest<ForgePlan>('/api/forge/plans', { method: 'POST', body: JSON.stringify(data) });
export const updateForgePlan = (id: string, data: ForgePlanInput) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteForgePlan = (id: string) =>
  apiRequest<void>(`/api/forge/plans/${id}`, { method: 'DELETE' });
export const uploadForgePlanImage = (id: string, form: FormData) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${id}/image`, { method: 'PUT', body: form });
export const deleteForgePlanImage = (id: string) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${id}/image`, { method: 'DELETE' });
export const fetchForgePlanImage = (id: string) =>
  apiBlob(`/api/forge/plans/${id}/image`);
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
  completed: boolean;
  note?: string | null;
}

export interface ForgeSessionSetUpdateInput {
  set_type?: ForgeSetType;
  actual_weight_kg?: number | null;
  actual_reps?: number | null;
  completed?: boolean;
  note?: string | null;
  position?: number;
}

/** Server-side evidence snapshot persisted with coaching; the UI does not read it. */
export type ForgeCoachEvidence = Record<string, unknown>;

export interface ForgeSessionCoachGuidance {
  progression_status: 'INCREASE_WEIGHT' | 'KEEP_PROGRESSING' | 'STAGNATED' | 'REGRESSED' | 'FIRST_SESSION';
  rationale: string;
}

export interface ForgeSessionCoachDecision {
  session_exercise_id: string;
  recommendation: string;
  evidence_refs: string[];
}

export interface ForgeSessionStartCoaching {
  coaching_source?: 'ai' | 'fallback';
  headline: string;
  session_focus: string;
  exercise_decisions: ForgeSessionCoachDecision[];
  coach_evidence: ForgeCoachEvidence;
}

export interface ForgeSessionAdditionCoaching {
  recommendation: string;
  evidence_refs: string[];
  coach_evidence: ForgeCoachEvidence;
}

export interface ForgeSessionExercise {
  id: string;
  source_exercise_id: string | null;
  source_plan_exercise_id: string | null;
  machine_profile_id: string | null;
  name: string;
  icon: string;
  equipment: ForgeEquipment;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  machine_profile_name: string | null;
  machine_profile_snapshot: (Omit<ForgeMachineProfile, 'exercise_ids'> & { snapshot_quality?: 'best_available_current' }) | null;
  notes: string | null;
  /** Free-text note the user writes during the workout. */
  session_note: string | null;
  coach_guidance: ForgeSessionCoachGuidance | null;
  addition_coaching: ForgeSessionAdditionCoaching | null;
  position: number;
  sets: ForgeSessionSet[];
}

export type ForgeSessionActionType =
  | 'adjust_sets' | 'add_set' | 'add_exercise' | 'replace_exercise' | 'remove_exercise'
  | 'reorder_exercises' | 'set_machine_profile' | 'create_machine_profile' | 'set_session_note'
  // legacy single-action proposals
  | 'adjust_set';

export interface ForgeSessionAction {
  id?: string;
  type: ForgeSessionActionType;
  title: string;
  payload: Record<string, unknown>;
}

/** New agent replies carry {actions, tools_used}; older messages hold one bare action. */
export type ForgeSessionProposal = { actions: ForgeSessionAction[]; tools_used?: string[] } | ForgeSessionAction;

export interface ForgeSessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposed_action: ForgeSessionProposal | null;
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
  start_coaching: ForgeSessionStartCoaching | null;
  /** Free-text wish behind an AI-composed session. */
  user_request?: string | null;
  /** Routine description, or the AI's description for composed sessions. */
  description?: string | null;
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
export const getForgeToday = () => apiRequest<ForgeToday>('/api/forge/today', { cache: 'no-store' });

/** Start a session from hand-picked exercises (no routine); coaching runs as usual afterwards. */
export const startForgeCustomSession = (exercise_ids: string[], name?: string | null) =>
  apiRequest<ForgeSession>('/api/forge/sessions/custom', { method: 'POST', body: JSON.stringify({ exercise_ids, name: name ?? null }) });
/** Let the AI compose a session from the library for a free-text wish, then start it. */
export const startForgeAiSession = (prompt: string) =>
  apiRequest<ForgeSession>('/api/forge/sessions/ai', { method: 'POST', body: JSON.stringify({ prompt }) });
export const startForgeSession = (plan_id: string, program_id?: string | null) =>
  apiRequest<ForgeSession>('/api/forge/sessions', { method: 'POST', body: JSON.stringify({ plan_id, program_id: program_id ?? null }) });
export const completeForgeCourse = (planId: string, program_id?: string | null) =>
  apiRequest<ForgeSession>(`/api/forge/plans/${planId}/complete-course`, { method: 'POST', body: JSON.stringify({ program_id: program_id ?? null }) });
export const getActiveForgeSession = () => apiRequest<ForgeSession | null>('/api/forge/sessions/active');
export const listForgeSessions = (limit = 50, offset = 0) =>
  apiRequest<ForgeSessionSummary[]>(`/api/forge/sessions?limit=${limit}&offset=${offset}`);
export const getForgeSession = (id: string) => apiRequest<ForgeSession>(`/api/forge/sessions/${id}`);
export const generateForgeSessionStartCoaching = (id: string, force = false) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${id}/start-coaching${force ? '?force=true' : ''}`, { method: 'POST' });

export type ForgeCoachingStepId = 'profiles' | 'nutrition' | 'history' | 'ai' | 'save';
export type ForgeCoachingStreamEvent =
  | { type: 'step'; id: ForgeCoachingStepId; status: 'active' | 'done'; detail?: string }
  | { type: 'ai'; phase: 'thinking'; attempt: number }
  | { type: 'ai'; phase: 'writing'; attempt: number; done_exercises: number; total_exercises: number; done_sets: number; total_sets: number }
  | { type: 'retry'; attempt: number; reason: 'validation' | 'provider' }
  | { type: 'completed'; session: ForgeSession }
  | { type: 'error'; message: string };

/** Streams the real preparation steps of the session briefing and resolves with the prepared session. */
export const streamForgeSessionStartCoaching = async (
  id: string,
  onEvent: (event: ForgeCoachingStreamEvent) => void,
  signal?: AbortSignal,
): Promise<ForgeSession> => {
  const token = getToken();
  const headers = new Headers({ Accept: 'text/event-stream' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}/api/forge/sessions/${id}/start-coaching/stream`, { method: 'POST', headers, signal });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Error ${response.status}`));
  }
  if (!response.body) throw new Error('Der Fortschritts-Stream ist nicht verfügbar.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const outcome: { session: ForgeSession | null; failure: string | null } = { session: null, failure: null };
  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('');
    if (!data) return;
    const event = JSON.parse(data) as ForgeCoachingStreamEvent;
    if (event.type === 'completed') outcome.session = event.session;
    if (event.type === 'error') outcome.failure = event.message;
    onEvent(event);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (outcome.failure) throw new Error(outcome.failure);
  if (!outcome.session) throw new Error('Die Vorbereitung wurde unterbrochen.');
  return outcome.session;
};
export const deleteForgeSession = (id: string) =>
  apiRequest<void>(`/api/forge/sessions/${id}`, { method: 'DELETE' });
export const addForgeSessionExercise = (sessionId: string, data: { exercise_id?: string; name?: string; machine_profile_id?: string | null; notes?: string | null; sets: ForgeSessionSetInput[] }) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises`, { method: 'POST', body: JSON.stringify(data) });
export const generateForgeSessionExerciseAdditionCoaching = (sessionId: string, sessionExerciseId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}/addition-coaching`, { method: 'POST' });
export const updateForgeSessionSet = (sessionId: string, setId: string, data: ForgeSessionSetUpdateInput) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/sets/${setId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const addForgeSessionSet = (sessionId: string, sessionExerciseId: string, data: ForgeSessionSetInput) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}/sets`, { method: 'POST', body: JSON.stringify(data) });
export const deleteForgeSessionSet = (sessionId: string, setId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/sets/${setId}`, { method: 'DELETE' });
export const deleteForgeSessionExercise = (sessionId: string, sessionExerciseId: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}`, { method: 'DELETE' });
export interface ForgePlanChanges {
  has_changes: boolean;
  can_apply: boolean;
  changes: Array<{ kind: string; label: string; detail: string }>;
}

export const getForgeSessionPlanChanges = (sessionId: string) =>
  apiRequest<ForgePlanChanges>(`/api/forge/sessions/${sessionId}/plan-changes`);
export const completeForgeSession = (sessionId: string, apply_plan_changes: boolean) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/complete`, {
    method: 'POST', body: JSON.stringify({ apply_plan_changes }),
  });
export const sendForgeSessionChat = (sessionId: string, message: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/chat`, { method: 'POST', body: JSON.stringify({ message }) });
export const applyForgeSessionAction = (sessionId: string, message_id: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/actions/apply`, { method: 'POST', body: JSON.stringify({ message_id }) });
export const dismissForgeSessionAction = (sessionId: string, message_id: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/actions/dismiss`, { method: 'POST', body: JSON.stringify({ message_id }) });

export const updateForgeSessionExercise = (sessionId: string, sessionExerciseId: string, data: { machine_profile_id?: string | null; notes?: string | null; session_note?: string | null }) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const replaceForgeSessionExercise = (sessionId: string, sessionExerciseId: string, exercise_id: string) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercises/${sessionExerciseId}/replace`, { method: 'POST', body: JSON.stringify({ exercise_id }) });
export const reorderForgeSessionExercises = (sessionId: string, session_exercise_ids: string[]) =>
  apiRequest<ForgeSession>(`/api/forge/sessions/${sessionId}/exercise-order`, { method: 'PUT', body: JSON.stringify({ session_exercise_ids }) });

export const refreshForgePlanCoachTargets = (planId: string) =>
  apiRequest<ForgePlan>(`/api/forge/plans/${planId}/coach-targets`, { method: 'POST' });


/* ── Private Forge progress photos ───────────────────── */

export type ForgeProgressPhotoView = 'front' | 'side' | 'back' | 'other';

export interface ForgeProgressPhotoContext {
  weight_kg: number | null;
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

/* ── Goals and day note ─────────────────────────────── */

export interface WeightGoal {
  start_kg: number | null;
  start_date: string | null;
  target_kg: number | null;
  target_date: string | null;
  current_kg: number | null;
  current_date: string | null;
  kg_to_go: number | null;
  days_left: number | null;
  required_rate_kg_per_week: number | null;
}

export interface GoalsData {
  weight: WeightGoal;
  nutrition: (NutritionGoals & { valid_from: string }) | null;
  nutrition_rules: string | null;
}

/** Every field is optional: only the fields that are sent change. Daily targets apply from today on. */
export interface GoalsInput {
  start_weight_kg?: number | null;
  start_date?: string | null;
  target_weight_kg?: number | null;
  target_date?: string | null;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  sugar?: number | null;
  salt?: number | null;
  fiber?: number | null;
  nutrition_rules?: string | null;
}

export const getGoals = () => apiRequest<GoalsData>('/api/goals');
export const saveGoals = (data: GoalsInput) =>
  apiRequest<GoalsData>('/api/goals', { method: 'PUT', body: JSON.stringify(data) });

export const getDayNote = (date: string) =>
  apiRequest<{ date: string; text: string | null }>(`/api/day-note?date=${encodeURIComponent(date)}`);
/** `keepalive` lets the request finish while the app is being closed or sent to the background. */
export const saveDayNote = (date: string, text: string, keepalive = false) =>
  apiRequest<{ date: string; text: string | null }>('/api/day-note', {
    method: 'PUT',
    body: JSON.stringify({ date, text }),
    keepalive,
  });
