import type { ForgeCoachingStepId, ForgeCoachingStreamEvent } from '../../api/api';

export type StepStatus = 'pending' | 'active' | 'done';

export interface CoachingProgress {
  steps: Record<ForgeCoachingStepId, { status: StepStatus; detail?: string; startedAt?: number }>;
  ai: { phase: 'thinking' | 'writing'; attempt: number; doneExercises: number; totalExercises: number; doneSets: number; totalSets: number } | null;
  retries: number;
  startedAt: number;
}

export const COACHING_STEPS: Array<{ id: ForgeCoachingStepId; label: string }> = [
  { id: 'profiles', label: 'Session & Geräte laden' },
  { id: 'nutrition', label: 'Ernährung aus Yazio' },
  { id: 'history', label: 'Trainingsverlauf auswerten' },
  { id: 'ai', label: 'KI plant deine Sätze' },
  { id: 'save', label: 'Ziele speichern' },
];

export const initialCoachingProgress = (now: number): CoachingProgress => ({
  steps: { profiles: { status: 'pending' }, nutrition: { status: 'pending' }, history: { status: 'pending' }, ai: { status: 'pending' }, save: { status: 'pending' } },
  ai: null,
  retries: 0,
  startedAt: now,
});

/** Pure reducer for the server's preparation events. */
export const applyCoachingEvent = (progress: CoachingProgress, event: ForgeCoachingStreamEvent, now: number): CoachingProgress => {
  if (event.type === 'step') {
    const previous = progress.steps[event.id];
    return {
      ...progress,
      steps: {
        ...progress.steps,
        [event.id]: { status: event.status, detail: event.detail ?? previous.detail, startedAt: event.status === 'active' ? now : previous.startedAt },
      },
    };
  }
  if (event.type === 'ai') {
    const previous = progress.ai;
    if (event.phase === 'thinking') {
      return { ...progress, ai: { phase: 'thinking', attempt: event.attempt, doneExercises: 0, totalExercises: previous?.totalExercises ?? 0, doneSets: 0, totalSets: previous?.totalSets ?? 0 } };
    }
    return { ...progress, ai: { phase: 'writing', attempt: event.attempt, doneExercises: event.done_exercises, totalExercises: event.total_exercises, doneSets: event.done_sets, totalSets: event.total_sets } };
  }
  if (event.type === 'retry') return { ...progress, retries: progress.retries + 1 };
  return progress;
};
