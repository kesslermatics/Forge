import type { ForgeEquipment, ForgeSession, ForgeSessionExercise, ForgeSessionSet, ForgeSessionSetUpdateInput } from '../../api/api';

export const SAND = '#e8c58a';
export const TEXT = '#f2ece0';
export const DIM = 'rgba(242,236,226,0.52)';
export const FAINT = 'rgba(242,236,226,0.32)';
export const BORDER = 'rgba(232,197,138,0.12)';
export const MINT = '#83d6ad';
export const DANGER = '#f87171';
export const PANEL = '#1d1913';

/** Epley estimate; every working set is taken to failure. */
export const epley = (kg: number, reps: number) => kg * (1 + reps / 30);

export const formatKg = (value: number | null | undefined) => {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
};

export const displayLoad = (weight: number | null, reps: number | null, equipment: ForgeEquipment) => {
  if (weight == null && reps == null) return '—';
  const load = weight != null && weight > 0 ? `${formatKg(weight)} kg` : equipment === 'none' ? 'BW' : '—';
  return `${load}${reps != null ? ` × ${reps}` : ''}`;
};

/** Returns undefined while a decimal value is still being typed, e.g. "21,". */
export const parseWeightInput = (rawValue: string): number | null | undefined => {
  const value = rawValue.trim();
  if (!value) return null;
  if (/^\d+[.,]$/.test(value)) return undefined;
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed <= 1000 ? parsed : undefined;
};

export const toUpdateInput = (set: ForgeSessionSet, overrides: ForgeSessionSetUpdateInput = {}): ForgeSessionSetUpdateInput => ({
  set_type: set.set_type,
  actual_weight_kg: set.actual_weight_kg,
  actual_reps: set.actual_reps,
  completed: set.completed,
  note: set.note,
  ...overrides,
});

export const isTempId = (id: string) => id.startsWith('tmp-');

export const availableWeights = (exercise: ForgeSessionExercise) =>
  [...(exercise.machine_profile_snapshot?.available_weights_kg ?? [])].filter((value) => value > 0).sort((a, b) => a - b);

/** Shared set-row columns so the header lines up with every row: set · kg · reps · check. */
export const SET_ROW_COLUMNS = '36px minmax(0,1fr) minmax(0,1fr) 44px';

const FREE_WEIGHT_STEP = 2.5;

/**
 * Next weight up or down: the neighbouring stack weight of the machine profile, or ±2.5 kg
 * without a weight list. Returns null when there is no further step in that direction.
 */
export const stepWeight = (exercise: ForgeSessionExercise, current: number | null, direction: 1 | -1): number | null => {
  const stack = availableWeights(exercise);
  if (stack.length) {
    if (current == null) return direction > 0 ? stack[0] : null;
    const next = direction > 0
      ? stack.find((value) => value > current + 1e-6)
      : [...stack].reverse().find((value) => value < current - 1e-6);
    return next ?? null;
  }
  const base = current ?? 0;
  const next = Math.round((base + direction * FREE_WEIGHT_STEP) * 100) / 100;
  return next >= 0 ? next : null;
};

export const workingSets = (exercise: ForgeSessionExercise) => exercise.sets.filter((set) => set.set_type === 'working');

export const exerciseDone = (exercise: ForgeSessionExercise) => exercise.sets.length > 0 && exercise.sets.every((set) => set.completed);

export const coachDecisionFor = (session: ForgeSession, exercise: ForgeSessionExercise) => {
  if (exercise.addition_coaching) return exercise.addition_coaching.recommendation;
  return session.start_coaching?.exercise_decisions.find((decision) => decision.session_exercise_id === exercise.id)?.recommendation ?? null;
};

/** Exercises added, replaced or re-profiled after the start briefing need their own coaching call. */
export const needsCoaching = (session: ForgeSession, exercise: ForgeSessionExercise) =>
  session.status === 'active'
  && Boolean(session.start_coaching)
  && Boolean(exercise.source_exercise_id)
  && !exercise.addition_coaching
  && !session.start_coaching?.exercise_decisions.some((decision) => decision.session_exercise_id === exercise.id);

export const haptic = (pattern: number | number[]) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch { /* unsupported (e.g. iOS Safari) */ }
  }
};

export const formatClock = (startedAt: string, completedAt: string | null, now: number) => {
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
};

export const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error && caught.message ? caught.message : fallback);
