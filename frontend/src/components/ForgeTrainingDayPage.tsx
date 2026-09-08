import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarDays, Check, ChevronRight, Clock3, Dumbbell, GripVertical, History, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { createForgePlan, getForgeExercises, getForgePlans, updateForgePlan } from '../api/api';
import type { ForgeExercise, ForgePlan, ForgePlanExerciseInput, ForgePlanInput, ForgePlanSetInput } from '../api/api';
import ForgeExercisePicker from './ForgeExercisePicker';
import ForgePlanImageCard from './ForgePlanImageCard';
import ForgeSheet from './ForgeSheet';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';
const DRAFT_KEY = 'forge-training-day-draft';
const CREATED_EXERCISE_KEY = 'forge-training-day-created-exercise';

const blankSets = (): ForgePlanSetInput[] => Array.from({ length: 3 }, () => ({
  set_type: 'working', previous_weight_kg: null, previous_reps: null, current_weight_kg: null,
  current_reps: 10, coach_suggested_weight_kg: null, coach_suggested_reps: null, note: '',
}));

const toInput = (plan: ForgePlan): ForgePlanInput => ({
  name: plan.name, description: plan.description, plan_type: plan.plan_type,
  default_duration_minutes: plan.default_duration_minutes, position: plan.position,
  exercises: plan.exercises.map((entry) => ({
    exercise_id: entry.exercise.id, machine_profile_id: entry.machine_profile?.id ?? null, notes: entry.notes,
    sets: entry.sets.map((set) => ({
      set_type: set.set_type, previous_weight_kg: null, previous_reps: null,
      current_weight_kg: null, current_reps: set.current_reps, coach_suggested_weight_kg: null,
      coach_suggested_reps: set.coach_suggested_reps, note: set.note
    })),
  })),
});

const normalizeForSave = (draft: ForgePlanInput): ForgePlanInput => ({
  ...draft,
  exercises: draft.exercises.map((entry) => ({
    ...entry, sets: entry.sets.map((set) => ({
      ...set, previous_weight_kg: null, current_weight_kg: null, coach_suggested_weight_kg: null,
    }))
  })),
});

const equipmentLabel: Record<string, string> = { none: 'Ohne Equipment', barbell: 'Langhantel', dumbbell: 'Kurzhantel', kettlebell: 'Kettlebell', cable: 'Kabelzug', machine: 'Maschine', other: 'Sonstiges' };

export default function ForgeTrainingDayPage() {
  const { planId } = useParams<{ planId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const editing = !planId || planId === 'new' || location.pathname.endsWith('/edit');
  const [plan, setPlan] = useState<ForgePlan | null>(null);
  const [exercises, setExercises] = useState<ForgeExercise[]>([]);
  const [draft, setDraft] = useState<ForgePlanInput | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([getForgePlans(), getForgeExercises()]).then(([plans, library]) => {
      const loaded = plans.find((item) => item.id === planId) ?? null;
      setPlan(loaded); setExercises(library);
      if (editing) {
        const persisted = sessionStorage.getItem(DRAFT_KEY);
        const parsed = persisted ? JSON.parse(persisted) as { path: string; draft: ForgePlanInput } : null;
        let nextDraft = parsed?.path === location.pathname
          ? parsed.draft
          : loaded
            ? toInput(loaded)
            : { name: '', description: '', plan_type: 'workout' as const, default_duration_minutes: null, position: plans.length, exercises: [] };
        if (parsed?.path === location.pathname) sessionStorage.removeItem(DRAFT_KEY);

        const created = sessionStorage.getItem(CREATED_EXERCISE_KEY);
        const createdExercise = created ? JSON.parse(created) as { path: string; exerciseId: string } : null;
        if (createdExercise?.path === location.pathname) {
          const exercise = library.find((item) => item.id === createdExercise.exerciseId);
          if (exercise && !nextDraft.exercises.some((entry) => entry.exercise_id === exercise.id)) {
            nextDraft = { ...nextDraft, exercises: [...nextDraft.exercises, { exercise_id: exercise.id, machine_profile_id: null, notes: '', sets: blankSets() }] };
          }
          sessionStorage.removeItem(CREATED_EXERCISE_KEY);
        }
        setDraft(nextDraft);
      }
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht geladen werden.')).finally(() => setLoading(false));
  }, [editing, location.pathname, planId]);

  const selectedIds = draft?.exercises.map((entry) => entry.exercise_id) ?? [];
  const totalSets = useMemo(() => plan?.exercises.reduce((sum, entry) => sum + entry.sets.length, 0) ?? 0, [plan]);

  const updateEntry = (index: number, updater: (entry: ForgePlanExerciseInput) => ForgePlanExerciseInput) => {
    if (!draft) return;
    setDraft({ ...draft, exercises: draft.exercises.map((entry, entryIndex) => entryIndex === index ? updater(entry) : entry) });
  };
  const toggleExercise = (exercise: ForgeExercise) => {
    if (!draft) return;
    const exists = draft.exercises.some((entry) => entry.exercise_id === exercise.id);
    setDraft({ ...draft, exercises: exists ? draft.exercises.filter((entry) => entry.exercise_id !== exercise.id) : [...draft.exercises, { exercise_id: exercise.id, machine_profile_id: null, notes: '', sets: blankSets() }] });
  };
  const reorder = (from: number, to: number) => {
    if (!draft || from === to || from < 0 || to < 0 || from >= draft.exercises.length || to >= draft.exercises.length) return;
    const next = [...draft.exercises]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); setDraft({ ...draft, exercises: next });
  };
  const pointerDrop = (event: React.PointerEvent, from: number) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-reorder-index]');
    const to = target ? Number(target.dataset.reorderIndex) : from; reorder(from, to); dragIndex.current = null;
  };
  const save = async () => {
    if (!draft?.name.trim()) { setError('Gib dem Trainingstag einen Namen.'); return; }
    if (draft.plan_type === 'course' && !draft.default_duration_minutes) { setError('Gib die Kursdauer an.'); return; }
    setSaving(true); setError(null);
    try {
      const saved = plan ? await updateForgePlan(plan.id, normalizeForSave(draft)) : await createForgePlan(normalizeForSave(draft));
      sessionStorage.removeItem(DRAFT_KEY); navigate(`/forge/days/${saved.id}`, { replace: true });
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht gespeichert werden.'); }
    finally { setSaving(false); }
  };
  const createExercise = () => {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ path: location.pathname, draft }));
    navigate(`/forge/exercises/new?returnTo=${encodeURIComponent(location.pathname)}`);
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;
  if (!editing && !plan) return <div className="card-forge p-6 text-center text-[12px]" style={{ color: error ? '#fca5a5' : DIM }}>{error || 'Trainingstag nicht gefunden.'}</div>;

  return <div className="space-y-4 forge-anim">
    <header className="flex items-start gap-3"><button onClick={() => navigate('/forge')} className="tap mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }} aria-label="Zurück zum Plan"><ArrowLeft size={18} /></button><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: SAND }}>{editing ? 'Trainingstag bearbeiten' : 'Trainingstag'}</p><h1 className="mt-1 truncate text-[25px] font-semibold tracking-tight" style={{ color: TEXT }}>{editing ? (draft?.name || 'Neuer Trainingstag') : plan?.name}</h1>{!editing && <p className="mt-1 text-[11px]" style={{ color: DIM }}>{plan?.plan_type === 'course' ? `${plan.default_duration_minutes} Minuten Kurs` : `${plan?.exercises.length} Übungen · ${totalSets} Sätze`}</p>}</div>{!editing && <button onClick={() => navigate(`/forge/days/${planId}/edit`)} className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: SAND, border: `1px solid ${BORDER}` }} aria-label="Trainingstag bearbeiten"><Pencil size={16} /></button>}</header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}
    {plan && <ForgePlanImageCard plan={plan} onUpdated={setPlan} />}

    {editing && draft ? <>
      <section className="card-forge space-y-3 p-4"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="input-forge w-full" placeholder="Name des Trainingstags" /><textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="input-forge w-full resize-none text-[12px]" rows={2} placeholder="Fokus oder kurze Beschreibung" /><div className="grid grid-cols-2 gap-2"><button onClick={() => setDraft({ ...draft, plan_type: 'workout', default_duration_minutes: null })} className="rounded-xl py-2.5 text-[11px]" style={{ color: draft.plan_type === 'workout' ? SAND : DIM, border: `1px solid ${draft.plan_type === 'workout' ? SAND : BORDER}` }}><Dumbbell size={14} className="mr-1 inline" />Workout</button><button onClick={() => setDraft({ ...draft, plan_type: 'course', default_duration_minutes: draft.default_duration_minutes ?? 60, exercises: [] })} className="rounded-xl py-2.5 text-[11px]" style={{ color: draft.plan_type === 'course' ? SAND : DIM, border: `1px solid ${draft.plan_type === 'course' ? SAND : BORDER}` }}><CalendarDays size={14} className="mr-1 inline" />Kurs</button></div>{draft.plan_type === 'course' && <input type="number" min="1" max="720" value={draft.default_duration_minutes ?? ''} onChange={(event) => setDraft({ ...draft, default_duration_minutes: event.target.value ? Number(event.target.value) : null })} className="input-forge w-full" placeholder="Dauer in Minuten" />}</section>
      {draft.plan_type === 'workout' && <>
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Reihenfolge</p><p className="mt-1 text-[11px]" style={{ color: DIM }}>Am Griff ziehen oder mit den Pfeilen verschieben.</p></div><button onClick={() => setPickerOpen(true)} className="tap flex items-center gap-1.5 text-[11px] font-medium" style={{ color: SAND }}><Plus size={14} />Übungen</button></div>
        <div className="space-y-3">{draft.exercises.map((entry, index) => {
          const exercise = exercises.find((item) => item.id === entry.exercise_id); if (!exercise) return null; return <article key={entry.exercise_id} data-reorder-index={index} draggable onDragStart={(event) => { dragIndex.current = index; event.dataTransfer.effectAllowed = 'move'; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragIndex.current != null) reorder(dragIndex.current, index); }} className="card-forge overflow-hidden">
            <div className="flex items-center gap-2 p-3"><button onPointerDown={(event) => { dragIndex.current = index; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => pointerDrop(event, index)} className="touch-none p-1" aria-label={`${exercise.name} ziehen`} style={{ color: DIM }}><GripVertical size={18} /></button><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ color: '#16130f', background: SAND }}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium" style={{ color: TEXT }}>{exercise.name}</p><p className="truncate text-[10px]" style={{ color: DIM }}>{exercise.primary_muscle_group} · {equipmentLabel[exercise.equipment]}</p></div><button onClick={() => reorder(index, index - 1)} disabled={index === 0} className="tap p-1 disabled:opacity-20" aria-label={`${exercise.name} nach oben`} style={{ color: SAND }}><ArrowUp size={15} /></button><button onClick={() => reorder(index, index + 1)} disabled={index === draft.exercises.length - 1} className="tap p-1 disabled:opacity-20" aria-label={`${exercise.name} nach unten`} style={{ color: SAND }}><ArrowDown size={15} /></button><button onClick={() => toggleExercise(exercise)} className="tap p-1" aria-label={`${exercise.name} entfernen`} style={{ color: DIM }}><X size={15} /></button></div>
            {exercise.machine_profiles.length > 0 && <div className="border-t px-3 py-2" style={{ borderColor: 'rgba(255,247,235,0.06)' }}><select value={entry.machine_profile_id ?? ''} onChange={(event) => updateEntry(index, (current) => ({ ...current, machine_profile_id: event.target.value || null }))} className="w-full bg-transparent text-[10px] outline-none" style={{ color: SAND }}><option value="">Geräteprofil erst in der Session wählen</option>{exercise.machine_profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.model ? ` · ${profile.model}` : ''}</option>)}</select></div>}
            {exercise.last_performance && <div className="flex items-start gap-2 border-t px-3 py-2.5" style={{ borderColor: 'rgba(255,247,235,0.06)', background: 'rgba(232,197,138,0.045)' }}><History size={13} className="mt-0.5 shrink-0" style={{ color: SAND }} /><div><p className="text-[10px] font-medium" style={{ color: TEXT }}>Letzte Leistung · {new Date(exercise.last_performance.completed_at).toLocaleDateString('de-DE')}</p><p className="mt-0.5 text-[10px]" style={{ color: DIM }}>{exercise.last_performance.machine_profile_name ? `${exercise.last_performance.machine_profile_name} · ` : ''}{exercise.last_performance.sets.map((set) => `${set.actual_weight_kg == null ? 'BW' : `${set.actual_weight_kg} kg`} × ${set.actual_reps}`).join(' · ')}</p></div></div>}
            <div className="space-y-2 border-t p-3" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>{entry.sets.map((set, setIndex) => { const workNumber = entry.sets.slice(0, setIndex + 1).filter((item) => item.set_type === 'working').length; return <div key={setIndex} className="flex items-center gap-2 rounded-xl p-2" style={{ background: set.set_type === 'warmup' ? 'rgba(232,197,138,0.07)' : 'rgba(255,247,235,0.025)' }}><select value={set.set_type} onChange={(event) => updateEntry(index, (current) => ({ ...current, sets: current.sets.map((item, itemIndex) => itemIndex === setIndex ? { ...item, set_type: event.target.value as 'warmup' | 'working' } : item) }))} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" style={{ color: set.set_type === 'warmup' ? SAND : TEXT }}><option value="warmup">Warm-up</option><option value="working">{workNumber}. Arbeitssatz</option></select><label className="flex items-center gap-1 text-[10px]" style={{ color: DIM }}><input type="number" min="0" value={set.current_reps ?? ''} onChange={(event) => updateEntry(index, (current) => ({ ...current, sets: current.sets.map((item, itemIndex) => itemIndex === setIndex ? { ...item, current_reps: event.target.value ? Number(event.target.value) : null, current_weight_kg: null } : item) }))} className="input-forge w-16 !px-2 !py-1.5 text-center" aria-label="Geplante Wiederholungen" />Wdh.</label><button onClick={() => updateEntry(index, (current) => ({ ...current, sets: current.sets.filter((_, itemIndex) => itemIndex !== setIndex) }))} className="tap p-1" aria-label="Satz löschen" style={{ color: DIM }}><Trash2 size={14} /></button></div>; })}<div className="flex gap-4"><button onClick={() => updateEntry(index, (current) => ({ ...current, sets: [...current.sets, { ...blankSets()[0], set_type: 'warmup', current_reps: null }] }))} className="tap text-[10px]" style={{ color: DIM }}><Plus size={12} className="mr-1 inline" />Warm-up</button><button onClick={() => updateEntry(index, (current) => ({ ...current, sets: [...current.sets, blankSets()[0]] }))} className="tap text-[10px]" style={{ color: SAND }}><Plus size={12} className="mr-1 inline" />Arbeitssatz</button></div></div>
          </article>;
        })}</div>
        {!draft.exercises.length && <button onClick={() => setPickerOpen(true)} className="w-full rounded-2xl border border-dashed p-7 text-center" style={{ color: SAND, borderColor: `${SAND}44` }}><Plus size={20} className="mx-auto" /><span className="mt-2 block text-[12px]">Übungen auswählen</span></button>}
      </>}
      <button onClick={() => void save()} disabled={saving} className="btn-forge flex w-full items-center justify-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Trainingstag speichern</button>
    </> : plan && <>
      {plan.description && <p className="card-forge p-4 text-[12px] leading-relaxed" style={{ color: DIM }}>{plan.description}</p>}
      {plan.plan_type === 'course' ? <section className="card-forge p-6 text-center"><Clock3 className="mx-auto" size={25} style={{ color: SAND }} /><p className="mt-3 text-[18px] font-semibold" style={{ color: TEXT }}>{plan.default_duration_minutes} Minuten</p><p className="mt-1 text-[11px]" style={{ color: DIM }}>Kurs ohne Satztracking</p></section> : plan.exercises.map((entry, index) => <article key={entry.id} className="card-forge overflow-hidden"><div className="flex items-center gap-3 p-4"><span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold" style={{ color: '#16130f', background: SAND }}>{index + 1}</span><div className="min-w-0 flex-1"><h2 className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>{entry.exercise.name}</h2><p className="mt-0.5 text-[10px]" style={{ color: DIM }}>{entry.exercise.primary_muscle_group} · {entry.machine_profile?.name ?? equipmentLabel[entry.exercise.equipment]}</p></div><button onClick={() => navigate(`/forge/exercises/${entry.exercise.id}/history`)} className="tap p-1" aria-label="Übungsverlauf" style={{ color: SAND }}><ChevronRight size={17} /></button></div>{entry.exercise.last_performance && <div className="border-t px-4 py-3" style={{ borderColor: 'rgba(255,247,235,0.06)', background: 'rgba(232,197,138,0.045)' }}><p className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: SAND }}><History size={12} />Letzte globale Leistung · {new Date(entry.exercise.last_performance.completed_at).toLocaleDateString('de-DE')}</p><p className="mt-1 text-[10px]" style={{ color: DIM }}>{entry.exercise.last_performance.sets.map((set) => `${set.actual_weight_kg == null ? 'BW' : `${set.actual_weight_kg} kg`} × ${set.actual_reps}`).join(' · ')}</p></div>}<div className="border-t" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>{entry.sets.map((set, setIndex) => <div key={set.id} className="flex items-center justify-between px-4 py-2.5 text-[11px]" style={{ background: setIndex % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}><span style={{ color: set.set_type === 'warmup' ? SAND : DIM }}>{set.set_type === 'warmup' ? 'Warm-up' : `${entry.sets.slice(0, setIndex + 1).filter((item) => item.set_type === 'working').length}. Arbeitssatz`}</span><span className="font-medium" style={{ color: TEXT }}>{set.current_reps ?? set.coach_suggested_reps ?? '—'} Wdh.</span></div>)}</div></article>)}
    </>}

    {pickerOpen && draft && <ForgeSheet label="Übungen auswählen" onClose={() => setPickerOpen(false)}><div><div className="mb-4 flex justify-end"><button onClick={() => setPickerOpen(false)} className="tap flex items-center gap-1 text-[11px]" style={{ color: DIM }}><Check size={14} />Fertig</button></div><ForgeExercisePicker exercises={exercises} selectedIds={selectedIds} multiple onToggle={toggleExercise} onCreate={createExercise} /></div></ForgeSheet>}
  </div>;
}
