import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, ChevronDown, Copy, Dumbbell, GripVertical, History, Loader2, MoreHorizontal, Plus,
  Replace, RotateCcw, Sparkles, Trash2, Undo2, X,
} from 'lucide-react';
import { createForgePlan, deleteForgePlan, generateForgePlanEditDraft, getForgeExercises, getForgePlans, updateForgePlan } from '../api/api';
import type { ForgeExercise, ForgePlan, ForgePlanInput, ForgePlanType } from '../api/api';
import ConfirmDialog from './ConfirmDialog';
import ForgePlanImageCard from './ForgePlanImageCard';
import ForgeSheet from './ForgeSheet';
import EquipmentIcon from './forge/EquipmentIcon';
import ExercisePickerSheet from './forge/ExercisePickerSheet';
import SortableList from './forge/SortableList';
import Stepper from './forge/Stepper';
import SwipeToDelete from './forge/SwipeToDelete';
import { requestLeave, setLeaveGuard } from './forge/leaveGuard';
import { estimateMinutes, machineCapable, muscleLabel } from './forge/labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';
const MAX_SETS = 12;
const STORAGE_PREFIX = 'forge-day-draft:';

interface DraftExercise { key: string; exercise_id: string; machine_profile_id: string | null; notes: string; warmups: number; workings: number }
interface Draft { name: string; description: string; plan_type: ForgePlanType; duration: number | null; exercises: DraftExercise[] }

const newKey = () => `k-${crypto.randomUUID()}`;
const emptyDraft = (): Draft => ({ name: '', description: '', plan_type: 'workout', duration: null, exercises: [] });

const fromPlan = (plan: ForgePlan): Draft => ({
  name: plan.name,
  description: plan.description ?? '',
  plan_type: plan.plan_type,
  duration: plan.default_duration_minutes,
  exercises: plan.exercises.map((entry) => ({
    key: entry.id,
    exercise_id: entry.exercise.id,
    machine_profile_id: entry.machine_profile?.id ?? null,
    notes: entry.notes ?? '',
    warmups: entry.sets.filter((set) => set.set_type === 'warmup').length,
    workings: Math.max(1, entry.sets.filter((set) => set.set_type === 'working').length),
  })),
});

/** Plans store structure only: warm-ups first, then working sets, never weights or reps. */
const toInput = (draft: Draft, position: number): ForgePlanInput => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  plan_type: draft.plan_type,
  default_duration_minutes: draft.plan_type === 'course' ? draft.duration : null,
  position,
  exercises: draft.plan_type === 'course' ? [] : draft.exercises.map((entry) => ({
    exercise_id: entry.exercise_id,
    machine_profile_id: entry.machine_profile_id,
    notes: entry.notes.trim() || null,
    sets: [
      ...Array.from({ length: entry.warmups }, () => ({ set_type: 'warmup' as const })),
      ...Array.from({ length: entry.workings }, () => ({ set_type: 'working' as const })),
    ].map((set) => ({ ...set, previous_weight_kg: null, previous_reps: null, current_weight_kg: null, current_reps: null, coach_suggested_weight_kg: null, coach_suggested_reps: null, note: null })),
  })),
});

const comparable = (draft: Draft) => JSON.stringify({
  name: draft.name.trim(), description: draft.description.trim(), plan_type: draft.plan_type, duration: draft.plan_type === 'course' ? draft.duration : null,
  exercises: draft.exercises.map((entry) => [entry.exercise_id, entry.machine_profile_id, entry.notes.trim(), entry.warmups, entry.workings]),
});

export default function ForgeTrainingDayPage() {
  const { planId: rawPlanId } = useParams<{ planId: string }>();
  const planId = rawPlanId && rawPlanId !== 'new' ? rawPlanId : null;
  const navigate = useNavigate();
  const storageKey = `${STORAGE_PREFIX}${planId ?? 'new'}`;

  const [plan, setPlan] = useState<ForgePlan | null>(null);
  const [planCount, setPlanCount] = useState(0);
  const [library, setLibrary] = useState<ForgeExercise[]>([]);
  const [baseline, setBaseline] = useState<Draft>(emptyDraft);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'replace'; key: string } | null>(null);
  const [removed, setRemoved] = useState<{ entry: DraftExercise; index: number } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ summary: string; previous: Draft } | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'course' | null>(null);
  const removedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = useMemo(() => comparable(draft) !== comparable(baseline), [draft, baseline]);
  const byId = useMemo(() => new Map(library.map((exercise) => [exercise.id, exercise])), [library]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getForgePlans(), getForgeExercises()]).then(([plans, exercises]) => {
      if (cancelled) return;
      const loaded = planId ? plans.find((item) => item.id === planId) ?? null : null;
      const fresh = loaded ? fromPlan(loaded) : emptyDraft();
      setPlan(loaded); setPlanCount(plans.length); setLibrary(exercises); setBaseline(fresh);
      // A draft survives the Android back gesture and reloads; it is restored on return.
      const stored = sessionStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) as Draft : null;
      const ids = new Set(exercises.map((item) => item.id));
      if (parsed && comparable(parsed) !== comparable(fresh) && parsed.exercises.every((entry) => ids.has(entry.exercise_id))) {
        setDraft(parsed); setRestored(true);
      } else {
        sessionStorage.removeItem(storageKey); setDraft(fresh); setRestored(false);
      }
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht geladen werden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId, storageKey]);

  useEffect(() => {
    if (loading) return;
    if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft));
    else sessionStorage.removeItem(storageKey);
  }, [dirty, draft, loading, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard((proceed) => setPendingLeave(() => proceed));
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { setLeaveGuard(null); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dirty]);

  const update = useCallback((patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch })), []);
  const updateExercise = (key: string, patch: Partial<DraftExercise>) => setDraft((current) => ({ ...current, exercises: current.exercises.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)) }));

  const removeExercise = (key: string) => {
    const index = draft.exercises.findIndex((entry) => entry.key === key);
    if (index < 0) return;
    setRemoved({ entry: draft.exercises[index], index });
    setDraft((current) => ({ ...current, exercises: current.exercises.filter((entry) => entry.key !== key) }));
    if (expanded === key) setExpanded(null);
    if (removedTimer.current) clearTimeout(removedTimer.current);
    removedTimer.current = setTimeout(() => setRemoved(null), 5000);
  };

  const undoRemove = () => {
    if (!removed) return;
    setDraft((current) => {
      const exercises = [...current.exercises];
      exercises.splice(Math.min(removed.index, exercises.length), 0, removed.entry);
      return { ...current, exercises };
    });
    setRemoved(null);
  };

  const reorder = (from: number, to: number) => setDraft((current) => {
    const exercises = [...current.exercises];
    const [moved] = exercises.splice(from, 1);
    exercises.splice(to, 0, moved);
    return { ...current, exercises };
  });

  const addExercises = (picked: ForgeExercise[]) => {
    setDraft((current) => ({ ...current, exercises: [...current.exercises, ...picked.map((exercise) => ({ key: newKey(), exercise_id: exercise.id, machine_profile_id: null, notes: '', warmups: 0, workings: 3 }))] }));
    setPicker(null);
  };

  const replaceExercise = (key: string, exercise: ForgeExercise) => {
    updateExercise(key, { exercise_id: exercise.id, machine_profile_id: null });
    setPicker(null);
  };

  const setPlanType = (type: ForgePlanType) => {
    if (type === draft.plan_type) return;
    if (type === 'course' && draft.exercises.length) { setConfirm('course'); return; }
    update({ plan_type: type, duration: type === 'course' ? draft.duration ?? 60 : null });
  };

  const save = async () => {
    if (!draft.name.trim()) { setError('Gib dem Trainingstag einen Namen.'); return; }
    if (draft.plan_type === 'course' && !draft.duration) { setError('Gib die Kursdauer an.'); return; }
    if (draft.plan_type === 'workout' && !draft.exercises.length) { setError('Füg mindestens eine Übung hinzu.'); return; }
    setSaving(true); setError(null);
    try {
      const input = toInput(draft, plan?.position ?? planCount);
      const saved = plan ? await updateForgePlan(plan.id, input) : await createForgePlan(input);
      const fresh = fromPlan(saved);
      sessionStorage.removeItem(storageKey);
      setPlan(saved); setBaseline(fresh); setDraft(fresh); setRestored(false); setAiResult(null);
      try { navigator.vibrate?.(12); } catch { /* unsupported */ }
      if (!plan) navigate(`/forge/days/${saved.id}`, { replace: true });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const discard = () => { setDraft(baseline); setRestored(false); setAiResult(null); setError(null); };

  const reworkWithAi = async () => {
    const instructions = aiText.trim();
    if (instructions.length < 3) return;
    setAiBusy(true); setError(null);
    try {
      const { draft: result } = await generateForgePlanEditDraft({
        instructions,
        name: draft.name,
        description: draft.description || null,
        exercises: draft.exercises.map((entry) => ({ exercise_id: entry.exercise_id, machine_profile_id: entry.machine_profile_id, warmup_sets: entry.warmups, working_sets: entry.workings, notes: entry.notes || null })),
      });
      const keys = new Map(draft.exercises.map((entry) => [entry.exercise_id, entry.key]));
      const previous = draft;
      setDraft({
        ...draft,
        name: result.name || draft.name,
        description: result.description ?? '',
        exercises: result.exercises.filter((entry) => byId.has(entry.exercise_id)).map((entry) => ({
          key: keys.get(entry.exercise_id) ?? newKey(),
          exercise_id: entry.exercise_id,
          machine_profile_id: entry.machine_profile_id,
          notes: entry.notes ?? '',
          warmups: entry.warmup_sets,
          workings: entry.working_sets,
        })),
      });
      setAiResult({ summary: result.summary, previous });
      setAiText('');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Die KI konnte den Plan gerade nicht umbauen.');
    } finally { setAiBusy(false); }
  };

  const duplicate = async () => {
    setMenuOpen(false); setSaving(true); setError(null);
    try {
      const copy = await createForgePlan(toInput({ ...draft, name: `${draft.name} (Kopie)`.slice(0, 255) }, planCount));
      navigate(`/forge/days/${copy.id}`);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht dupliziert werden.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await deleteForgePlan(plan.id);
      sessionStorage.removeItem(storageKey);
      setLeaveGuard(null);
      navigate('/forge', { replace: true });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht gelöscht werden.');
      setSaving(false); setConfirm(null);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;
  if (planId && !plan) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: error ? '#fca5a5' : DIM }}>{error || 'Trainingstag nicht gefunden.'}</div>;

  const entries = draft.exercises.filter((entry) => byId.has(entry.exercise_id));
  const totalWarmups = entries.reduce((sum, entry) => sum + entry.warmups, 0);
  const totalWorkings = entries.reduce((sum, entry) => sum + entry.workings, 0);
  const minutes = estimateMinutes(entries.map((entry) => ({ warmups: entry.warmups, workings: entry.workings })));
  const focus = [...entries.reduce((map, entry) => {
    const muscle = byId.get(entry.exercise_id)!.primary_muscle_group;
    return map.set(muscle, (map.get(muscle) ?? 0) + entry.workings);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([muscle]) => muscle);
  const replacing = picker?.mode === 'replace' ? draft.exercises.find((entry) => entry.key === picker.key) : null;

  return <div className="space-y-5 pb-28 forge-anim">
    <header className="flex items-center gap-3">
      <button type="button" onClick={() => requestLeave(() => navigate('/forge'))} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }} aria-label="Zurück zum Plan"><ArrowLeft size={19} /></button>
      <p className="min-w-0 flex-1 text-[10px] uppercase tracking-[0.18em]" style={{ color: SAND }}>{plan ? 'Trainingstag' : 'Neuer Trainingstag'}</p>
      {plan && <button type="button" onClick={() => setMenuOpen(true)} className="tap flex h-11 w-11 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }} aria-label="Weitere Aktionen"><MoreHorizontal size={20} /></button>}
    </header>

    {restored && dirty && <div className="forge-msg-in flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(232,197,138,0.08)', border: `1px solid ${SAND}33` }}>
      <p className="flex-1 text-[12.5px]" style={{ color: TEXT }}>Ungespeicherte Änderungen wiederhergestellt.</p>
      <button type="button" onClick={discard} className="tap h-9 rounded-lg px-3 text-[12px]" style={{ color: DIM }}>Verwerfen</button>
    </div>}

    <section className="space-y-2">
      <input value={draft.name} onChange={(event) => update({ name: event.target.value })} maxLength={255} placeholder="Name, z. B. Push A" aria-label="Name des Trainingstags" className="w-full bg-transparent text-[26px] font-semibold tracking-tight outline-none placeholder:text-[rgba(242,236,226,0.25)]" style={{ color: TEXT }} />
      <textarea value={draft.description} onChange={(event) => update({ description: event.target.value })} maxLength={500} rows={2} placeholder="Fokus oder kurze Beschreibung (optional)" aria-label="Beschreibung" className="w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-[rgba(242,236,226,0.3)]" style={{ color: 'rgba(242,236,226,0.75)' }} />
      <div className="grid grid-cols-2 gap-1 rounded-2xl p-1" role="radiogroup" aria-label="Art des Trainingstags" style={{ background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
        {([['workout', 'Workout', Dumbbell], ['course', 'Kurs', CalendarDays]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="radio" aria-checked={draft.plan_type === value} onClick={() => setPlanType(value)} className="tap flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] font-medium" style={{ color: draft.plan_type === value ? '#16130f' : DIM, background: draft.plan_type === value ? SAND : 'transparent' }}><Icon size={15} />{label}</button>)}
      </div>
    </section>

    {plan && <ForgePlanImageCard plan={plan} onUpdated={setPlan} />}

    {draft.plan_type === 'course' ? <section className="card-forge space-y-3 p-4">
      <p className="text-[13px]" style={{ color: DIM }}>Ein Kurs wird auf dem Dashboard mit einem Tipp als erledigt markiert, ohne Sätze zu tracken.</p>
      <Stepper label="Dauer in Minuten" value={draft.duration ?? 60} min={5} max={720} onChange={(value) => update({ duration: value })} suffix="min" />
      <div className="flex gap-1.5">{[30, 45, 60, 90].map((value) => <button key={value} type="button" onClick={() => update({ duration: value })} className="tap h-9 flex-1 rounded-full text-[12.5px]" style={{ color: draft.duration === value ? '#16130f' : TEXT, background: draft.duration === value ? SAND : 'rgba(255,247,235,0.05)' }}>{value} min</button>)}</div>
    </section> : <>
      <section className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>{entries.length} {entries.length === 1 ? 'Übung' : 'Übungen'}</h2>
            <p className="mt-0.5 text-[12px] tabular-nums" style={{ color: DIM }}>{totalWarmups ? `${totalWarmups} W + ` : ''}{totalWorkings} Sätze · ca. {minutes} Min</p>
          </div>
          {entries.length > 1 && <p className="text-right text-[11px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Gedrückt halten<br />zum Verschieben</p>}
        </div>
        {focus.length > 0 && <div className="flex flex-wrap gap-1.5">{focus.map((muscle) => <span key={muscle} className="rounded-full px-2.5 py-1 text-[11px]" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}>{muscleLabel(muscle)}</span>)}</div>}

        <SortableList
          className="space-y-2"
          items={entries}
          getKey={(entry) => entry.key}
          onReorder={(from, to) => {
            // Indexes refer to the visible entries; map back to the draft order.
            const keys = entries.map((entry) => entry.key);
            reorder(draft.exercises.findIndex((entry) => entry.key === keys[from]), draft.exercises.findIndex((entry) => entry.key === keys[to]));
          }}
          renderItem={(entry, index, { dragging }) => {
            const exercise = byId.get(entry.exercise_id)!;
            const open = expanded === entry.key && !dragging;
            const profiles = exercise.machine_profiles.length ? exercise.machine_profiles : exercise.available_machine_profiles;
            const profile = profiles.find((item) => item.id === entry.machine_profile_id) ?? null;
            return <SwipeToDelete onDelete={() => removeExercise(entry.key)} disabled={dragging || open}>
              <article className="overflow-hidden rounded-2xl" style={{ background: '#211c15', border: `1px solid ${open ? `${SAND}44` : BORDER}` }}>
                <button type="button" onClick={() => setExpanded(open ? null : entry.key)} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left">
                  <GripVertical size={16} className="shrink-0" style={{ color: 'rgba(242,236,226,0.25)' }} aria-hidden="true" />
                  <span className="w-5 shrink-0 text-center text-[12px] font-semibold tabular-nums" style={{ color: SAND }}>{index + 1}</span>
                  <EquipmentIcon equipment={exercise.equipment} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium" style={{ color: TEXT }}>{exercise.name}</span>
                    <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>{muscleLabel(exercise.primary_muscle_group)} · {entry.warmups ? `${entry.warmups} W + ` : ''}{entry.workings} {entry.workings === 1 ? 'Satz' : 'Sätze'}{profile ? ` · ${profile.name}` : ''}</span>
                  </span>
                  <ChevronDown size={17} className="shrink-0" style={{ color: DIM, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                {open && <div data-nodrag className="forge-expand space-y-4 border-t px-4 pb-4 pt-3" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
                  <div className="space-y-2">
                    <Stepper label="Aufwärmsätze" value={entry.warmups} min={0} max={Math.min(6, MAX_SETS - entry.workings)} onChange={(value) => updateExercise(entry.key, { warmups: value })} />
                    <Stepper label="Arbeitssätze" value={entry.workings} min={1} max={MAX_SETS - entry.warmups} onChange={(value) => updateExercise(entry.key, { workings: value })} />
                  </div>
                  {machineCapable(exercise.equipment) && profiles.length > 0 && <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: DIM }}>Gerät</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[{ id: null, name: 'In der Session wählen' }, ...profiles].map((item) => {
                        const selected = entry.machine_profile_id === item.id;
                        return <button key={item.id ?? 'none'} type="button" onClick={() => updateExercise(entry.key, { machine_profile_id: item.id })} aria-pressed={selected} className="tap h-9 rounded-full px-3 text-[12.5px]" style={{ color: selected ? '#16130f' : TEXT, background: selected ? SAND : 'rgba(255,247,235,0.04)', border: `1px solid ${selected ? SAND : BORDER}` }}>{item.name}</button>;
                      })}
                    </div>
                  </div>}
                  <label className="block"><span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider" style={{ color: DIM }}>Notiz (optional)</span><textarea value={entry.notes} onChange={(event) => updateExercise(entry.key, { notes: event.target.value })} maxLength={500} rows={2} className="input-forge w-full resize-none text-[13.5px]" placeholder="z. B. Sitz auf Stufe 4, enger Griff" /></label>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" onClick={() => setPicker({ mode: 'replace', key: entry.key })} className="tap flex h-11 items-center justify-center gap-1.5 rounded-xl text-[12.5px]" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)' }}><Replace size={15} />Ersetzen</button>
                    <button type="button" onClick={() => requestLeave(() => navigate(`/forge/exercises/${exercise.id}/history`))} className="tap flex h-11 items-center justify-center gap-1.5 rounded-xl text-[12.5px]" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)' }}><History size={15} />Verlauf</button>
                    <button type="button" onClick={() => removeExercise(entry.key)} className="tap flex h-11 items-center justify-center gap-1.5 rounded-xl text-[12.5px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.08)' }}><Trash2 size={15} />Entfernen</button>
                  </div>
                </div>}
              </article>
            </SwipeToDelete>;
          }}
        />

        <button type="button" onClick={() => setPicker({ mode: 'add' })} className="tap flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-medium" style={{ color: SAND, border: `1px dashed ${SAND}66` }}><Plus size={17} />Übungen hinzufügen</button>
        <p className="text-center text-[11px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Gewichte und Wiederholungen legt der Coach in jeder Session fest.</p>
      </section>

      <section className="rounded-2xl p-4" style={{ background: 'rgba(232,197,138,0.05)', border: `1px solid ${SAND}2a` }}>
        <p className="flex items-center gap-2 text-[14px] font-medium" style={{ color: TEXT }}><Sparkles size={16} style={{ color: SAND }} />Mit KI umbauen</p>
        <p className="mt-0.5 text-[11.5px]" style={{ color: DIM }}>Die KI ändert nur den Entwurf. Du prüfst und speicherst selbst.</p>
        {aiResult && <div className="forge-msg-in mt-3 flex items-start gap-2 rounded-xl p-3" style={{ background: 'rgba(22,19,15,0.5)' }}>
          <Sparkles size={14} className="mt-0.5 shrink-0" style={{ color: SAND }} />
          <p className="flex-1 text-[12.5px] leading-relaxed" style={{ color: TEXT }}>{aiResult.summary}</p>
          <button type="button" onClick={() => { setDraft(aiResult.previous); setAiResult(null); }} className="tap flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px]" style={{ color: SAND }}><RotateCcw size={13} />Zurück</button>
        </div>}
        <textarea value={aiText} onChange={(event) => setAiText(event.target.value)} disabled={aiBusy} rows={2} maxLength={2000} className="input-forge mt-3 w-full resize-none text-[14px]" placeholder="z. B. Ersetz Bankdrücken durch die Brustpresse und mach den Tag 40 Minuten kurz" />
        <button type="button" onClick={() => void reworkWithAi()} disabled={aiBusy || aiText.trim().length < 3} className="btn-forge mt-2 flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-40">{aiBusy ? <><Loader2 size={15} className="animate-spin" />KI baut um…</> : <><Sparkles size={15} />Umbauen</>}</button>
      </section>
    </>}

    {error && <p className="rounded-2xl px-4 py-3 text-[12.5px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}

    {(removed || dirty || !plan) && <div className="fixed inset-x-0 bottom-[72px] z-30 flex flex-col items-center gap-2 px-4">
      {removed && <div className="forge-toast flex items-center gap-3 rounded-2xl py-2 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: `1px solid ${SAND}44` }}>
        {byId.get(removed.entry.exercise_id)?.name ?? 'Übung'} entfernt
        <button type="button" onClick={undoRemove} className="tap flex h-9 items-center gap-1.5 rounded-xl px-3 font-semibold" style={{ color: SAND }}><Undo2 size={15} />Rückgängig</button>
      </div>}
      {(dirty || !plan) && <div className="forge-toast flex w-full max-w-2xl items-center gap-2 rounded-2xl p-2 pl-4 shadow-2xl" style={{ background: '#2a2318', border: `1px solid ${SAND}55` }}>
        <p className="min-w-0 flex-1 truncate text-[13px]" style={{ color: TEXT }}>{plan ? 'Ungespeicherte Änderungen' : 'Neuer Trainingstag'}</p>
        {plan && <button type="button" onClick={discard} disabled={saving} className="tap h-10 rounded-xl px-3 text-[13px]" style={{ color: DIM }}>Verwerfen</button>}
        <button type="button" onClick={() => void save()} disabled={saving} className="tap flex h-10 items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold" style={{ color: '#16130f', background: SAND }}>{saving && <Loader2 size={14} className="animate-spin" />}{plan ? 'Speichern' : 'Anlegen'}</button>
      </div>}
    </div>}

    {picker?.mode === 'add' && <ExercisePickerSheet
      title="Übungen hinzufügen"
      multiple
      exercises={library}
      disabledIds={draft.exercises.map((entry) => entry.exercise_id)}
      disabledLabel="Im Plan"
      onExerciseCreated={(exercise) => setLibrary((current) => [...current, exercise])}
      onConfirm={addExercises}
      onClose={() => setPicker(null)}
    />}
    {picker?.mode === 'replace' && replacing && <ExercisePickerSheet
      title={`${byId.get(replacing.exercise_id)?.name ?? 'Übung'} ersetzen`}
      exercises={library}
      disabledIds={draft.exercises.map((entry) => entry.exercise_id)}
      disabledLabel="Im Plan"
      preferMuscle={byId.get(replacing.exercise_id)?.primary_muscle_group ?? null}
      onExerciseCreated={(exercise) => setLibrary((current) => [...current, exercise])}
      onPick={(exercise) => replaceExercise(replacing.key, exercise)}
      onClose={() => setPicker(null)}
    />}

    {menuOpen && plan && <ForgeSheet label="Aktionen" onClose={() => setMenuOpen(false)}>
      <div className="flex items-center justify-between pb-3"><p className="text-[15px] font-semibold" style={{ color: TEXT }}>{plan.name}</p><button type="button" onClick={() => setMenuOpen(false)} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM }}><X size={18} /></button></div>
      <div className="space-y-1.5">
        <button type="button" onClick={() => void duplicate()} disabled={dirty || saving} className="tap flex w-full items-center gap-3 rounded-2xl p-3.5 text-left disabled:opacity-45" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}`, color: TEXT }}><Copy size={18} style={{ color: SAND }} /><span><span className="block text-[14px] font-medium">Duplizieren</span><span className="block text-[11px]" style={{ color: DIM }}>{dirty ? 'Erst speichern' : 'Als neuen Trainingstag kopieren'}</span></span></button>
        <button type="button" onClick={() => { setMenuOpen(false); setConfirm('delete'); }} className="tap flex w-full items-center gap-3 rounded-2xl p-3.5 text-left" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}`, color: '#fca5a5' }}><Trash2 size={18} /><span className="text-[14px] font-medium">Trainingstag löschen</span></button>
      </div>
    </ForgeSheet>}

    <ConfirmDialog
      open={confirm !== null}
      busy={saving}
      destructive
      title={confirm === 'delete' ? 'Trainingstag löschen?' : 'In Kurs umwandeln?'}
      description={confirm === 'delete' ? `„${plan?.name ?? ''}“ wird dauerhaft entfernt. Dein Trainingsverlauf bleibt erhalten.` : 'Ein Kurs hat keine Übungen. Die Übungen dieses Tages werden aus dem Entwurf entfernt.'}
      confirmLabel={confirm === 'delete' ? 'Löschen' : 'Umwandeln'}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm === 'delete') { void remove(); return; }
        setConfirm(null);
        update({ plan_type: 'course', duration: draft.duration ?? 60, exercises: [] });
      }}
    />
    <ConfirmDialog
      open={pendingLeave !== null}
      destructive
      title="Änderungen verwerfen?"
      description="Du hast ungespeicherte Änderungen an diesem Trainingstag."
      confirmLabel="Verwerfen"
      onCancel={() => setPendingLeave(null)}
      onConfirm={() => {
        const proceed = pendingLeave;
        setPendingLeave(null);
        sessionStorage.removeItem(storageKey);
        setLeaveGuard(null);
        proceed?.();
      }}
    />
  </div>;
}
