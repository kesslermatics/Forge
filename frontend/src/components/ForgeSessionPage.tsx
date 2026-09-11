import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Clock3, Loader2, MessageSquare, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import {
  addForgeSessionExercise, addForgeSessionSet, applyForgeSessionAction,
  completeForgeSession, deleteForgeSessionExercise, deleteForgeSessionSet, deleteForgeSession,
  dismissForgeSessionAction, generateForgeSessionExerciseAdditionCoaching, generateForgeSessionStartCoaching,
  getForgeExercises, getForgeMachineProfiles, getForgeSession, getForgeSessionPlanChanges, sendForgeSessionChat, updateForgeSessionExercise, updateForgeSessionSet,
} from '../api/api';
import type { ForgeExercise, ForgeMachineProfile, ForgePlanChanges, ForgeSession, ForgeSessionSet, ForgeSessionSetInput, ForgeSessionSetUpdateInput } from '../api/api';
import ForgeSessionLoader from './ForgeSessionLoader';
import ForgeExercisePicker from './ForgeExercisePicker';
import ForgeSheet from './ForgeSheet';
import ConfirmDialog from './ConfirmDialog';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const toCreateInput = (set: ForgeSessionSet, overrides: Partial<ForgeSessionSetInput> = {}): ForgeSessionSetInput => ({
  set_type: set.set_type,
  target_weight_kg: set.target_weight_kg,
  target_reps: set.target_reps,
  actual_weight_kg: set.actual_weight_kg,
  actual_reps: set.actual_reps,
  completed: set.completed,
  note: set.note,
  ...overrides,
});

const toUpdateInput = (set: ForgeSessionSet, overrides: ForgeSessionSetUpdateInput = {}): ForgeSessionSetUpdateInput => ({
  set_type: set.set_type,
  actual_weight_kg: set.actual_weight_kg,
  actual_reps: set.actual_reps,
  completed: set.completed,
  note: set.note,
  ...overrides,
});

const displayLoad = (weight: number | null, reps: number | null, equipment: ForgeExercise['equipment']) => {
  if (weight == null && reps == null) return '—';
  const bodyweight = equipment === 'none';
  const load = weight != null && weight > 0 ? `${weight} kg` : bodyweight ? 'BW' : '—';
  return `${load}${reps != null ? ` × ${reps}` : ''}`;
};

/** Returns undefined while a decimal value is still being typed, e.g. "21,". */
const parseWeightInput = (rawValue: string): number | null | undefined => {
  const value = rawValue.trim();
  if (!value) return null;
  if (/^\d+[.,]$/.test(value)) return undefined;
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatDuration = (startedAt: string, completedAt: string | null) => {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
};

export default function ForgeSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<ForgeSession | null>(null);
  const [library, setLibrary] = useState<ForgeExercise[]>([]);
  const [machineProfiles, setMachineProfiles] = useState<ForgeMachineProfile[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preparingSession, setPreparingSession] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingExerciseId, setAddingExerciseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({});
  const [checkedSetId, setCheckedSetId] = useState<string | null>(null);
  const [openSetMenuId, setOpenSetMenuId] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [analyzingProfileId, setAnalyzingProfileId] = useState<string | null>(null);
  const [celebratingCompletion, setCelebratingCompletion] = useState(false);
  const [sessionActionConfirm, setSessionActionConfirm] = useState<'complete' | 'discard' | null>(null);
  const [completionChanges, setCompletionChanges] = useState<ForgePlanChanges | null>(null);
  const [reviewingCompletion, setReviewingCompletion] = useState(false);
  const sessionRef = useRef<ForgeSession | null>(null);
  const pendingActualChanges = useRef<Record<string, Partial<Pick<ForgeSessionSetInput, 'actual_weight_kg' | 'actual_reps'>>>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightAutosaves = useRef<Record<string, Promise<void>>>({});
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueueSessionMutation = useCallback(<T,>(operation: () => Promise<T>) => {
    const request = mutationQueue.current.then(operation);
    mutationQueue.current = request.then(() => undefined, () => undefined);
    return request;
  }, []);

  const activeExercise = useMemo(() => session?.exercises[activeIndex] ?? null, [session, activeIndex]);
  // One coaching voice per exercise: a live addition has its own decision, otherwise the start briefing applies.
  const activeCoachDecision = useMemo(() => {
    if (!activeExercise) return null;
    if (activeExercise.addition_coaching) return activeExercise.addition_coaching;
    if (!session?.start_coaching) return null;
    return session.start_coaching.exercise_decisions.find((decision) => decision.session_exercise_id === activeExercise.id) ?? null;
  }, [session, activeExercise]);
  const activeEvidence = useMemo(() => {
    if (!activeExercise || !activeCoachDecision) return null;
    const catalog = activeExercise.addition_coaching?.coach_evidence ?? session?.start_coaching?.coach_evidence;
    if (!catalog || catalog.version !== 'v1') return null;
    const exercise = catalog.exercises.find((item) => item.session_exercise_id === activeExercise.id);
    if (!exercise) return null;
    return { catalog, exercise, muscle: catalog.muscles[exercise.primary_muscle] ?? null };
  }, [session, activeExercise, activeCoachDecision]);
  const setSessionSafe = (next: ForgeSession) => {
    sessionRef.current = next;
    setSession(next);
    setActiveIndex((current) => Math.min(current, Math.max(0, next.exercises.length - 1)));
  };

  const flushSetAutosave = useCallback(async (setId: string) => {
    const previousRequest = inFlightAutosaves.current[setId];
    if (previousRequest) await previousRequest;
    const changes = pendingActualChanges.current[setId];
    delete pendingActualChanges.current[setId];
    if (saveTimers.current[setId]) { clearTimeout(saveTimers.current[setId]); delete saveTimers.current[setId]; }
    const currentSession = sessionRef.current;
    const liveSet = currentSession?.exercises.flatMap((exercise) => exercise.sets).find((set) => set.id === setId);
    if (!currentSession || !liveSet || !changes || currentSession.status !== 'active') {
      await inFlightAutosaves.current[setId];
      return;
    }
    const request = (async () => {
      try {
        const savedSession = await enqueueSessionMutation(() => updateForgeSessionSet(currentSession.id, setId, toUpdateInput(liveSet, changes)));
        setSessionSafe(savedSession);
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : 'Satz konnte nicht gespeichert werden.');
        pendingActualChanges.current[setId] = { ...changes, ...pendingActualChanges.current[setId] };
      }
    })();
    inFlightAutosaves.current[setId] = request;
    try { await request; }
    finally { if (inFlightAutosaves.current[setId] === request) delete inFlightAutosaves.current[setId]; }
  }, [enqueueSessionMutation]);

  const scheduleActualSave = useCallback((set: ForgeSessionSet, field: 'actual_weight_kg' | 'actual_reps', rawValue: string) => {
    setActualDrafts((drafts) => ({ ...drafts, [`${set.id}:${field}`]: rawValue }));
    if (saveTimers.current[set.id]) {
      clearTimeout(saveTimers.current[set.id]);
      delete saveTimers.current[set.id];
    }

    const value = field === 'actual_weight_kg'
      ? parseWeightInput(rawValue)
      : rawValue.trim() === '' ? null : Number(rawValue);
    if (value === undefined || (value !== null && !Number.isFinite(value))) {
      const changes = pendingActualChanges.current[set.id];
      if (changes) {
        delete changes[field];
        if (!Object.keys(changes).length) delete pendingActualChanges.current[set.id];
      }
      return;
    }

    pendingActualChanges.current[set.id] = { ...pendingActualChanges.current[set.id], [field]: value };
    saveTimers.current[set.id] = setTimeout(() => { void flushSetAutosave(set.id); }, 600);
  }, [flushSetAutosave]);

  const flushAllSetAutosaves = useCallback(async () => {
    await Promise.all(Object.keys(pendingActualChanges.current).map((setId) => flushSetAutosave(setId)));
    await Promise.all(Object.values(inFlightAutosaves.current));
    if (Object.keys(pendingActualChanges.current).length) throw new Error('Offene Satzeingaben konnten nicht gespeichert werden. Bitte versuche es erneut.');
  }, [flushSetAutosave]);

  useEffect(() => {
    const saveBeforeBackground = () => { void flushAllSetAutosaves(); };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') saveBeforeBackground(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', saveBeforeBackground);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', saveBeforeBackground);
      Object.values(saveTimers.current).forEach(clearTimeout);
      saveBeforeBackground();
    };
  }, [flushAllSetAutosaves]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const loadSession = async () => {
      setLoading(true); setError(null); setPreparingSession(false);
      try {
        const [loadedSession, loadedLibrary, loadedMachineProfiles] = await Promise.all([
          getForgeSession(sessionId),
          getForgeExercises(),
          getForgeMachineProfiles(),
        ]);
        if (!cancelled) {
          setSessionSafe(loadedSession);
          setLibrary(loadedLibrary);
          setMachineProfiles(loadedMachineProfiles);
        }
        const needsCoaching = !loadedSession.start_coaching;
        if (loadedSession.status === 'active' && needsCoaching) {
          setPreparingSession(true);
          try {
            const preparedSession = await generateForgeSessionStartCoaching(sessionId, false);
            if (!cancelled) setSessionSafe(preparedSession);
          } catch (caught: unknown) {
            if (!cancelled) setError(caught instanceof Error ? caught.message : 'Die Forge KI-Prognose konnte nicht erstellt werden.');
          }
        }
      } catch (caught: unknown) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Session konnte nicht geladen werden.');
      } finally {
        if (!cancelled) { setPreparingSession(false); setLoading(false); }
      }
    };
    void loadSession();
    return () => { cancelled = true; };
  }, [sessionId]);

  const mutate = async (operation: () => Promise<ForgeSession>) => {
    setSaving(true); setError(null);
    try {
      await flushAllSetAutosaves();
      setSessionSafe(await enqueueSessionMutation(operation));
    }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Änderung konnte nicht gespeichert werden.'); }
    finally { setSaving(false); }
  };

  const selectMachineProfile = async (profileId: string) => {
    const currentSession = sessionRef.current;
    const currentExercise = currentSession?.exercises[activeIndex];
    if (!currentSession || !currentExercise || currentExercise.machine_profile_id === profileId || analyzingProfileId) return;
    setProfileMenuOpen(false);
    setAnalyzingProfileId(profileId);
    setSaving(true);
    setError(null);
    try {
      await flushAllSetAutosaves();
      const updated = await enqueueSessionMutation(() => updateForgeSessionExercise(
        currentSession.id,
        currentExercise.id,
        { machine_profile_id: profileId },
      ));
      setSessionSafe(updated);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Das Geräteprofil konnte nicht analysiert werden.');
    } finally {
      setAnalyzingProfileId(null);
      setSaving(false);
    }
  };

  const toggleSet = async (set: ForgeSessionSet) => {
    if (!session) return;
    await flushSetAutosave(set.id);
    const liveSet = sessionRef.current?.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === set.id) ?? set;
    const nextCompleted = !liveSet.completed;
    if (nextCompleted) {
      setCheckedSetId(liveSet.id);
      window.setTimeout(() => setCheckedSetId((current) => current === liveSet.id ? null : current), 650);
    }
    await mutate(() => updateForgeSessionSet(session.id, liveSet.id, toUpdateInput(liveSet, {
      completed: nextCompleted,
    })));
  };

  const placeSet = async (set: ForgeSessionSet, setType: ForgeSessionSetInput['set_type'], position: number) => {
    if (!session) return;
    await flushSetAutosave(set.id);
    const liveSet = sessionRef.current?.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === set.id) ?? set;
    setOpenSetMenuId(null);
    await mutate(() => updateForgeSessionSet(session.id, liveSet.id, { ...toUpdateInput(liveSet, { set_type: setType }), position }));
  };

  const addSet = () => {
    if (!session || !activeExercise) return;
    const last = activeExercise.sets[activeExercise.sets.length - 1];
    const draft: ForgeSessionSetInput = last ? toCreateInput(last, { completed: false, actual_weight_kg: null, actual_reps: null }) : {
      set_type: 'working', target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null,
      completed: false, note: '',
    };
    void mutate(() => addForgeSessionSet(session.id, activeExercise.id, draft));
  };

  const addExercise = async (exercise: ForgeExercise) => {
    if (!session || addingExerciseId) return;
    setAddingExerciseId(exercise.id); setSaving(true); setError(null);
    try {
      await flushAllSetAutosaves();
      const addedSession = await enqueueSessionMutation(() => addForgeSessionExercise(session.id, {
        exercise_id: exercise.id,
        machine_profile_id: null,
        notes: '',
        sets: [{ set_type: 'working', target_weight_kg: null, target_reps: 10, actual_weight_kg: null, actual_reps: null, completed: false, note: '' }],
      }));
      const addedExercise = addedSession.exercises.at(-1);
      let coachedSession = addedSession;
      if (addedExercise) {
        try {
          coachedSession = await enqueueSessionMutation(() => generateForgeSessionExerciseAdditionCoaching(addedSession.id, addedExercise.id));
        } catch (caught: unknown) {
          setError(caught instanceof Error ? `Übung wurde angelegt. ${caught.message}` : 'Übung wurde angelegt; das zusätzliche Coaching ist gerade nicht verfügbar.');
        }
      }
      setSessionSafe(coachedSession);
      setActiveIndex(Math.max(0, coachedSession.exercises.length - 1));
      setAddOpen(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Übung konnte nicht hinzugefügt werden.');
    } finally {
      setAddingExerciseId(null); setSaving(false);
    }
  };

  const sendChat = async () => {
    if (!session || !chatInput.trim()) return;
    const message = chatInput.trim(); setChatInput('');
    await mutate(() => sendForgeSessionChat(session.id, message));
  };

  const reviewCompletion = async () => {
    if (!session || reviewingCompletion) return;
    setReviewingCompletion(true); setError(null);
    try {
      await flushAllSetAutosaves();
      const changes = await getForgeSessionPlanChanges(session.id);
      if (changes.has_changes) setCompletionChanges(changes);
      else setSessionActionConfirm('complete');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Planänderungen konnten nicht geprüft werden.');
    } finally { setReviewingCompletion(false); }
  };

  const complete = async (applyPlanChanges: boolean) => {
    if (!session) return;
    setSaving(true); setError(null);
    try {
      await flushAllSetAutosaves();
      setSessionSafe(await enqueueSessionMutation(() => completeForgeSession(session.id, applyPlanChanges)));
      setCompletionChanges(null);
      setCelebratingCompletion(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Session konnte nicht abgeschlossen werden.');
    } finally { setSaving(false); }
  };

  const leaveSession = async () => {
    setSaving(true); setError(null);
    try {
      await flushAllSetAutosaves();
      navigate('/dashboard');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Eingaben konnten vor dem Verlassen nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    if (!session) return;
    setSaving(true); setError(null);
    try {
      await flushAllSetAutosaves();
      await enqueueSessionMutation(() => deleteForgeSession(session.id));
      sessionRef.current = null;
      navigate('/dashboard');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Session konnte nicht verworfen werden.');
      setSaving(false);
    }
  };

  if (loading) return <ForgeSessionLoader preparing={preparingSession} />;
  if (!session || error && !session) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error || 'Session nicht gefunden.'}</div>;

  const completedSets = session.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.completed).length;
  const totalSets = session.exercises.flatMap((exercise) => exercise.sets).length;
  const activeLibraryExercise = library.find((exercise) => exercise.id === activeExercise?.source_exercise_id) ?? null;
  const activeEquipment = activeLibraryExercise?.equipment ?? activeExercise?.equipment;
  const canSelectMachineProfile = Boolean(activeExercise?.source_exercise_id && (activeEquipment === 'machine' || activeEquipment === 'cable'));
  const allMachineProfiles = [...machineProfiles, ...(activeLibraryExercise?.available_machine_profiles ?? []), ...(activeLibraryExercise?.machine_profiles ?? [])];
  const selectableMachineProfiles = allMachineProfiles.filter((profile, index) => allMachineProfiles.findIndex((candidate) => candidate.id === profile.id) === index);
  const selectedMachineProfile = selectableMachineProfiles.find((profile) => profile.id === activeExercise?.machine_profile_id) ?? activeExercise?.machine_profile_snapshot ?? null;
  const analyzingMachineProfile = selectableMachineProfiles.find((profile) => profile.id === analyzingProfileId) ?? null;
  const duration = formatDuration(session.started_at, session.completed_at);

  return <div className="space-y-4 forge-anim">
    <header className="flex items-start justify-between gap-3">
      <div className="flex gap-3"><button onClick={() => void leaveSession()} disabled={saving} className="tap mt-1 cursor-pointer disabled:cursor-default disabled:opacity-50" style={{ color: DIM }} aria-label="Zurück zum Dashboard"><ArrowLeft size={18} /></button><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{session.status === 'active' ? 'Live Session' : 'Abgeschlossen'}</p><h1 className="text-[22px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>{session.name}</h1><p className="text-[11px] mt-1" style={{ color: DIM }}>{completedSets}/{totalSets} Sätze abgeschlossen · {duration}</p></div></div>
      {session.status === 'active' && <div className="flex items-center gap-3"><button onClick={() => setSessionActionConfirm('discard')} disabled={saving} className="tap text-[11px] cursor-pointer" style={{ color: DIM }}>Verwerfen</button><button onClick={() => void reviewCompletion()} disabled={saving || reviewingCompletion} className="tap flex items-center gap-1 text-[11px] font-medium cursor-pointer" style={{ color: SAND }}>{reviewingCompletion && <Loader2 size={12} className="animate-spin" />}Beenden</button></div>}
    </header>
    {session.start_coaching?.coaching_source === 'ai' && <section className="forge-coach-brief card-forge p-5" style={{ borderColor: `${SAND}40`, background: 'linear-gradient(135deg, rgba(232,197,138,0.13), rgba(255,247,235,0.025))' }}>
      <div className="flex items-start gap-3"><div className="forge-coach-spark"><Sparkles size={17} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}>Forge KI-Coach</p><span className="rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider" style={{ color: SAND, background: `${SAND}14` }}>KI-Analyse</span></div><h2 className="mt-1 text-[17px] font-semibold" style={{ color: TEXT }}>{session.start_coaching.headline}</h2><p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.78)' }}>{session.start_coaching.session_focus}</p></div></div>
    </section>}
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    {session.status === 'completed' && <section className={`card-forge p-5 flex items-center gap-4 ${celebratingCompletion ? 'forge-session-complete' : ''}`} style={{ borderColor: `${SAND}44`, background: 'rgba(232,197,138,0.08)' }}><div className={`forge-completion-mark ${celebratingCompletion ? 'forge-completion-bloom' : ''}`}><Check size={22} /></div><div><p className="text-[15px] font-semibold" style={{ color: TEXT }}>Stark gemacht.</p><p className="text-[12px] mt-1" style={{ color: DIM }}>{completedSets} von {totalSets} Sätzen · Dauer {duration}</p></div><Clock3 className="ml-auto" size={18} style={{ color: SAND }} /></section>}

    {activeExercise ? <>
      <div className="flex items-center justify-between gap-3"><button onClick={() => setActiveIndex((index) => Math.max(0, index - 1))} disabled={activeIndex === 0} className="tap cursor-pointer disabled:opacity-20" style={{ color: SAND }}><ChevronLeft size={20} /></button><p className="text-[11px]" style={{ color: DIM }}>Übung {activeIndex + 1} von {session.exercises.length}</p><button onClick={() => setActiveIndex((index) => Math.min(session.exercises.length - 1, index + 1))} disabled={activeIndex >= session.exercises.length - 1} className="tap cursor-pointer disabled:opacity-20" style={{ color: SAND }}><ChevronRight size={20} /></button></div>
      <section className="card-forge overflow-hidden" style={{ borderColor: `${SAND}22` }}>
        <div className="p-5 flex items-start justify-between gap-3"><div><h2 className="text-[20px] font-semibold" style={{ color: TEXT }}>{activeExercise.name}</h2>{canSelectMachineProfile ? <div className="relative mt-1"><button type="button" disabled={session.status !== 'active' || saving || selectableMachineProfiles.length === 0} onClick={() => setProfileMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={profileMenuOpen} className="tap flex items-center gap-1.5 text-[11px] font-medium cursor-pointer disabled:cursor-default disabled:opacity-60" style={{ color: SAND }}>{selectedMachineProfile ? `${selectedMachineProfile.name}${selectedMachineProfile.model ? ` · ${selectedMachineProfile.model}` : ''}` : selectableMachineProfiles.length ? 'Gerät wählen' : 'Keine Geräteprofile verfügbar'}<ChevronDown size={13} /></button>{profileMenuOpen && <div role="listbox" className="absolute left-0 top-7 z-30 min-w-64 overflow-hidden rounded-xl p-1 shadow-2xl" style={{ background: '#282116', border: `1px solid ${SAND}55` }}>{selectableMachineProfiles.map((profile) => <button key={profile.id} type="button" role="option" aria-selected={profile.id === activeExercise.machine_profile_id} onClick={() => void selectMachineProfile(profile.id)} className="tap flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] cursor-pointer" style={{ color: profile.id === activeExercise.machine_profile_id ? SAND : TEXT, background: profile.id === activeExercise.machine_profile_id ? 'rgba(232,197,138,0.12)' : 'transparent' }}><span><span className="block font-medium">{profile.name}</span>{profile.model && <span className="mt-0.5 block text-[9px]" style={{ color: DIM }}>{profile.model}</span>}</span>{profile.id === activeExercise.machine_profile_id && <Check size={13} />}</button>)}</div>}</div> : <p className="text-[11px] mt-1" style={{ color: DIM }}>{activeExercise.machine_profile_name || activeExercise.primary_muscle_group}</p>}</div>{session.status === 'active' && <button onClick={() => void mutate(() => deleteForgeSessionExercise(session.id, activeExercise.id))} className="tap cursor-pointer" style={{ color: DIM }}><Trash2 size={16} /></button>}</div>
        {analyzingProfileId && <div className="mx-4 mb-4 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ color: SAND, background: 'rgba(232,197,138,0.09)', border: `1px solid ${SAND}44` }}><Loader2 size={18} className="animate-spin shrink-0" /><div><p className="text-[12px] font-semibold">KI analysiert {analyzingMachineProfile?.name || 'das Geräteprofil'}…</p><p className="mt-0.5 text-[10px]" style={{ color: DIM }}>Warm-up und Arbeitssätze werden isoliert neu prognostiziert.</p></div></div>}
        {activeCoachDecision && <aside className="forge-coach-detail mx-4 mb-4 rounded-2xl p-4" style={{ background: 'rgba(232,197,138,0.075)', border: `1px solid ${SAND}38` }}>
          <div className="flex items-start gap-2.5">
            <BrainCircuit className="mt-0.5 shrink-0" size={16} style={{ color: SAND }} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold" style={{ color: TEXT }}>Coach-Ansage</p>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.78)' }}>{activeCoachDecision.recommendation}</p>
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: TEXT }}><span style={{ color: SAND }}>Erster Satz:</span> {activeCoachDecision.first_set_focus}</p>
              <p className="mt-2 text-[11px] font-semibold" style={{ color: SAND }}>Alle Arbeitssätze bis zum Muskelversagen. Warm-ups nicht.</p>
              {activeEvidence && <div className="mt-3 border-t pt-3" style={{ borderColor: 'rgba(232,197,138,0.16)' }}>
                <button type="button" onClick={() => setWhyOpen((open) => !open)} aria-expanded={whyOpen} className="tap flex w-full items-center justify-between text-left text-[11px] font-medium cursor-pointer" style={{ color: SAND }}><span>Warum diese Prognose?</span><ChevronDown size={13} className={whyOpen ? 'rotate-180' : ''} /></button>
                {whyOpen && <div className="mt-2 space-y-1.5 text-[10px] leading-relaxed" style={{ color: DIM }}>
                  {activeEvidence.exercise.recent_exposures[0]?.sets[0] && <p>Letzter vergleichbarer Satz: {displayLoad(activeEvidence.exercise.recent_exposures[0].sets[0].actual_weight_kg, activeEvidence.exercise.recent_exposures[0].sets[0].actual_reps, activeExercise.equipment)} tatsächlich{activeEvidence.exercise.recent_exposures[0].sets[0].coach_suggested_reps != null ? ` vs. KI-Prognose ${displayLoad(activeEvidence.exercise.recent_exposures[0].sets[0].coach_suggested_weight_kg, activeEvidence.exercise.recent_exposures[0].sets[0].coach_suggested_reps, activeExercise.equipment)}` : ''}.</p>}
                  {activeEvidence.exercise.days_since_same_exposure != null && <p>Exakt gleiche Übung und Profil zuletzt vor {activeEvidence.exercise.days_since_same_exposure} Tagen.</p>}
                  {activeEvidence.muscle && <p>{activeEvidence.exercise.primary_muscle}: {activeEvidence.muscle.direct_sets['7d']} direkte und {activeEvidence.muscle.indirect_sets['7d']} indirekte Arbeitssätze in 7 Tagen · heute die {activeEvidence.muscle.sessions.current_session_ordinal_7d}. Exposition.</p>}
                  <p>Übungsposition {activeEvidence.exercise.position}; Vorermüdung: {activeEvidence.exercise.current_prefatigue.direct_working_sets} direkte und {activeEvidence.exercise.current_prefatigue.indirect_working_sets} indirekte Arbeitssätze davor.</p>
                  {(() => { const trend = activeEvidence.catalog.nutrition.yazio?.rolling?.['14d']; return trend && Number(trend.logged_days ?? 0) >= 4 ? <p>Yazio 14 Tage: {trend.logged_days} protokollierte Tage{trend.average_calories != null ? ` · Ø ${trend.average_calories} kcal` : ''}{trend.average_protein_g != null ? ` · Ø ${trend.average_protein_g} g Protein` : ''}. Nur Hintergrundsignal.</p> : null; })()}
                </div>}
              </div>}
            </div>
          </div>
        </aside>}
        <div className="border-y" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
          <div className="grid px-4 py-2 text-[9px] uppercase tracking-wider" style={{ gridTemplateColumns: '36px 1fr 1fr 32px', color: DIM }}><span>Satz</span><span className="text-center">Ziel</span><span className="text-center">Heute</span><span /></div>
          {activeExercise.sets.map((set, index) => {
            const withoutSet = activeExercise.sets.filter((item) => item.id !== set.id);
            const warmupTargetPosition = withoutSet.filter((item) => item.set_type === 'warmup').length;
            const workingCount = activeExercise.sets.filter((item) => item.set_type === 'working').length + (set.set_type === 'warmup' ? 1 : 0);
            const workingNumber = set.set_type === 'working' ? activeExercise.sets.filter((item) => item.set_type === 'working').findIndex((item) => item.id === set.id) + 1 : 0;
            const menuOpen = openSetMenuId === set.id;
            return <div key={set.id} className={`grid items-center gap-2 px-4 py-3 ${set.completed ? 'forge-set-done' : ''} ${checkedSetId === set.id ? 'forge-set-check' : ''}`} style={{ gridTemplateColumns: '36px 1fr 1fr 32px', background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}>
              <div className="relative"><button onClick={() => setOpenSetMenuId(menuOpen ? null : set.id)} disabled={session.status !== 'active' || saving} aria-expanded={menuOpen} aria-haspopup="menu" className="tap flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-medium cursor-pointer disabled:cursor-default disabled:opacity-70" style={{ color: set.set_type === 'warmup' ? '#16130f' : DIM, background: set.set_type === 'warmup' ? SAND : 'rgba(255,247,235,0.075)', border: `1px solid ${set.set_type === 'warmup' ? SAND : 'rgba(255,247,235,0.08)'}` }}>{set.set_type === 'warmup' ? 'W' : workingNumber}</button>
                {menuOpen && <div role="menu" className="absolute left-0 top-8 z-20 w-34 overflow-hidden rounded-xl p-1 shadow-xl" style={{ background: '#282116', border: `1px solid ${SAND}44` }}>
                  <button role="menuitem" onClick={() => void placeSet(set, 'warmup', warmupTargetPosition)} className="tap flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] cursor-pointer" style={{ color: TEXT, background: set.set_type === 'warmup' ? 'rgba(232,197,138,0.14)' : 'transparent' }}><span className="flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-semibold" style={{ color: '#16130f', background: SAND }}>W</span>Aufwärmen</button>
                  <div className="my-1 h-px" style={{ background: 'rgba(255,247,235,0.08)' }} />
                  {Array.from({ length: workingCount }, (_, workIndex) => <button key={workIndex} role="menuitem" onClick={() => void placeSet(set, 'working', warmupTargetPosition + workIndex)} className="tap flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] cursor-pointer" style={{ color: TEXT, background: set.set_type === 'working' && workingNumber === workIndex + 1 ? 'rgba(232,197,138,0.14)' : 'transparent' }}><span className="flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-semibold" style={{ color: SAND, border: `1px solid ${SAND}66` }}>{workIndex + 1}</span>{workIndex + 1}. Arbeitssatz</button>)}
                </div>}
              </div>
              <span className="text-center text-[12px]" style={{ color: DIM }}>{displayLoad(set.target_weight_kg, set.target_reps, activeExercise.equipment)}</span>
              <div className="grid gap-1" style={{ gridTemplateColumns: '1fr 1fr' }}><input value={actualDrafts[`${set.id}:actual_weight_kg`] ?? (set.actual_weight_kg ?? '')} disabled={session.status !== 'active'} inputMode="decimal" onChange={(event) => scheduleActualSave(set, 'actual_weight_kg', event.target.value)} onBlur={() => void flushSetAutosave(set.id)} placeholder={set.target_weight_kg != null ? `${set.target_weight_kg} kg` : activeExercise.equipment === 'none' ? 'BW' : 'kg'} className="input-forge min-w-0 !px-2 !py-2 text-center text-[11px]" /><input value={actualDrafts[`${set.id}:actual_reps`] ?? (set.actual_reps ?? '')} disabled={session.status !== 'active'} inputMode="numeric" onChange={(event) => scheduleActualSave(set, 'actual_reps', event.target.value)} onBlur={() => void flushSetAutosave(set.id)} placeholder={set.target_reps != null ? `${set.target_reps} Wdh.` : 'Wdh.'} className="input-forge min-w-0 !px-2 !py-2 text-center text-[11px]" /></div>
              {session.status === 'active' ? <button onClick={() => void toggleSet(set)} disabled={saving} className="tap w-7 h-7 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-50" style={{ background: set.completed ? SAND : 'rgba(255,247,235,0.06)', color: set.completed ? '#16130f' : DIM }}><Check size={15} /></button> : <Check size={15} style={{ color: set.completed ? SAND : DIM }} />}
            </div>;
          })}
        </div>
        {session.status === 'active' && <div className="p-3 flex gap-3"><button onClick={addSet} className="tap text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: SAND }}><Plus size={14} />Satz</button>{activeExercise.sets.length > 1 && <button onClick={() => void mutate(() => deleteForgeSessionSet(session.id, activeExercise.sets[activeExercise.sets.length - 1].id))} className="tap text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: DIM }}><Trash2 size={13} />Letzten löschen</button>}</div>}
      </section>
    </> : <div className="card-forge p-6 text-center text-[13px]" style={{ color: DIM }}>Diese Session hat noch keine Übungen.</div>}

    {session.status === 'active' && <button onClick={() => setAddOpen(true)} className="w-full card-forge p-3 flex items-center justify-center gap-2 text-[12px] font-medium tap cursor-pointer" style={{ color: SAND }}><CirclePlus size={15} />Übung hinzufügen</button>}
    {addOpen && <ForgeSheet label="Übung zur Session hinzufügen" onClose={() => setAddOpen(false)}><div><div className="mb-4 flex justify-end"><button onClick={() => setAddOpen(false)} className="tap flex h-8 w-8 items-center justify-center rounded-full" aria-label="Auswahl schließen" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={16} /></button></div><ForgeExercisePicker exercises={library} busyId={addingExerciseId} onToggle={(exercise) => void addExercise(exercise)} onCreate={() => navigate(`/forge/exercises/new?returnTo=${encodeURIComponent(`/forge/session/${session.id}`)}`)} title="Zur Session hinzufügen" /></div></ForgeSheet>}

    <section className="card-forge overflow-hidden" style={{ borderColor: chatOpen ? `${SAND}44` : BORDER }}>
      <button onClick={() => setChatOpen(!chatOpen)} className="w-full p-4 flex items-center justify-between tap cursor-pointer"><span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: TEXT }}><MessageSquare size={16} style={{ color: SAND }} />Rückfrage zu dieser Session</span><span className="text-[11px]" style={{ color: DIM }}>{chatOpen ? 'Einklappen' : 'Fragen'}</span></button>
      {chatOpen && <div className="border-t p-3 space-y-3" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
        {session.messages.length === 0 && <p className="rounded-xl px-3 py-2.5 text-[11px]" style={{ color: DIM, background: 'rgba(232,197,138,0.06)' }}>Maschine besetzt, Schmerzen oder unklarer Plan? Frag mich direkt für diese Session.</p>}
        {session.messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'pl-8' : 'pr-4'}><div className="rounded-2xl px-3 py-2.5 text-[12px] leading-relaxed" style={{ color: message.role === 'user' ? '#16130f' : TEXT, background: message.role === 'user' ? SAND : 'rgba(255,247,235,0.06)' }}>{message.content}</div>{message.proposed_action && <div className="mt-2 rounded-xl p-3" style={{ border: `1px solid ${SAND}44`, background: 'rgba(232,197,138,0.06)' }}><p className="text-[11px] font-medium" style={{ color: SAND }}>{message.proposed_action.title}</p>{message.action_status === 'pending' ? <div className="flex gap-3 mt-2"><button onClick={() => void mutate(() => applyForgeSessionAction(session.id, message.id))} className="text-[11px] font-medium cursor-pointer" style={{ color: SAND }}>Übernehmen</button><button onClick={() => void mutate(() => dismissForgeSessionAction(session.id, message.id))} className="text-[11px] cursor-pointer" style={{ color: DIM }}>Ablehnen</button></div> : <p className="text-[10px] mt-1" style={{ color: DIM }}>{message.action_status === 'applied' ? 'Übernommen' : 'Abgelehnt'}</p>}</div>}</div>)}
        {session.status === 'active' && <div className="flex gap-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendChat(); }} placeholder="z. B. Maschine besetzt – Alternative?" className="input-forge min-w-0 flex-1 text-[12px]" /><button onClick={() => void sendChat()} disabled={saving || !chatInput.trim()} className="tap w-10 rounded-xl flex items-center justify-center cursor-pointer" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button></div>}
      </div>}
    </section>
    {completionChanges && <ForgeSheet label="Änderungen prüfen" closeOnBackdrop={false} onClose={() => { if (!saving) setCompletionChanges(null); }}><div className="p-1"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.17em]" style={{ color: SAND }}>Vor dem Abschluss</p><h2 id="plan-changes-title" className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>Änderungen prüfen</h2><p className="mt-1 text-[11px] leading-relaxed" style={{ color: DIM }}>Deine Session unterscheidet sich vom Trainingstag. Entscheide, ob Forge den Plan aktualisieren soll.</p></div><button onClick={() => setCompletionChanges(null)} disabled={saving} className="tap p-2" style={{ color: DIM }} aria-label="Review schließen"><X size={16} /></button></div><div className="mt-4 space-y-2">{completionChanges.changes.map((change, index) => <article key={`${change.kind}-${index}`} className="rounded-2xl p-3" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}><p className="text-[12px] font-medium" style={{ color: TEXT }}>{change.label}</p><p className="mt-1 text-[10px] leading-relaxed" style={{ color: DIM }}>{change.detail}</p></article>)}</div><div className="mt-5 space-y-2"><button onClick={() => void complete(false)} disabled={saving} className="w-full rounded-xl py-3 text-[12px] font-medium" style={{ color: TEXT, border: `1px solid ${BORDER}` }}>{saving ? 'Speichert…' : 'Nur Training speichern'}</button><button onClick={() => void complete(true)} disabled={saving || !completionChanges.can_apply} className="btn-forge w-full disabled:opacity-40">Änderungen in Plan übernehmen</button>{!completionChanges.can_apply && <p className="text-center text-[10px]" style={{ color: DIM }}>Diese Änderungen können aktuell nicht automatisch übernommen werden.</p>}</div></div></ForgeSheet>}
    <ConfirmDialog open={sessionActionConfirm !== null} busy={saving} destructive={sessionActionConfirm === 'discard'} title={sessionActionConfirm === 'complete' ? 'Training abschließen?' : 'Aktive Session verwerfen?'} description={sessionActionConfirm === 'complete' ? 'Alle Eingaben sind gespeichert. Das Training wird jetzt ohne Planänderungen abgeschlossen.' : 'Bereits eingetragene Sätze gehen verloren und können nicht wiederhergestellt werden.'} confirmLabel={sessionActionConfirm === 'complete' ? 'Training abschließen' : 'Session verwerfen'} onCancel={() => setSessionActionConfirm(null)} onConfirm={() => { const action = sessionActionConfirm; setSessionActionConfirm(null); if (action === 'complete') void complete(false); if (action === 'discard') void discard(); }} />
  </div>;
}
