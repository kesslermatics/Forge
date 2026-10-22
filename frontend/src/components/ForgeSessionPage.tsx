import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BrainCircuit, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, ListOrdered,
  Loader2, MoreHorizontal, Plus, RefreshCw, Replace, Sparkles, Trash2, Undo2, X,
} from 'lucide-react';
import {
  addForgeSessionExercise, addForgeSessionSet, applyForgeSessionAction, completeForgeSession,
  deleteForgeSession, deleteForgeSessionExercise, deleteForgeSessionSet, dismissForgeSessionAction,
  generateForgeSessionCompletionReview, generateForgeSessionExerciseAdditionCoaching, generateForgeSessionStartCoaching,
  getForgeExercises, getForgeMachineProfiles, getForgeSession, getForgeSessionPlanChanges, reorderForgeSessionExercises,
  replaceForgeSessionExercise, sendForgeSessionChat, streamForgeSessionStartCoaching, updateForgeSessionExercise, updateForgeSessionSet,
} from '../api/api';
import { applyCoachingEvent, initialCoachingProgress } from './forgeSession/coachingProgress';
import type { CoachingProgress } from './forgeSession/coachingProgress';
import type { ForgeExercise, ForgeMachineProfile, ForgePlanChanges, ForgeSession, ForgeSessionExercise, ForgeSessionSet, ForgeSessionSetInput } from '../api/api';
import ForgeSessionLoader from './ForgeSessionLoader';
import ForgeExercisePicker from './ForgeExercisePicker';
import ForgeSheet from './ForgeSheet';
import ConfirmDialog from './ConfirmDialog';
import SetRow from './forgeSession/SetRow';
import ExerciseStatsCard from './forgeSession/ExerciseStatsCard';
import SessionCoachSheet from './forgeSession/SessionCoachSheet';
import ExerciseOverviewSheet from './forgeSession/ExerciseOverviewSheet';
import CompletionSummary from './forgeSession/CompletionSummary';
import {
  BORDER, DIM, SAND, SET_ROW_COLUMNS, TEXT, coachDecisionFor, errorMessage, exerciseDone, formatClock, haptic, isTempId,
  needsCoaching, parseWeightInput, toUpdateInput,
} from './forgeSession/shared';

const SET_SAVE_DELAY = 600;
const NOTE_SAVE_DELAY = 800;
const UNDO_WINDOW = 4500;

type PendingDelete = { set: ForgeSessionSet; exerciseId: string; index: number; timer: ReturnType<typeof setTimeout> };

const renumber = (sets: ForgeSessionSet[]) => sets.map((set, position) => ({ ...set, position }));

export default function ForgeSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<ForgeSession | null>(null);
  const [library, setLibrary] = useState<ForgeExercise[]>([]);
  const [machineProfiles, setMachineProfiles] = useState<ForgeMachineProfile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slide, setSlide] = useState<'left' | 'right' | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [coachingProgress, setCoachingProgress] = useState<CoachingProgress | null>(null);
  const [startCoachingError, setStartCoachingError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [justCheckedId, setJustCheckedId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ setId: string } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [replaceForId, setReplaceForId] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirm, setConfirm] = useState<'complete' | 'discard' | 'remove-exercise' | null>(null);
  const [completionChanges, setCompletionChanges] = useState<ForgePlanChanges | null>(null);
  const [checkingCompletion, setCheckingCompletion] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [busyExerciseIds, setBusyExerciseIds] = useState<string[]>([]);
  const [coachingIds, setCoachingIds] = useState<string[]>([]);
  const [coachingErrors, setCoachingErrors] = useState<Record<string, string>>({});
  const [chatSending, setChatSending] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);

  const sessionRef = useRef<ForgeSession | null>(null);
  const mutationQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingMutations = useRef(0);
  const setTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingDeletes = useRef<Record<string, PendingDelete>>({});
  const coachingInFlight = useRef<Set<string>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── state plumbing ─────────────────────────────────────────────
  const commitSession = useCallback((next: ForgeSession) => {
    sessionRef.current = next;
    setSession(next);
    setActiveIndex((current) => Math.min(current, Math.max(0, next.exercises.length - 1)));
  }, []);

  const updateLocal = useCallback((updater: (current: ForgeSession) => ForgeSession) => {
    const current = sessionRef.current;
    if (current) commitSession(updater(current));
  }, [commitSession]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const hasLocalWork = useCallback(() => Object.keys(setTimers.current).length > 0
    || Object.keys(noteTimers.current).length > 0
    || Object.keys(pendingDeletes.current).length > 0, []);

  /**
   * Serialised server write. The UI is already updated optimistically; the server
   * snapshot is only adopted once no other write or local edit is outstanding, so a
   * slow response never overwrites newer input. Failures resync from the server.
   */
  const enqueue = useCallback((operation: () => Promise<ForgeSession>, fallback = 'Änderung konnte nicht gespeichert werden.') => {
    pendingMutations.current += 1;
    const request = mutationQueue.current.then(operation);
    mutationQueue.current = request.catch(() => undefined);
    return request.then((server) => {
      pendingMutations.current -= 1;
      if (pendingMutations.current === 0 && !hasLocalWork()) commitSession(server);
      return server;
    }, async (caught: unknown) => {
      pendingMutations.current -= 1;
      showToast(errorMessage(caught, fallback));
      haptic([30, 40, 30]);
      if (pendingMutations.current === 0 && sessionRef.current) {
        try { commitSession(await getForgeSession(sessionRef.current.id)); } catch { /* keep local state */ }
      }
      throw caught;
    });
  }, [commitSession, hasLocalWork, showToast]);

  const findSet = useCallback((setId: string) => sessionRef.current?.exercises.flatMap((exercise) => exercise.sets).find((set) => set.id === setId) ?? null, []);
  const exerciseOfSet = useCallback((setId: string) => sessionRef.current?.exercises.find((exercise) => exercise.sets.some((set) => set.id === setId)) ?? null, []);

  const patchSet = useCallback((setId: string, patch: Partial<ForgeSessionSet>) => {
    updateLocal((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
      })),
    }));
  }, [updateLocal]);

  const patchExercise = useCallback((exerciseId: string, patch: Partial<ForgeSessionExercise> | ((exercise: ForgeSessionExercise) => ForgeSessionExercise)) => {
    updateLocal((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise;
        return typeof patch === 'function' ? patch(exercise) : { ...exercise, ...patch };
      }),
    }));
  }, [updateLocal]);

  // ── set autosave ───────────────────────────────────────────────
  const flushSet = useCallback((setId: string) => {
    if (setTimers.current[setId]) { clearTimeout(setTimers.current[setId]); delete setTimers.current[setId]; }
    const current = sessionRef.current;
    const live = findSet(setId);
    if (!current || !live || isTempId(setId) || current.status !== 'active') return Promise.resolve();
    return enqueue(() => {
      const latest = findSet(setId) ?? live;
      return updateForgeSessionSet(current.id, setId, toUpdateInput(latest));
    }, 'Satz konnte nicht gespeichert werden.').then(() => undefined, () => undefined);
  }, [enqueue, findSet]);

  const scheduleSetSave = useCallback((setId: string) => {
    if (setTimers.current[setId]) clearTimeout(setTimers.current[setId]);
    setTimers.current[setId] = setTimeout(() => { void flushSet(setId); }, SET_SAVE_DELAY);
  }, [flushSet]);

  // ── notes autosave ─────────────────────────────────────────────
  const flushNote = useCallback((exerciseId: string) => {
    if (noteTimers.current[exerciseId]) { clearTimeout(noteTimers.current[exerciseId]); delete noteTimers.current[exerciseId]; }
    const current = sessionRef.current;
    if (!current || current.status !== 'active') return Promise.resolve();
    return enqueue(() => {
      const note = sessionRef.current?.exercises.find((exercise) => exercise.id === exerciseId)?.session_note ?? null;
      return updateForgeSessionExercise(current.id, exerciseId, { session_note: note });
    }, 'Notiz konnte nicht gespeichert werden.').then(() => undefined, () => undefined);
  }, [enqueue]);

  // ── deferred set deletion with undo ────────────────────────────
  const commitDelete = useCallback((setId: string) => {
    const pending = pendingDeletes.current[setId];
    if (!pending) return Promise.resolve();
    clearTimeout(pending.timer);
    delete pendingDeletes.current[setId];
    setUndo((current) => (current?.setId === setId ? null : current));
    const current = sessionRef.current;
    if (!current || isTempId(setId)) return Promise.resolve();
    return enqueue(() => deleteForgeSessionSet(current.id, setId), 'Satz konnte nicht gelöscht werden.').then(() => undefined, () => undefined);
  }, [enqueue]);

  /** Queue every pending local edit now, so a following structural write includes it. */
  const flushLocal = useCallback(() => {
    Object.keys(setTimers.current).forEach((setId) => { void flushSet(setId); });
    Object.keys(noteTimers.current).forEach((exerciseId) => { void flushNote(exerciseId); });
    Object.keys(pendingDeletes.current).forEach((setId) => { void commitDelete(setId); });
  }, [commitDelete, flushNote, flushSet]);

  const flushAll = useCallback(async () => {
    await Promise.all([
      ...Object.keys(setTimers.current).map((setId) => flushSet(setId)),
      ...Object.keys(noteTimers.current).map((exerciseId) => flushNote(exerciseId)),
      ...Object.keys(pendingDeletes.current).map((setId) => commitDelete(setId)),
    ]);
    await mutationQueue.current;
  }, [commitDelete, flushNote, flushSet]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushAll(); };
    const onPageHide = () => { void flushAll(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      void flushAll();
    };
  }, [flushAll]);

  // ── loading ────────────────────────────────────────────────────
  const prepareCoaching = useCallback(async (id: string) => {
    setPreparing(true); setStartCoachingError(null);
    setCoachingProgress(initialCoachingProgress(Date.now()));
    let receivedEvents = false;
    try {
      const prepared = await streamForgeSessionStartCoaching(id, (event) => {
        receivedEvents = true;
        setCoachingProgress((current) => (current ? applyCoachingEvent(current, event, Date.now()) : current));
      });
      commitSession(prepared);
    } catch (caught: unknown) {
      if (receivedEvents) {
        setStartCoachingError(errorMessage(caught, 'Das KI-Coaching konnte nicht erstellt werden.'));
      } else {
        // Streaming unavailable (e.g. a proxy): fall back to the plain request without live steps.
        setCoachingProgress(null);
        try {
          commitSession(await generateForgeSessionStartCoaching(id, false));
        } catch (fallbackError: unknown) {
          setStartCoachingError(errorMessage(fallbackError, 'Das KI-Coaching konnte nicht erstellt werden.'));
        }
      }
    } finally {
      setPreparing(false);
      setCoachingProgress(null);
    }
  }, [commitSession]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [loaded, exercises, profiles] = await Promise.all([getForgeSession(sessionId), getForgeExercises(), getForgeMachineProfiles()]);
        if (cancelled) return;
        commitSession(loaded); setLibrary(exercises); setMachineProfiles(profiles);
        const firstOpen = loaded.exercises.findIndex((exercise) => !exerciseDone(exercise));
        setActiveIndex(firstOpen >= 0 ? firstOpen : 0);
        if (loaded.status === 'active' && !loaded.start_coaching) await prepareCoaching(sessionId);
      } catch (caught: unknown) {
        if (!cancelled) showToast(errorMessage(caught, 'Session konnte nicht geladen werden.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, commitSession, prepareCoaching, showToast]);

  // Coach brief: once per session and device.
  const briefKey = sessionId ? `forge-brief-seen:${sessionId}` : '';
  const hasAiBrief = session?.start_coaching?.coaching_source === 'ai' && session.status === 'active';
  useEffect(() => {
    if (hasAiBrief && briefKey && !localStorage.getItem(briefKey)) setBriefOpen(true);
  }, [hasAiBrief, briefKey]);
  const closeBrief = () => { setBriefOpen(false); if (briefKey) localStorage.setItem(briefKey, '1'); };

  // Live clock.
  useEffect(() => {
    if (session?.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  // Exercises added, replaced or re-profiled get their own coaching in the background.
  useEffect(() => {
    const current = session;
    if (!current || current.status !== 'active') return;
    for (const exercise of current.exercises) {
      if (!needsCoaching(current, exercise) || coachingInFlight.current.has(exercise.id) || coachingErrors[exercise.id]) continue;
      coachingInFlight.current.add(exercise.id);
      setCoachingIds((ids) => [...ids, exercise.id]);
      generateForgeSessionExerciseAdditionCoaching(current.id, exercise.id)
        .then((server) => {
          const coached = server.exercises.find((item) => item.id === exercise.id);
          if (!coached) return;
          patchExercise(exercise.id, (local) => ({
            ...local,
            addition_coaching: coached.addition_coaching,
            sets: local.sets.map((set) => {
              const fresh = coached.sets.find((item) => item.id === set.id);
              return fresh ? { ...set, target_weight_kg: fresh.target_weight_kg, target_reps: fresh.target_reps, coach_suggested_weight_kg: fresh.coach_suggested_weight_kg, coach_suggested_reps: fresh.coach_suggested_reps } : set;
            }),
          }));
        })
        .catch((caught: unknown) => setCoachingErrors((errors) => ({ ...errors, [exercise.id]: errorMessage(caught, 'Coaching gerade nicht verfügbar.') })))
        .finally(() => {
          coachingInFlight.current.delete(exercise.id);
          setCoachingIds((ids) => ids.filter((id) => id !== exercise.id));
        });
    }
  }, [session, coachingErrors, patchExercise]);

  const retryCoaching = (exerciseId: string) => setCoachingErrors((errors) => {
    const next = { ...errors }; delete next[exerciseId]; return next;
  });

  // ── derived ────────────────────────────────────────────────────
  const activeExercise = session?.exercises[activeIndex] ?? null;
  const activeLibraryExercise = useMemo(() => library.find((item) => item.id === activeExercise?.source_exercise_id) ?? null, [library, activeExercise?.source_exercise_id]);
  const expandedSetId = useMemo(() => {
    if (!activeExercise) return null;
    if (activeSetId && activeExercise.sets.some((set) => set.id === activeSetId && !set.completed)) return activeSetId;
    return activeExercise.sets.find((set) => !set.completed)?.id ?? null;
  }, [activeExercise, activeSetId]);
  const profileOptions = useMemo(() => {
    const all = [...machineProfiles, ...(activeLibraryExercise?.available_machine_profiles ?? []), ...(activeLibraryExercise?.machine_profiles ?? [])];
    return all.filter((profile, index) => all.findIndex((item) => item.id === profile.id) === index);
  }, [machineProfiles, activeLibraryExercise]);

  // ── navigation ─────────────────────────────────────────────────
  const goTo = (index: number) => {
    if (!session || index < 0 || index >= session.exercises.length || index === activeIndex) return;
    setSlide(index > activeIndex ? 'left' : 'right');
    setActiveIndex(index);
    setActiveSetId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── set actions ────────────────────────────────────────────────
  const onWeightInput = (set: ForgeSessionSet, raw: string) => {
    setWeightDrafts((drafts) => ({ ...drafts, [set.id]: raw }));
    const parsed = parseWeightInput(raw);
    if (parsed === undefined) return;
    patchSet(set.id, { actual_weight_kg: parsed });
    scheduleSetSave(set.id);
  };
  const onWeightPick = (set: ForgeSessionSet, value: number) => {
    setWeightDrafts((drafts) => { const next = { ...drafts }; delete next[set.id]; return next; });
    patchSet(set.id, { actual_weight_kg: value });
    scheduleSetSave(set.id);
  };
  const onWeightBlur = (set: ForgeSessionSet) => {
    setWeightDrafts((drafts) => { const next = { ...drafts }; delete next[set.id]; return next; });
    if (setTimers.current[set.id]) void flushSet(set.id);
  };
  const onReps = (set: ForgeSessionSet, value: number | null) => {
    patchSet(set.id, { actual_reps: value });
    scheduleSetSave(set.id);
  };

  const toggleSet = (set: ForgeSessionSet) => {
    const live = findSet(set.id);
    const exercise = exerciseOfSet(set.id);
    if (!live || !exercise || !sessionRef.current) return;
    const checking = !live.completed;
    const weight = live.actual_weight_kg ?? live.target_weight_kg;
    const reps = live.actual_reps ?? live.target_reps;
    if (checking && live.set_type === 'working' && (!reps || reps < 1 || (exercise.equipment !== 'none' && (!weight || weight <= 0)))) {
      haptic([30, 40, 30]);
      setActiveSetId(live.id);
      showToast(exercise.equipment === 'none' ? 'Trag zuerst deine Wiederholungen ein.' : 'Trag zuerst Gewicht und Wiederholungen ein.');
      return;
    }
    patchSet(live.id, checking ? { completed: true, actual_weight_kg: weight, actual_reps: reps } : { completed: false });
    if (checking) {
      haptic(12);
      setJustCheckedId(live.id);
      setTimeout(() => setJustCheckedId((current) => (current === live.id ? null : current)), 650);
      const remaining = exercise.sets.filter((item) => !item.completed && item.id !== live.id);
      setActiveSetId(remaining[0]?.id ?? null);
      if (!remaining.length) setTimeout(() => haptic([15, 70, 30]), 120);
    }
    void flushSet(live.id);
  };

  const toggleSetType = (set: ForgeSessionSet) => {
    const exercise = exerciseOfSet(set.id);
    const current = sessionRef.current;
    if (!exercise || !current) return;
    const nextType = set.set_type === 'warmup' ? 'working' : 'warmup';
    const others = exercise.sets.filter((item) => item.id !== set.id);
    const position = others.filter((item) => item.set_type === 'warmup').length;
    const reordered = [...others];
    reordered.splice(position, 0, { ...set, set_type: nextType });
    patchExercise(exercise.id, { sets: renumber(reordered) });
    haptic(6);
    enqueue(() => {
      const latest = findSet(set.id) ?? set;
      return updateForgeSessionSet(current.id, set.id, { ...toUpdateInput(latest, { set_type: nextType }), position });
    }).catch(() => undefined);
  };

  const addSet = () => {
    const current = sessionRef.current;
    if (!current || !activeExercise) return;
    const last = activeExercise.sets.at(-1);
    const draft: ForgeSessionSetInput = {
      set_type: last?.set_type ?? 'working',
      target_weight_kg: last?.target_weight_kg ?? null,
      target_reps: last?.target_reps ?? 10,
      actual_weight_kg: null,
      actual_reps: null,
      completed: false,
      note: '',
    };
    const temp: ForgeSessionSet = {
      id: `tmp-${crypto.randomUUID()}`, position: activeExercise.sets.length, set_type: draft.set_type,
      target_weight_kg: draft.target_weight_kg ?? null, target_reps: draft.target_reps ?? null,
      actual_weight_kg: null, actual_reps: null, coach_suggested_weight_kg: null, coach_suggested_reps: null, completed: false, note: '',
    };
    patchExercise(activeExercise.id, (exercise) => ({ ...exercise, sets: [...exercise.sets, temp] }));
    haptic(6);
    enqueue(() => addForgeSessionSet(current.id, activeExercise.id, draft), 'Satz konnte nicht hinzugefügt werden.').catch(() => undefined);
  };

  const deleteSet = (set: ForgeSessionSet) => {
    const exercise = exerciseOfSet(set.id);
    if (!exercise) return;
    if (exercise.sets.length <= 1) { showToast('Eine Übung braucht mindestens einen Satz.'); return; }
    // Only one undo at a time: an older pending deletion is committed now.
    Object.keys(pendingDeletes.current).forEach((setId) => { void commitDelete(setId); });
    const index = exercise.sets.findIndex((item) => item.id === set.id);
    patchExercise(exercise.id, (local) => ({ ...local, sets: renumber(local.sets.filter((item) => item.id !== set.id)) }));
    if (setTimers.current[set.id]) { clearTimeout(setTimers.current[set.id]); delete setTimers.current[set.id]; }
    pendingDeletes.current[set.id] = { set, exerciseId: exercise.id, index, timer: setTimeout(() => { void commitDelete(set.id); }, UNDO_WINDOW) };
    setUndo({ setId: set.id });
  };

  const undoDelete = () => {
    if (!undo) return;
    const pending = pendingDeletes.current[undo.setId];
    setUndo(null);
    if (!pending) return;
    clearTimeout(pending.timer);
    delete pendingDeletes.current[undo.setId];
    patchExercise(pending.exerciseId, (exercise) => {
      const sets = [...exercise.sets];
      sets.splice(Math.min(pending.index, sets.length), 0, pending.set);
      return { ...exercise, sets: renumber(sets) };
    });
    haptic(6);
  };

  // ── exercise actions ───────────────────────────────────────────
  const markBusy = (exerciseId: string, busy: boolean) => setBusyExerciseIds((ids) => (busy ? [...ids, exerciseId] : ids.filter((id) => id !== exerciseId)));

  const onNoteChange = (exerciseId: string, value: string) => {
    patchExercise(exerciseId, { session_note: value });
    if (noteTimers.current[exerciseId]) clearTimeout(noteTimers.current[exerciseId]);
    noteTimers.current[exerciseId] = setTimeout(() => { void flushNote(exerciseId); }, NOTE_SAVE_DELAY);
  };

  const addExercise = (exercise: ForgeExercise) => {
    const current = sessionRef.current;
    if (!current) return;
    setAddOpen(false);
    showToast(`${exercise.name} wird hinzugefügt…`);
    const knownIds = new Set(current.exercises.map((item) => item.id));
    flushLocal();
    enqueue(() => addForgeSessionExercise(current.id, {
      exercise_id: exercise.id, machine_profile_id: null, notes: '',
      sets: Array.from({ length: 3 }, () => ({ set_type: 'working' as const, target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null, completed: false, note: '' })),
    }), 'Übung konnte nicht hinzugefügt werden.').then(() => {
      const index = sessionRef.current?.exercises.findIndex((item) => !knownIds.has(item.id)) ?? -1;
      if (index >= 0) { setSlide('left'); setActiveIndex(index); setActiveSetId(null); }
      setToast(null);
    }).catch(() => undefined);
  };

  const replaceExercise = (exerciseId: string, replacement: ForgeExercise) => {
    const current = sessionRef.current;
    if (!current) return;
    setReplaceForId(null);
    markBusy(exerciseId, true);
    haptic(10);
    flushLocal();
    enqueue(() => replaceForgeSessionExercise(current.id, exerciseId, replacement.id), 'Übung konnte nicht ersetzt werden.')
      .catch(() => undefined)
      .finally(() => markBusy(exerciseId, false));
  };

  const removeExercise = () => {
    const current = sessionRef.current;
    if (!current || !activeExercise) return;
    const exerciseId = activeExercise.id;
    setConfirm(null);
    updateLocal((local) => ({ ...local, exercises: local.exercises.filter((item) => item.id !== exerciseId).map((item, position) => ({ ...item, position })) }));
    haptic(15);
    enqueue(() => deleteForgeSessionExercise(current.id, exerciseId), 'Übung konnte nicht entfernt werden.').catch(() => undefined);
  };

  const moveExercise = (from: number, to: number) => {
    const current = sessionRef.current;
    if (!current || to < 0 || to >= current.exercises.length) return;
    const ordered = [...current.exercises];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const activeId = current.exercises[activeIndex]?.id;
    commitSession({ ...current, exercises: ordered.map((item, position) => ({ ...item, position })) });
    setActiveIndex(Math.max(0, ordered.findIndex((item) => item.id === activeId)));
    haptic(6);
    enqueue(() => reorderForgeSessionExercises(current.id, ordered.map((item) => item.id)), 'Reihenfolge konnte nicht gespeichert werden.').catch(() => undefined);
  };

  const selectProfile = (profileId: string) => {
    const current = sessionRef.current;
    if (!current || !activeExercise || activeExercise.machine_profile_id === profileId) { setProfileSheetOpen(false); return; }
    const exerciseId = activeExercise.id;
    setProfileSheetOpen(false);
    markBusy(exerciseId, true);
    flushLocal();
    enqueue(() => updateForgeSessionExercise(current.id, exerciseId, { machine_profile_id: profileId }), 'Geräteprofil konnte nicht gewechselt werden.')
      .catch(() => undefined)
      .finally(() => markBusy(exerciseId, false));
  };

  // ── chat ───────────────────────────────────────────────────────
  const sendChat = (message: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const tempId = `tmp-${crypto.randomUUID()}`;
    updateLocal((local) => ({ ...local, messages: [...local.messages, { id: tempId, role: 'user', content: message, proposed_action: null, action_status: null, created_at: new Date().toISOString() }] }));
    setChatSending(true);
    // The agent may take a while; it runs outside the write queue so sets stay instant.
    sendForgeSessionChat(current.id, message)
      .then((server) => updateLocal((local) => ({ ...local, messages: server.messages })))
      .catch((caught: unknown) => {
        updateLocal((local) => ({ ...local, messages: local.messages.filter((item) => item.id !== tempId) }));
        showToast(errorMessage(caught, 'Der Coach ist gerade nicht erreichbar.'));
      })
      .finally(() => setChatSending(false));
  };

  const applyAction = (messageId: string) => {
    const current = sessionRef.current;
    if (!current) return;
    setApplyingId(messageId);
    // Pending edits go first so the proposal is applied to what the user actually logged.
    flushLocal();
    enqueue(() => applyForgeSessionAction(current.id, messageId), 'Vorschlag konnte nicht übernommen werden.')
      .then(() => haptic(12))
      .catch(() => undefined)
      .finally(() => setApplyingId(null));
  };

  const dismissAction = (messageId: string) => {
    const current = sessionRef.current;
    if (!current) return;
    updateLocal((local) => ({ ...local, messages: local.messages.map((item) => (item.id === messageId ? { ...item, action_status: 'dismissed' } : item)) }));
    enqueue(() => dismissForgeSessionAction(current.id, messageId)).catch(() => undefined);
  };

  // ── completion ─────────────────────────────────────────────────
  const requestReview = useCallback((id: string) => {
    setReviewing(true); setReviewError(null);
    generateForgeSessionCompletionReview(id)
      .then((server) => updateLocal((local) => ({ ...local, completion_review: server.completion_review })))
      .catch((caught: unknown) => setReviewError(errorMessage(caught, 'Das Fazit konnte gerade nicht erstellt werden.')))
      .finally(() => setReviewing(false));
  }, [updateLocal]);

  const startCompletion = async () => {
    if (!session || checkingCompletion) return;
    setCheckingCompletion(true);
    try {
      await flushAll();
      const changes = await getForgeSessionPlanChanges(session.id);
      if (changes.has_changes) setCompletionChanges(changes);
      else setConfirm('complete');
    } catch (caught: unknown) {
      showToast(errorMessage(caught, 'Planänderungen konnten nicht geprüft werden.'));
    } finally {
      setCheckingCompletion(false);
    }
  };

  const complete = async (applyPlanChanges: boolean) => {
    const current = sessionRef.current;
    if (!current) return;
    setCompleting(true); setConfirm(null);
    try {
      await flushAll();
      const server = await enqueue(() => completeForgeSession(current.id, applyPlanChanges), 'Session konnte nicht abgeschlossen werden.');
      commitSession(server);
      setCompletionChanges(null);
      haptic([20, 60, 20, 60, 40]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      requestReview(server.id);
    } catch { /* toast already shown */ } finally {
      setCompleting(false);
    }
  };

  const discard = async () => {
    const current = sessionRef.current;
    if (!current) return;
    setConfirm(null);
    Object.values(setTimers.current).forEach(clearTimeout); setTimers.current = {};
    Object.values(noteTimers.current).forEach(clearTimeout); noteTimers.current = {};
    Object.values(pendingDeletes.current).forEach((pending) => clearTimeout(pending.timer)); pendingDeletes.current = {};
    try {
      await mutationQueue.current;
      await deleteForgeSession(current.id);
      sessionRef.current = null;
      navigate('/dashboard');
    } catch (caught: unknown) {
      showToast(errorMessage(caught, 'Session konnte nicht verworfen werden.'));
    }
  };

  const leave = async () => {
    await flushAll();
    navigate('/dashboard');
  };

  // ── render ─────────────────────────────────────────────────────
  if (loading) return <ForgeSessionLoader preparing={preparing} progress={coachingProgress} />;
  if (!session) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{toast || 'Session nicht gefunden.'}</div>;

  const active = session.status === 'active';
  const allSets = session.exercises.flatMap((exercise) => exercise.sets);
  const completedSets = allSets.filter((set) => set.completed).length;
  const progress = allSets.length ? completedSets / allSets.length : 0;
  const decision = activeExercise ? coachDecisionFor(session, activeExercise) : null;
  const exerciseBusy = activeExercise ? busyExerciseIds.includes(activeExercise.id) : false;
  const exerciseCoaching = activeExercise ? coachingIds.includes(activeExercise.id) : false;
  const coachingError = activeExercise ? coachingErrors[activeExercise.id] : undefined;
  const canPickProfile = Boolean(activeExercise?.source_exercise_id && (activeExercise.equipment === 'machine' || activeExercise.equipment === 'cable'));
  const nextExercise = session.exercises[activeIndex + 1];
  const replaceTarget = session.exercises.find((exercise) => exercise.id === replaceForId) ?? null;
  const replaceOptions = replaceTarget
    ? [...library].filter((item) => item.id !== replaceTarget.source_exercise_id).sort((a, b) => Number(b.primary_muscle_group === replaceTarget.primary_muscle_group) - Number(a.primary_muscle_group === replaceTarget.primary_muscle_group))
    : [];
  const setLabels = activeExercise
    ? activeExercise.sets.map((_set, index) => String(activeExercise.sets.slice(0, index + 1).filter((item) => item.set_type === 'working').length || ''))
    : [];

  return <div className="space-y-4 pb-24">
    {/* ── header ── */}
    <header className="forge-anim">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void leave()} aria-label="Zurück zum Dashboard" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><ArrowLeft size={19} /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{active ? 'Live Session' : 'Abgeschlossen'}</p>
          <h1 className="truncate text-[20px] font-semibold tracking-tight" style={{ color: TEXT }}>{session.name}</h1>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-semibold tabular-nums" style={{ color: TEXT }} aria-label="Trainingsdauer">{formatClock(session.started_at, session.completed_at, now)}</p>
          <p className="text-[11px] tabular-nums" style={{ color: DIM }}>{completedSets}/{allSets.length} Sätze</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,247,235,0.07)' }} role="progressbar" aria-valuemin={0} aria-valuemax={allSets.length} aria-valuenow={completedSets} aria-label="Fortschritt">
        <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: `linear-gradient(90deg, ${SAND}, #f3d9a8)`, transition: 'width 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }} />
      </div>
      {active && <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setConfirm('discard')} className="tap h-11 rounded-xl px-4 text-[13px]" style={{ color: DIM, border: `1px solid ${BORDER}` }}>Verwerfen</button>
        <button type="button" onClick={() => void startCompletion()} disabled={checkingCompletion || completing} className="tap flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold disabled:opacity-60" style={{ color: '#16130f', background: SAND }}>{(checkingCompletion || completing) && <Loader2 size={15} className="animate-spin" />}Training beenden</button>
      </div>}
    </header>

    {!active && <CompletionSummary session={session} reviewing={reviewing} reviewError={reviewError} onRetry={() => requestReview(session.id)} onDone={() => navigate('/dashboard')} />}

    {active && startCoachingError && !session.start_coaching && <div className="forge-msg-in flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
      <p className="flex-1 text-[12px]" style={{ color: '#fca5a5' }}>{startCoachingError}</p>
      <button type="button" onClick={() => void prepareCoaching(session.id)} disabled={preparing} className="tap flex h-10 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium" style={{ color: SAND, border: `1px solid ${SAND}44` }}>{preparing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Erneut</button>
    </div>}

    {/* ── exercise navigation ── */}
    {activeExercise ? <>
      <nav className="flex items-center gap-2" aria-label="Übungen">
        <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Vorherige Übung" className="tap flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-25" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ChevronLeft size={22} /></button>
        <button type="button" onClick={() => setOverviewOpen(true)} className="tap flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13px]" style={{ color: TEXT, background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
          <ListOrdered size={15} style={{ color: SAND }} />Übung {activeIndex + 1} von {session.exercises.length}
          <span className="ml-1 flex gap-1" aria-hidden="true">{session.exercises.map((exercise, index) => <span key={exercise.id} className="h-1.5 rounded-full" style={{ width: index === activeIndex ? 14 : 6, background: exerciseDone(exercise) ? SAND : index === activeIndex ? 'rgba(232,197,138,0.7)' : 'rgba(255,247,235,0.15)', transition: 'all 0.25s' }} />)}</span>
        </button>
        <button type="button" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex >= session.exercises.length - 1} aria-label="Nächste Übung" className="tap flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-25" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ChevronRight size={22} /></button>
      </nav>

      <section key={activeExercise.id} className={`card-forge overflow-hidden ${slide === 'left' ? 'forge-slide-left' : slide === 'right' ? 'forge-slide-right' : 'forge-anim'}`} style={{ borderColor: `${SAND}26` }}>
        <div className="flex items-start gap-3 p-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[21px] font-semibold leading-tight" style={{ color: TEXT }}>{activeExercise.name}</h2>
            {canPickProfile ? <button type="button" disabled={!active || exerciseBusy} onClick={() => setProfileSheetOpen(true)} className="tap mt-1.5 flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium disabled:opacity-60" style={{ color: SAND, background: 'rgba(232,197,138,0.08)', border: `1px solid ${SAND}33` }}>
              {exerciseBusy && <Loader2 size={12} className="animate-spin" />}{activeExercise.machine_profile_name ?? (profileOptions.length ? 'Gerät wählen' : 'Kein Geräteprofil')}<ChevronDown size={13} />
            </button> : <p className="mt-1 text-[12px]" style={{ color: DIM }}>{activeExercise.primary_muscle_group}</p>}
          </div>
          {active && <button type="button" onClick={() => setMenuOpen(true)} aria-label="Übungsoptionen" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><MoreHorizontal size={20} /></button>}
        </div>

        {(decision || exerciseCoaching || coachingError) && <aside className="forge-coach-detail mx-4 mb-3 rounded-2xl p-3.5" style={{ background: 'rgba(232,197,138,0.075)', border: `1px solid ${SAND}33` }} aria-live="polite">
          <div className="flex items-start gap-2.5">
            <BrainCircuit className="mt-0.5 shrink-0" size={16} style={{ color: SAND }} />
            {exerciseCoaching ? <div className="flex-1 space-y-1.5" aria-label="Coach plant diese Übung"><div className="forge-skeleton h-3 w-11/12 rounded" /><div className="forge-skeleton h-3 w-3/4 rounded" /><p className="pt-0.5 text-[11px]" style={{ color: DIM }}>Coach plant diese Übung…</p></div>
              : coachingError ? <div className="flex flex-1 items-center gap-2"><p className="flex-1 text-[12px]" style={{ color: DIM }}>{coachingError}</p><button type="button" onClick={() => retryCoaching(activeExercise.id)} className="tap flex h-9 items-center gap-1 rounded-lg px-2.5 text-[11px]" style={{ color: SAND }}><RefreshCw size={13} />Erneut</button></div>
                : <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.85)' }}>{decision}</p>}
          </div>
        </aside>}

        <div className="grid items-center gap-1.5 px-[21px] pb-1.5 text-[10px] uppercase tracking-wider" style={{ gridTemplateColumns: SET_ROW_COLUMNS, color: 'rgba(242,236,226,0.35)' }}>
          <span>Satz</span><span className="text-center">kg</span><span className="text-center">Wdh.</span><span />
        </div>
        <div className="space-y-1.5 px-3">
          {activeExercise.sets.map((set, index) => {
            return <SetRow
              key={set.id}
              set={set}
              label={setLabels[index]}
              exercise={activeExercise}
              active={expandedSetId === set.id}
              readOnly={!active || exerciseBusy}
              pending={isTempId(set.id)}
              justChecked={justCheckedId === set.id}
              weightDraft={weightDrafts[set.id]}
              onActivate={() => setActiveSetId(set.id)}
              onWeightInput={(raw) => onWeightInput(set, raw)}
              onWeightPick={(value) => onWeightPick(set, value)}
              onWeightBlur={() => onWeightBlur(set)}
              onReps={(value) => onReps(set, value)}
              onToggle={() => toggleSet(set)}
              onDelete={() => deleteSet(set)}
              onToggleType={() => toggleSetType(set)}
            />;
          })}
        </div>

        {active && <div className="px-3 pt-2">
          <button type="button" onClick={addSet} disabled={exerciseBusy} className="tap flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium disabled:opacity-50" style={{ color: SAND, border: `1px dashed ${SAND}55` }}><Plus size={16} />Satz hinzufügen</button>
          <p className="mt-1.5 text-center text-[10.5px]" style={{ color: 'rgba(242,236,226,0.32)' }}>Graue Werte sind das Coach-Ziel · nach links wischen zum Löschen · W/Nummer tippen zum Umschalten</p>
        </div>}

        {active && exerciseDone(activeExercise) && nextExercise && <div className="forge-msg-in px-3 pt-3">
          <button type="button" onClick={() => goTo(activeIndex + 1)} className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold" style={{ color: '#16130f', background: SAND }}>Weiter: {nextExercise.name}<ArrowRight size={17} /></button>
        </div>}

        <div className="p-3 pt-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium" style={{ color: DIM }}>Notiz zur Übung</span>
            <textarea
              value={activeExercise.session_note ?? ''}
              disabled={!active}
              rows={2}
              maxLength={2000}
              onChange={(event) => onNoteChange(activeExercise.id, event.target.value)}
              onBlur={() => { if (noteTimers.current[activeExercise.id]) void flushNote(activeExercise.id); }}
              placeholder="z. B. Schulter zwickt, Form unsauber, Gerät besetzt…"
              className="input-forge min-h-[64px] resize-y text-[13.5px] leading-relaxed"
            />
          </label>
          <p className="mt-1 text-[10.5px]" style={{ color: 'rgba(242,236,226,0.32)' }}>Der Coach sieht diese Notiz bei künftigen Vorschlägen.</p>
        </div>

        {activeExercise.source_exercise_id && <div className="px-3 pb-3">
          <ExerciseStatsCard exerciseId={activeExercise.source_exercise_id} machineProfileId={activeExercise.machine_profile_id} todaySets={activeExercise.sets} />
        </div>}
      </section>
    </> : <div className="card-forge p-6 text-center text-[13px]" style={{ color: DIM }}>Diese Session hat noch keine Übungen.</div>}

    {active && <button type="button" onClick={() => setAddOpen(true)} className="card-forge tap flex h-12 w-full items-center justify-center gap-2 text-[13px] font-medium" style={{ color: SAND }}><CirclePlus size={16} />Übung hinzufügen</button>}

    {/* ── floating coach ── */}
    {active && <button type="button" onClick={() => setChatOpen(true)} className="forge-fab tap fixed bottom-[84px] right-4 z-30 flex h-14 items-center gap-2 rounded-full pl-4 pr-5 text-[14px] font-semibold" style={{ color: '#16130f', background: SAND }} aria-label="Session-Coach öffnen">
      {chatSending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}Coach
    </button>}

    {/* ── toasts ── */}
    {(undo || toast) && <div className="pointer-events-none fixed inset-x-0 bottom-[150px] z-40 flex flex-col items-center gap-2 px-4">
      {undo && <div className="forge-toast pointer-events-auto flex items-center gap-3 rounded-2xl py-2 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: `1px solid ${SAND}44` }}>
        Satz gelöscht
        <button type="button" onClick={undoDelete} className="tap flex h-9 items-center gap-1.5 rounded-xl px-3 font-semibold" style={{ color: SAND }}><Undo2 size={15} />Rückgängig</button>
      </div>}
      {toast && <div role="status" className="forge-toast pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl py-2.5 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: '1px solid rgba(248,113,113,0.3)' }}>
        <span className="flex-1">{toast}</span>
        <button type="button" onClick={() => setToast(null)} aria-label="Hinweis schließen" className="tap flex h-8 w-8 items-center justify-center rounded-full" style={{ color: DIM }}><X size={15} /></button>
      </div>}
    </div>}

    {/* ── sheets & dialogs ── */}
    {briefOpen && session.start_coaching && <ForgeSheet label="Coach-Briefing" onClose={closeBrief}>
      <div className="forge-coach-brief space-y-4 p-1">
        <div className="flex items-center gap-2.5"><span className="forge-coach-spark"><Sparkles size={16} /></span><p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}>Dein Coach für heute</p></div>
        <div>
          <h2 className="text-[20px] font-semibold leading-snug" style={{ color: TEXT }}>{session.start_coaching.headline}</h2>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.78)' }}>{session.start_coaching.session_focus}</p>
        </div>
        <button type="button" onClick={closeBrief} className="btn-forge h-12 w-full text-[14px]">Los geht's</button>
      </div>
    </ForgeSheet>}

    {menuOpen && activeExercise && <ForgeSheet label="Übungsoptionen" onClose={() => setMenuOpen(false)}>
      <p className="px-1 pb-3 text-[15px] font-semibold" style={{ color: TEXT }}>{activeExercise.name}</p>
      <div className="space-y-1.5">
        {[
          { icon: <Replace size={18} />, label: 'Übung ersetzen', hint: 'Satzstruktur bleibt, der Coach plant neu', onClick: () => { setMenuOpen(false); setReplaceForId(activeExercise.id); } },
          { icon: <ListOrdered size={18} />, label: 'Reihenfolge ändern', hint: 'Alle Übungen im Überblick', onClick: () => { setMenuOpen(false); setOverviewOpen(true); } },
          { icon: <Trash2 size={18} />, label: 'Aus Session entfernen', hint: 'Eingetragene Sätze dieser Übung gehen verloren', danger: true, onClick: () => { setMenuOpen(false); setConfirm('remove-exercise'); } },
        ].map((item) => <button key={item.label} type="button" onClick={item.onClick} className="tap flex w-full items-center gap-3 rounded-2xl p-3.5 text-left" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}`, color: item.danger ? '#fca5a5' : TEXT }}>
          <span style={{ color: item.danger ? '#f87171' : SAND }}>{item.icon}</span>
          <span><span className="block text-[14px] font-medium">{item.label}</span><span className="mt-0.5 block text-[11px]" style={{ color: DIM }}>{item.hint}</span></span>
        </button>)}
      </div>
    </ForgeSheet>}

    {profileSheetOpen && activeExercise && <ForgeSheet label="Geräteprofil wählen" onClose={() => setProfileSheetOpen(false)}>
      <p className="px-1 pb-3 text-[15px] font-semibold" style={{ color: TEXT }}>Geräteprofil</p>
      <div className="space-y-1.5" role="listbox" aria-label="Geräteprofile">
        {profileOptions.map((profile) => {
          const selected = profile.id === activeExercise.machine_profile_id;
          return <button key={profile.id} type="button" role="option" aria-selected={selected} onClick={() => selectProfile(profile.id)} className="tap flex w-full items-center justify-between gap-3 rounded-2xl p-3.5 text-left" style={{ background: selected ? 'rgba(232,197,138,0.1)' : 'rgba(255,247,235,0.03)', border: `1px solid ${selected ? `${SAND}66` : BORDER}` }}>
            <span className="min-w-0"><span className="block truncate text-[14px] font-medium" style={{ color: selected ? SAND : TEXT }}>{profile.name}</span><span className="mt-0.5 block truncate text-[11px]" style={{ color: DIM }}>{[profile.model, profile.available_weights_kg.length ? `${profile.available_weights_kg.length} Gewichtsstufen` : null].filter(Boolean).join(' · ') || 'Ohne Gewichtsliste'}</span></span>
          </button>;
        })}
        {!profileOptions.length && <p className="text-[12px]" style={{ color: DIM }}>Noch keine Geräteprofile. Der Coach kann dir eins anlegen.</p>}
      </div>
    </ForgeSheet>}

    {addOpen && <ForgeSheet label="Übung zur Session hinzufügen" onClose={() => setAddOpen(false)}>
      <div className="mb-2 flex justify-end"><button type="button" onClick={() => setAddOpen(false)} aria-label="Auswahl schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={17} /></button></div>
      <ForgeExercisePicker exercises={library} onToggle={addExercise} onCreate={() => navigate(`/forge/exercises/new?returnTo=${encodeURIComponent(`/forge/session/${session.id}`)}`)} title="Zur Session hinzufügen" />
    </ForgeSheet>}

    {replaceTarget && <ForgeSheet label="Übung ersetzen" onClose={() => setReplaceForId(null)}>
      <div className="mb-2 flex items-center justify-between gap-3"><p className="text-[12px]" style={{ color: DIM }}>Ersetzt <span style={{ color: TEXT }}>{replaceTarget.name}</span> · gleiche Muskelgruppe zuerst</p><button type="button" onClick={() => setReplaceForId(null)} aria-label="Ersetzen abbrechen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={17} /></button></div>
      <ForgeExercisePicker exercises={replaceOptions} onToggle={(exercise) => replaceExercise(replaceTarget.id, exercise)} onCreate={() => navigate(`/forge/exercises/new?returnTo=${encodeURIComponent(`/forge/session/${session.id}`)}`)} title="Ersetzen durch" />
    </ForgeSheet>}

    {overviewOpen && <ExerciseOverviewSheet exercises={session.exercises} activeIndex={activeIndex} readOnly={!active} onJump={(index) => { setOverviewOpen(false); goTo(index); }} onMove={moveExercise} onClose={() => setOverviewOpen(false)} />}

    {chatOpen && <SessionCoachSheet session={session} sending={chatSending} applyingId={applyingId} context={activeExercise?.name ?? null} onSend={sendChat} onApply={applyAction} onDismiss={dismissAction} onClose={() => setChatOpen(false)} />}

    {completionChanges && <ForgeSheet label="Änderungen prüfen" closeOnBackdrop={false} onClose={() => { if (!completing) setCompletionChanges(null); }}>
      <div className="p-1">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] uppercase tracking-[0.17em]" style={{ color: SAND }}>Vor dem Abschluss</p><h2 className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>Plan anpassen?</h2><p className="mt-1 text-[12px] leading-relaxed" style={{ color: DIM }}>Diese Strukturänderungen kannst du in den Plan übernehmen. Gewichte und Wiederholungen bleiben in deiner Historie.</p></div>
          <button type="button" onClick={() => setCompletionChanges(null)} disabled={completing} className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM }} aria-label="Prüfung schließen"><X size={17} /></button>
        </div>
        <div className="mt-4 space-y-2">{completionChanges.changes.map((change, index) => <article key={`${change.kind}-${index}`} className="rounded-2xl p-3" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}><p className="text-[13px] font-medium" style={{ color: TEXT }}>{change.label}</p><p className="mt-1 text-[11px] leading-relaxed" style={{ color: DIM }}>{change.detail}</p></article>)}</div>
        <div className="mt-5 space-y-2">
          <button type="button" onClick={() => void complete(true)} disabled={completing || !completionChanges.can_apply} className="btn-forge h-12 w-full disabled:opacity-40">Training speichern & Plan anpassen</button>
          <button type="button" onClick={() => void complete(false)} disabled={completing} className="tap h-12 w-full rounded-xl text-[13px] font-medium" style={{ color: TEXT, border: `1px solid ${BORDER}` }}>{completing ? 'Speichert…' : 'Nur Training speichern'}</button>
          {!completionChanges.can_apply && <p className="text-center text-[11px]" style={{ color: DIM }}>Diese Änderungen können gerade nicht automatisch übernommen werden.</p>}
        </div>
      </div>
    </ForgeSheet>}

    <ConfirmDialog
      open={confirm !== null}
      busy={completing}
      destructive={confirm !== 'complete'}
      title={confirm === 'complete' ? 'Training abschließen?' : confirm === 'remove-exercise' ? 'Übung entfernen?' : 'Session verwerfen?'}
      description={confirm === 'complete' ? 'Alle Eingaben sind gespeichert. Danach schreibt dir dein Coach ein kurzes Fazit.' : confirm === 'remove-exercise' ? `${activeExercise?.name ?? 'Die Übung'} und ihre eingetragenen Sätze werden aus dieser Session entfernt.` : 'Bereits eingetragene Sätze gehen verloren und können nicht wiederhergestellt werden.'}
      confirmLabel={confirm === 'complete' ? 'Abschließen' : confirm === 'remove-exercise' ? 'Entfernen' : 'Verwerfen'}
      onCancel={() => setConfirm(null)}
      onConfirm={() => { if (confirm === 'complete') void complete(false); else if (confirm === 'remove-exercise') removeExercise(); else void discard(); }}
    />
  </div>;
}
