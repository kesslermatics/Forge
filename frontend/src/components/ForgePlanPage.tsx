import { useEffect, useMemo, useState } from 'react';
import {
  Bot, CirclePlus, Dumbbell, Loader2,
  Pencil, Plus, Save, Sparkles, Trash2, Wrench,
} from 'lucide-react';
import {
  createForgeExercise, createForgePlan, createForgeProgram, deleteForgeExercise, deleteForgePlan,
  generateForgeExerciseDraft, generateForgePlanDraft, getForgeExercises, getForgePrograms,
  getForgePlans, refreshForgePlanCoachTargets, updateForgeExercise, updateForgePlan, updateForgeProgram,
} from '../api/api';
import type {
  ForgeEquipment, ForgeExercise, ForgeExerciseInput, ForgeMachineProfileInput,
  ForgePlan, ForgePlanInput, ForgePlanSetInput, ForgeProgram, ForgeProgramInput,
} from '../api/api';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Lats', 'Traps', 'Shoulders', 'Biceps', 'Triceps',
  'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms', 'Full Body', 'Other',
];

const EQUIPMENT: Array<{ value: ForgeEquipment; label: string }> = [
  { value: 'none', label: 'Ohne' }, { value: 'barbell', label: 'Langhantel' },
  { value: 'dumbbell', label: 'Kurzhantel' }, { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'machine', label: 'Maschine' }, { value: 'other', label: 'Sonstiges' },
];

const emptyExercise = (): ForgeExerciseInput => ({
  name: '', icon: 'Dumbbell', equipment: 'other', primary_muscle_group: 'Other',
  secondary_muscle_groups: [], machine_profiles: [],
});

const defaultSets = (): ForgePlanSetInput[] => Array.from({ length: 3 }, () => ({
  set_type: 'working', current_weight_kg: null, current_reps: 10,
  coach_suggested_weight_kg: null, coach_suggested_reps: null, note: '',
}));

const toPlanInput = (plan: ForgePlan): ForgePlanInput => ({
  name: plan.name,
  description: plan.description,
  position: plan.position,
  exercises: plan.exercises.map((entry) => ({
    exercise_id: entry.exercise.id,
    machine_profile_id: entry.machine_profile?.id ?? null,
    notes: entry.notes,
    sets: entry.sets.map((set) => ({
      set_type: set.set_type,
      previous_weight_kg: set.previous_weight_kg,
      previous_reps: set.previous_reps,
      current_weight_kg: set.current_weight_kg,
      current_reps: set.current_reps,
      coach_suggested_weight_kg: set.coach_suggested_weight_kg,
      coach_suggested_reps: set.coach_suggested_reps,
      note: set.note,
    })),
  })),
});

const formatSet = (weight: number | null, reps: number | null) => {
  if (weight == null && reps == null) return '—';
  return `${weight != null && weight > 0 ? `${weight} kg` : 'BW'}${reps != null ? ` × ${reps}` : ''}`;
};

export default function ForgePlanPage() {
  const [tab, setTab] = useState<'plan' | 'exercises'>('plan');
  const [plans, setPlans] = useState<ForgePlan[]>([]);
  const [programs, setPrograms] = useState<ForgeProgram[]>([]);
  const [programEditor, setProgramEditor] = useState(false);
  const [programDraft, setProgramDraft] = useState<ForgeProgramInput | null>(null);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ForgeExercise[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [planEditor, setPlanEditor] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<ForgePlanInput | null>(null);
  const [planPrompt, setPlanPrompt] = useState('');
  const [exerciseEditor, setExerciseEditor] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [exerciseDraft, setExerciseDraft] = useState<ForgeExerciseInput>(emptyExercise());
  const [exercisePrompt, setExercisePrompt] = useState('');

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId],
  );

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [loadedPlans, loadedExercises, loadedPrograms] = await Promise.all([getForgePlans(), getForgeExercises(), getForgePrograms()]);
      setPlans(loadedPlans); setExercises(loadedExercises); setPrograms(loadedPrograms);
      setSelectedPlanId((current) => current ?? loadedPlans[0]?.id ?? null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Forge konnte nicht geladen werden.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const startPlan = (plan?: ForgePlan) => {
    setError(null); setNotice(null); setEditingPlanId(plan?.id ?? null);
    setPlanDraft(plan ? toPlanInput(plan) : {
      name: '', description: '', position: plans.length, exercises: [],
    });
    setPlanEditor(true);
  };

  const startProgram = (program?: ForgeProgram) => {
    setError(null); setNotice(null); setEditingProgramId(program?.id ?? null);
    setProgramDraft(program ? {
      name: program.name,
      mode: program.mode,
      is_active: program.is_active,
      routines: program.routines.map((routine) => ({ plan_id: routine.plan.id, weekdays: routine.weekdays })),
    } : {
      name: 'Mein Trainingsplan', mode: 'rotation', is_active: true,
      routines: plans.map((plan) => ({ plan_id: plan.id, weekdays: [] })),
    });
    setProgramEditor(true);
  };

  const saveProgram = async () => {
    if (!programDraft || !programDraft.name.trim()) { setError('Gib dem Trainingsplan einen Namen.'); return; }
    setSaving(true); setError(null);
    try {
      const saved = editingProgramId
        ? await updateForgeProgram(editingProgramId, programDraft)
        : await createForgeProgram(programDraft);
      setPrograms((current) => [...current.filter((program) => program.id !== saved.id), saved]);
      setProgramEditor(false); setEditingProgramId(null); setProgramDraft(null);
      setNotice('Trainingsmodus gespeichert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Trainingsmodus konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const toggleProgramRoutine = (plan: ForgePlan) => {
    setProgramDraft((draft) => {
      if (!draft) return draft;
      const exists = draft.routines.some((routine) => routine.plan_id === plan.id);
      return { ...draft, routines: exists ? draft.routines.filter((routine) => routine.plan_id !== plan.id) : [...draft.routines, { plan_id: plan.id, weekdays: [] }] };
    });
  };

  const activeProgram = programs.find((program) => program.is_active) ?? programs[0] ?? null;

  const togglePlanExercise = (exercise: ForgeExercise) => {
    setPlanDraft((draft) => {
      if (!draft) return draft;
      const exists = draft.exercises.some((entry) => entry.exercise_id === exercise.id);
      return {
        ...draft,
        exercises: exists
          ? draft.exercises.filter((entry) => entry.exercise_id !== exercise.id)
          : [...draft.exercises, {
            exercise_id: exercise.id,
            machine_profile_id: exercise.machine_profiles[0]?.id ?? null,
            notes: '',
            sets: defaultSets(),
          }],
      };
    });
  };

  const updateDraftSet = (exerciseIndex: number, setIndex: number, key: keyof ForgePlanSetInput, value: number | string | null) => {
    setPlanDraft((draft) => {
      if (!draft) return draft;
      const next = structuredClone(draft);
      next.exercises[exerciseIndex].sets[setIndex] = { ...next.exercises[exerciseIndex].sets[setIndex], [key]: value };
      return next;
    });
  };

  const savePlan = async () => {
    if (!planDraft || !planDraft.name.trim()) { setError('Gib dem Trainingsplan einen Namen.'); return; }
    setSaving(true); setError(null);
    try {
      const saved = editingPlanId
        ? await updateForgePlan(editingPlanId, planDraft)
        : await createForgePlan(planDraft);
      setPlans((current) => {
        const rest = current.filter((plan) => plan.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.position - b.position);
      });
      setSelectedPlanId(saved.id); setPlanEditor(false); setEditingPlanId(null); setPlanDraft(null);
      setNotice('Trainingsplan gespeichert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Plan konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const generatePlan = async () => {
    if (!planPrompt.trim()) { setError('Beschreibe kurz, was Forge für den Plan ändern soll.'); return; }
    if (exercises.length === 0) { setError('Erstelle zuerst mindestens eine Übung in deiner Bibliothek.'); return; }
    setGenerating(true); setError(null); setNotice(null);
    try {
      const result = await generateForgePlanDraft(planPrompt, exercises.map((exercise) => exercise.id), selectedPlan?.id);
      setPlanDraft({ ...result.draft, position: selectedPlan?.position ?? plans.length });
      setEditingPlanId(selectedPlan?.id ?? null);
      setPlanEditor(true);
      setNotice('KI-Entwurf erstellt – prüfe ihn und speichere ihn bewusst.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'KI-Entwurf konnte nicht erstellt werden.');
    } finally { setGenerating(false); }
  };

  const removePlan = async (plan: ForgePlan) => {
    if (!window.confirm(`„${plan.name}“ wirklich löschen?`)) return;
    setSaving(true); setError(null);
    try {
      await deleteForgePlan(plan.id);
      const remaining = plans.filter((item) => item.id !== plan.id);
      setPlans(remaining); setSelectedPlanId(remaining[0]?.id ?? null); setNotice('Trainingsplan gelöscht.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Plan konnte nicht gelöscht werden.');
    } finally { setSaving(false); }
  };

  const refreshCoachTargets = async (plan: ForgePlan) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const refreshed = await refreshForgePlanCoachTargets(plan.id);
      setPlans((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
      setNotice('Forge-Vorschläge wurden aus deinen nativen Sessions aktualisiert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Coach-Vorschläge konnten nicht aktualisiert werden.');
    } finally { setSaving(false); }
  };

  const startExercise = (exercise?: ForgeExercise) => {
    setError(null); setNotice(null); setEditingExerciseId(exercise?.id ?? null);
    setExerciseDraft(exercise ? {
      name: exercise.name,
      icon: exercise.icon,
      equipment: exercise.equipment,
      primary_muscle_group: exercise.primary_muscle_group,
      secondary_muscle_groups: exercise.secondary_muscle_groups,
      machine_profiles: exercise.machine_profiles.map((profile) => ({ name: profile.name, model: profile.model, notes: profile.notes })),
    } : emptyExercise());
    setExerciseEditor(true);
  };

  const toggleSecondaryMuscle = (muscle: string) => {
    setExerciseDraft((draft) => ({
      ...draft,
      secondary_muscle_groups: draft.secondary_muscle_groups.includes(muscle)
        ? draft.secondary_muscle_groups.filter((item) => item !== muscle)
        : [...draft.secondary_muscle_groups, muscle],
    }));
  };

  const updateMachineProfile = (index: number, key: keyof ForgeMachineProfileInput, value: string) => {
    setExerciseDraft((draft) => ({
      ...draft,
      machine_profiles: draft.machine_profiles.map((profile, profileIndex) => profileIndex === index ? { ...profile, [key]: value } : profile),
    }));
  };

  const saveExercise = async () => {
    if (!exerciseDraft.name.trim()) { setError('Gib der Übung einen Namen.'); return; }
    setSaving(true); setError(null);
    try {
      const saved = editingExerciseId
        ? await updateForgeExercise(editingExerciseId, exerciseDraft)
        : await createForgeExercise(exerciseDraft);
      setExercises((current) => [...current.filter((exercise) => exercise.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setExerciseEditor(false); setEditingExerciseId(null); setNotice('Übung gespeichert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Übung konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const generateExercise = async () => {
    if (!exercisePrompt.trim()) { setError('Beschreibe die Übung, die Forge anlegen soll.'); return; }
    setGenerating(true); setError(null); setNotice(null);
    try {
      const result = await generateForgeExerciseDraft(exercisePrompt);
      setExerciseDraft(result.draft); setEditingExerciseId(null); setExerciseEditor(true);
      setNotice('KI-Entwurf erstellt – prüfe ihn und speichere ihn bewusst.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'KI-Entwurf konnte nicht erstellt werden.');
    } finally { setGenerating(false); }
  };

  const removeExercise = async (exercise: ForgeExercise) => {
    if (!window.confirm(`„${exercise.name}“ wirklich löschen?`)) return;
    setSaving(true); setError(null);
    try {
      await deleteForgeExercise(exercise.id);
      setExercises((current) => current.filter((item) => item.id !== exercise.id)); setNotice('Übung gelöscht.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Übung kann nicht gelöscht werden, solange sie in einem Plan verwendet wird.');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

  return (
    <div className="space-y-4 forge-anim">
      <header>
        <p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: SAND }}>Forge library</p>
        <h1 className="text-[27px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>Dein Training</h1>
        <p className="text-[13px] mt-1" style={{ color: DIM }}>Deine Übungen, deine Maschinen, dein Plan.</p>
      </header>

      <div className="grid grid-cols-2 rounded-2xl p-1" style={{ background: 'rgba(255,247,235,0.055)', border: `1px solid ${BORDER}` }}>
        {([['plan', 'Plan'], ['exercises', 'Übungen']] as const).map(([value, label]) => (
          <button key={value} onClick={() => setTab(value)} className="tap rounded-xl py-2.5 text-[13px] font-medium cursor-pointer"
            style={{ background: tab === value ? 'rgba(232,197,138,0.16)' : 'transparent', color: tab === value ? SAND : DIM }}>
            {label}
          </button>
        ))}
      </div>

      {(error || notice) && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ background: error ? 'rgba(248,113,113,0.1)' : 'rgba(232,197,138,0.1)', color: error ? '#fca5a5' : SAND }}>{error || notice}</div>}

      {tab === 'plan' ? (
        <section className="space-y-4">
          {programEditor && programDraft ? <ProgramEditor draft={programDraft} plans={plans} saving={saving} onChange={setProgramDraft} onToggleRoutine={toggleProgramRoutine} onCancel={() => { setProgramEditor(false); setEditingProgramId(null); setProgramDraft(null); }} onSave={() => void saveProgram()} /> : <ProgramSummary program={activeProgram} onEdit={() => startProgram(activeProgram ?? undefined)} onCreate={() => startProgram()} />}
          <AiPrompt
            placeholder="z. B. Erstelle mir einen Pull-Tag mit Lat-Fokus und 60 Minuten Dauer"
            value={planPrompt} onChange={setPlanPrompt} onGenerate={() => void generatePlan()} generating={generating}
          />
          {!planEditor && (
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {plans.map((plan) => <button key={plan.id} onClick={() => setSelectedPlanId(plan.id)} className="tap shrink-0 rounded-full px-3.5 py-2 text-[12px] cursor-pointer"
                style={{ border: `1px solid ${selectedPlan?.id === plan.id ? SAND : BORDER}`, color: selectedPlan?.id === plan.id ? SAND : DIM, background: selectedPlan?.id === plan.id ? 'rgba(232,197,138,0.09)' : 'transparent' }}>{plan.name}</button>)}
              <button onClick={() => startPlan()} className="tap shrink-0 rounded-full px-3.5 py-2 text-[12px] flex items-center gap-1 cursor-pointer" style={{ border: `1px dashed ${BORDER}`, color: SAND }}><Plus size={13} />Plan</button>
            </div>
          )}

          {planEditor && planDraft ? <PlanEditor
            draft={planDraft} exercises={exercises} saving={saving}
            onChange={setPlanDraft} onToggleExercise={togglePlanExercise} onUpdateSet={updateDraftSet}
            onCancel={() => { setPlanEditor(false); setEditingPlanId(null); setPlanDraft(null); }} onSave={() => void savePlan()}
          /> : selectedPlan ? <PlanView plan={selectedPlan} saving={saving} onEdit={() => startPlan(selectedPlan)} onRefresh={() => void refreshCoachTargets(selectedPlan)} onDelete={() => void removePlan(selectedPlan)} /> : (
            <EmptyState icon={<Dumbbell size={22} />} title="Noch kein Plan" copy="Lege zuerst eigene Übungen an und erstelle dann einen Plan – manuell oder mit Forge." action="Plan erstellen" onClick={() => startPlan()} />
          )}
        </section>
      ) : (
        <section className="space-y-4">
          <AiPrompt
            placeholder="z. B. Lege eine Life-Fitness Leg Press für Quads und Glutes an"
            value={exercisePrompt} onChange={setExercisePrompt} onGenerate={() => void generateExercise()} generating={generating}
          />
          {exerciseEditor ? <ExerciseEditor
            draft={exerciseDraft} saving={saving} onChange={setExerciseDraft}
            onToggleSecondary={toggleSecondaryMuscle} onUpdateProfile={updateMachineProfile}
            onCancel={() => { setExerciseEditor(false); setEditingExerciseId(null); }} onSave={() => void saveExercise()}
          /> : <>
            <button onClick={() => startExercise()} className="btn-forge w-full flex items-center justify-center gap-2"><CirclePlus size={16} />Eigene Übung</button>
            {exercises.length ? <div className="space-y-2">{exercises.map((exercise) => <ExerciseCard key={exercise.id} exercise={exercise} onEdit={() => startExercise(exercise)} onDelete={() => void removeExercise(exercise)} />)}</div>
              : <EmptyState icon={<Wrench size={22} />} title="Deine Übungsbibliothek ist leer" copy="Erstelle eigene Bewegungen und hinterlege für Maschinen getrennte Profile." action="Übung anlegen" onClick={() => startExercise()} />}
          </>}
        </section>
      )}
    </div>
  );
}

function AiPrompt({ placeholder, value, onChange, onGenerate, generating }: { placeholder: string; value: string; onChange: (value: string) => void; onGenerate: () => void; generating: boolean }) {
  return <div className="card-forge p-4 space-y-3" style={{ borderColor: `${SAND}26` }}>
    <div className="flex items-center gap-2"><Sparkles size={15} style={{ color: SAND }} /><p className="text-[12px] font-medium" style={{ color: TEXT }}>Mit Forge entwerfen</p></div>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={2} className="input-forge w-full resize-none text-[12px]" />
    <button onClick={onGenerate} disabled={generating} className="tap text-[12px] font-medium flex items-center gap-2 cursor-pointer" style={{ color: SAND }}>
      {generating ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}Entwurf erstellen
    </button>
    <p className="text-[10px]" style={{ color: DIM }}>Entwürfe werden erst nach deinem Speichern übernommen.</p>
  </div>;
}

function PlanView({ plan, saving, onEdit, onRefresh, onDelete }: { plan: ForgePlan; saving: boolean; onEdit: () => void; onRefresh: () => void; onDelete: () => void }) {
  return <div className="space-y-3">
    <div className="card-forge p-5" style={{ borderColor: `${SAND}20` }}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-[20px] font-semibold" style={{ color: TEXT }}>{plan.name}</h2>{plan.description && <p className="text-[12px] mt-1" style={{ color: DIM }}>{plan.description}</p>}</div><div className="flex gap-2"><button onClick={onRefresh} disabled={saving} className="tap text-[11px] font-medium cursor-pointer" style={{ color: SAND }}>Forge</button><button onClick={onEdit} className="tap cursor-pointer" style={{ color: SAND }}><Pencil size={16} /></button><button onClick={onDelete} className="tap cursor-pointer" style={{ color: DIM }}><Trash2 size={16} /></button></div></div>
      <p className="text-[11px] mt-3" style={{ color: DIM }}>{plan.exercises.length} Übungen · unabhängig von Hevy gespeichert</p>
    </div>
    {plan.exercises.map((entry, index) => <div key={entry.id} className="card-forge overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>Übung {index + 1}</p><h3 className="font-semibold text-[15px] mt-1" style={{ color: TEXT }}>{entry.exercise.name}</h3><p className="text-[11px] mt-1" style={{ color: DIM }}>{entry.exercise.primary_muscle_group} · {entry.machine_profile ? `Maschine · ${entry.machine_profile.name}` : equipmentLabel(entry.exercise.equipment)}</p></div><Dumbbell size={18} style={{ color: 'rgba(232,197,138,0.62)' }} /></div>
      <SetRows sets={entry.sets} />
      {entry.notes && <p className="px-4 py-3 text-[11px] border-t" style={{ color: DIM, borderColor: 'rgba(255,247,235,0.06)' }}>{entry.notes}</p>}
    </div>)}
  </div>;
}

function SetRows({ sets }: { sets: ForgePlan['exercises'][number]['sets'] }) {
  return <div className="border-t" style={{ borderColor: 'rgba(255,247,235,0.06)' }}>
    <div className="grid px-4 py-2 text-[9px] uppercase tracking-wider" style={{ gridTemplateColumns: '44px 1fr 1fr 1fr', color: DIM }}><span>Satz</span><span className="text-center">Vorher</span><span className="text-center">Plan</span><span className="text-center">Forge</span></div>
    {sets.map((set, index) => <div key={set.id} className="grid px-4 py-2.5 text-[11px] tabular-nums" style={{ gridTemplateColumns: '44px 1fr 1fr 1fr', background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}><span style={{ color: DIM }}>{set.set_type === 'warmup' ? 'Warm' : index + 1}</span><span className="text-center" style={{ color: DIM }}>{formatSet(set.previous_weight_kg, set.previous_reps)}</span><span className="text-center font-semibold" style={{ color: TEXT }}>{formatSet(set.current_weight_kg, set.current_reps)}</span><span className="text-center" style={{ color: SAND }}>{formatSet(set.coach_suggested_weight_kg, set.coach_suggested_reps)}</span></div>)}
  </div>;
}

function PlanEditor({ draft, exercises, saving, onChange, onToggleExercise, onUpdateSet, onCancel, onSave }: { draft: ForgePlanInput; exercises: ForgeExercise[]; saving: boolean; onChange: (draft: ForgePlanInput) => void; onToggleExercise: (exercise: ForgeExercise) => void; onUpdateSet: (exerciseIndex: number, setIndex: number, key: keyof ForgePlanSetInput, value: number | string | null) => void; onCancel: () => void; onSave: () => void }) {
  return <div className="card-forge p-4 space-y-4">
    <div className="flex items-center justify-between"><h2 className="font-semibold" style={{ color: TEXT }}>Plan bearbeiten</h2><button onClick={onCancel} className="text-[12px] cursor-pointer" style={{ color: DIM }}>Abbrechen</button></div>
    <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="z. B. Pull A" className="input-forge w-full" />
    <input value={draft.description ?? ''} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="Optionaler Fokus" className="input-forge w-full" />
    <div><p className="text-[11px] mb-2" style={{ color: DIM }}>Übungen auswählen</p><div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">{exercises.map((exercise) => { const active = draft.exercises.some((entry) => entry.exercise_id === exercise.id); return <button key={exercise.id} onClick={() => onToggleExercise(exercise)} className="tap shrink-0 rounded-full px-3 py-1.5 text-[11px] cursor-pointer" style={{ color: active ? SAND : DIM, background: active ? 'rgba(232,197,138,0.13)' : 'rgba(255,247,235,0.04)', border: `1px solid ${active ? SAND : BORDER}` }}>{active ? '✓ ' : ''}{exercise.name}</button>; })}</div></div>
    {draft.exercises.map((entry, exerciseIndex) => {
      const exercise = exercises.find((item) => item.id === entry.exercise_id); if (!exercise) return null; return <div key={entry.exercise_id} className="rounded-2xl p-3 space-y-3" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between"><p className="text-[13px] font-medium" style={{ color: TEXT }}>{exercise.name}</p>{exercise.machine_profiles.length > 0 && <select value={entry.machine_profile_id ?? ''} onChange={(event) => { const next = structuredClone(draft); next.exercises[exerciseIndex].machine_profile_id = event.target.value || null; onChange(next); }} className="bg-transparent text-[10px] outline-none" style={{ color: SAND }}><option value="">Profil</option>{exercise.machine_profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>}</div>
        {entry.sets.map((set, setIndex) => <div key={setIndex} className="grid gap-2" style={{ gridTemplateColumns: '38px 1fr 1fr 28px' }}><span className="self-center text-[10px]" style={{ color: DIM }}>S{setIndex + 1}</span><input value={set.current_weight_kg ?? ''} inputMode="decimal" onChange={(event) => onUpdateSet(exerciseIndex, setIndex, 'current_weight_kg', event.target.value === '' ? null : Number(event.target.value))} placeholder="kg" className="input-forge min-w-0 !px-2 !py-2 text-[11px]" /><input value={set.current_reps ?? ''} inputMode="numeric" onChange={(event) => onUpdateSet(exerciseIndex, setIndex, 'current_reps', event.target.value === '' ? null : Number(event.target.value))} placeholder="Wdh." className="input-forge min-w-0 !px-2 !py-2 text-[11px]" /><button onClick={() => { const next = structuredClone(draft); next.exercises[exerciseIndex].sets.splice(setIndex, 1); onChange(next); }} className="tap cursor-pointer" style={{ color: DIM }}><Trash2 size={14} /></button></div>)}
        <button onClick={() => { const next = structuredClone(draft); next.exercises[exerciseIndex].sets.push({ set_type: 'working', current_weight_kg: null, current_reps: 10, coach_suggested_weight_kg: null, coach_suggested_reps: null, note: '' }); onChange(next); }} className="tap text-[11px] flex items-center gap-1 cursor-pointer" style={{ color: SAND }}><Plus size={13} />Satz</button>
      </div>;
    })}
    <button onClick={onSave} disabled={saving} className="btn-forge w-full flex justify-center items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Plan speichern</button>
  </div>;
}

function ExerciseEditor({ draft, saving, onChange, onToggleSecondary, onUpdateProfile, onCancel, onSave }: { draft: ForgeExerciseInput; saving: boolean; onChange: (draft: ForgeExerciseInput) => void; onToggleSecondary: (muscle: string) => void; onUpdateProfile: (index: number, key: keyof ForgeMachineProfileInput, value: string) => void; onCancel: () => void; onSave: () => void }) {
  return <div className="card-forge p-4 space-y-4"><div className="flex justify-between"><h2 className="font-semibold" style={{ color: TEXT }}>Übung bearbeiten</h2><button onClick={onCancel} className="text-[12px] cursor-pointer" style={{ color: DIM }}>Abbrechen</button></div>
    <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 82px' }}><input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Übungsname" className="input-forge min-w-0" /><input value={draft.icon} onChange={(event) => onChange({ ...draft, icon: event.target.value })} placeholder="Icon" className="input-forge min-w-0" /></div>
    <select value={draft.primary_muscle_group} onChange={(event) => onChange({ ...draft, primary_muscle_group: event.target.value })} className="input-forge w-full"><option value="">Primäre Muskelgruppe</option>{MUSCLE_GROUPS.map((group) => <option key={group}>{group}</option>)}</select>
    <div><p className="text-[11px] mb-2" style={{ color: DIM }}>Equipment</p><div className="flex flex-wrap gap-1.5">{EQUIPMENT.map((item) => <button key={item.value} onClick={() => onChange({ ...draft, equipment: item.value, machine_profiles: item.value === 'machine' ? draft.machine_profiles : [] })} className="tap rounded-full px-2.5 py-1.5 text-[10px] cursor-pointer" style={{ color: draft.equipment === item.value ? SAND : DIM, border: `1px solid ${draft.equipment === item.value ? SAND : BORDER}` }}>{item.label}</button>)}</div></div>
    <div><p className="text-[11px] mb-2" style={{ color: DIM }}>Sekundäre Muskeln</p><div className="flex flex-wrap gap-1.5">{MUSCLE_GROUPS.filter((group) => group !== draft.primary_muscle_group).map((group) => <button key={group} onClick={() => onToggleSecondary(group)} className="tap rounded-full px-2.5 py-1.5 text-[10px] cursor-pointer" style={{ color: draft.secondary_muscle_groups.includes(group) ? SAND : DIM, background: draft.secondary_muscle_groups.includes(group) ? 'rgba(232,197,138,0.12)' : 'transparent', border: `1px solid ${BORDER}` }}>{group}</button>)}</div></div>
    {draft.equipment === 'machine' && <div className="space-y-2"><div className="flex justify-between"><div><p className="text-[11px]" style={{ color: DIM }}>Maschinenprofile</p><p className="text-[10px] mt-0.5" style={{ color: DIM }}>Gewichtsstufen z. B. „Gewichte: 5, 12, 19, 26“</p></div><button onClick={() => onChange({ ...draft, machine_profiles: [...draft.machine_profiles, { name: '', model: '', notes: '' }] })} className="tap text-[11px] cursor-pointer" style={{ color: SAND }}><Plus size={13} /></button></div>{draft.machine_profiles.map((profile, index) => <div key={index} className="grid gap-2" style={{ gridTemplateColumns: '1fr 28px' }}><div className="space-y-2"><input value={profile.name} onChange={(event) => onUpdateProfile(index, 'name', event.target.value)} placeholder="z. B. Life Fitness" className="input-forge min-w-0 w-full text-[11px]" /><input value={profile.notes ?? ''} onChange={(event) => onUpdateProfile(index, 'notes', event.target.value)} placeholder="Gewichte: 5, 12, 19, 26" className="input-forge min-w-0 w-full text-[11px]" /></div><button onClick={() => onChange({ ...draft, machine_profiles: draft.machine_profiles.filter((_, profileIndex) => profileIndex !== index) })} className="tap cursor-pointer self-start mt-2" style={{ color: DIM }}><Trash2 size={14} /></button></div>)}</div>}
    <button onClick={onSave} disabled={saving} className="btn-forge w-full flex justify-center items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Übung speichern</button>
  </div>;
}

function ExerciseCard({ exercise, onEdit, onDelete }: { exercise: ForgeExercise; onEdit: () => void; onDelete: () => void }) {
  return <div className="card-forge p-4 flex items-center gap-3"><div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,197,138,0.11)', color: SAND }}><Dumbbell size={17} /></div><div className="min-w-0 flex-1"><h3 className="text-[13px] font-medium truncate" style={{ color: TEXT }}>{exercise.name}</h3><p className="text-[11px] truncate mt-0.5" style={{ color: DIM }}>{equipmentLabel(exercise.equipment)} · {exercise.primary_muscle_group}{exercise.secondary_muscle_groups.length ? ` + ${exercise.secondary_muscle_groups.join(', ')}` : ''}</p>{exercise.machine_profiles.length > 0 && <p className="text-[10px] mt-1" style={{ color: SAND }}>{exercise.machine_profiles.map((profile) => profile.name).join(' · ')}</p>}</div><button onClick={onEdit} className="tap cursor-pointer" style={{ color: SAND }}><Pencil size={15} /></button><button onClick={onDelete} className="tap cursor-pointer" style={{ color: DIM }}><Trash2 size={15} /></button></div>;
}

function EmptyState({ icon, title, copy, action, onClick }: { icon: React.ReactNode; title: string; copy: string; action: string; onClick: () => void }) {
  return <div className="card-forge p-7 text-center"><div className="mx-auto w-10 h-10 rounded-2xl flex items-center justify-center" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{icon}</div><h2 className="text-[15px] font-semibold mt-3" style={{ color: TEXT }}>{title}</h2><p className="text-[12px] leading-relaxed mt-1.5" style={{ color: DIM }}>{copy}</p><button onClick={onClick} className="tap mt-4 text-[12px] font-medium cursor-pointer" style={{ color: SAND }}>{action}</button></div>;
}

function equipmentLabel(equipment: ForgeEquipment) { return EQUIPMENT.find((item) => item.value === equipment)?.label ?? equipment; }


function ProgramSummary({ program, onEdit, onCreate }: { program: ForgeProgram | null; onEdit: () => void; onCreate: () => void }) {
  if (!program) return <div className="card-forge p-4 flex items-center justify-between gap-3" style={{ borderColor: `${SAND}20` }}><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>Ablauf</p><p className="text-[13px] font-medium mt-1" style={{ color: TEXT }}>Noch kein aktiver Trainingsplan</p><p className="text-[11px] mt-1" style={{ color: DIM }}>Lege fest, ob Routinen rotieren oder an Wochentagen stattfinden.</p></div><button onClick={onCreate} className="tap text-[12px] font-medium cursor-pointer" style={{ color: SAND }}>Einrichten</button></div>;
  return <div className="card-forge p-4 flex items-center justify-between gap-3" style={{ borderColor: `${SAND}20` }}><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>{program.mode === 'rotation' ? 'Rotation' : 'Wochenplan'}</p><p className="text-[14px] font-semibold mt-1" style={{ color: TEXT }}>{program.name}</p><p className="text-[11px] mt-1" style={{ color: DIM }}>{program.routines.length} Routinen · {program.mode === 'rotation' ? `als Nächstes: ${program.routines[program.rotation_cursor % Math.max(1, program.routines.length)]?.plan.name ?? '—'}` : 'nach Wochentagen geplant'}</p></div><button onClick={onEdit} className="tap cursor-pointer" style={{ color: SAND }}><Pencil size={16} /></button></div>;
}

function ProgramEditor({ draft, plans, saving, onChange, onToggleRoutine, onCancel, onSave }: { draft: ForgeProgramInput; plans: ForgePlan[]; saving: boolean; onChange: (draft: ForgeProgramInput) => void; onToggleRoutine: (plan: ForgePlan) => void; onCancel: () => void; onSave: () => void }) {
  const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const toggleDay = (planId: string, day: number) => onChange({ ...draft, routines: draft.routines.map((routine) => routine.plan_id !== planId ? routine : { ...routine, weekdays: routine.weekdays.includes(day) ? routine.weekdays.filter((item) => item !== day) : [...routine.weekdays, day] }) });
  return <div className="card-forge p-4 space-y-4" style={{ borderColor: `${SAND}28` }}><div className="flex justify-between"><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>Ablauf</p><h2 className="text-[16px] font-semibold mt-1" style={{ color: TEXT }}>Trainingsplan einrichten</h2></div><button onClick={onCancel} className="text-[12px] cursor-pointer" style={{ color: DIM }}>Abbrechen</button></div><input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} className="input-forge w-full" placeholder="Name des Plans" /><div className="grid grid-cols-2 gap-2">{([['rotation', 'Rotierend'], ['weekly', 'Wöchentlich']] as const).map(([mode, label]) => <button key={mode} onClick={() => onChange({ ...draft, mode, routines: draft.routines.map((routine) => ({ ...routine, weekdays: mode === 'rotation' ? [] : routine.weekdays })) })} className="tap rounded-xl py-2.5 text-[12px] cursor-pointer" style={{ color: draft.mode === mode ? SAND : DIM, border: `1px solid ${draft.mode === mode ? SAND : BORDER}`, background: draft.mode === mode ? 'rgba(232,197,138,0.1)' : 'transparent' }}>{label}</button>)}</div><p className="text-[11px] leading-relaxed" style={{ color: DIM }}>{draft.mode === 'rotation' ? 'Forge zeigt immer die nächste Routine. Erst nach Abschluss der Session springt die Rotation weiter.' : 'Ordne jeder Routine mindestens einen Wochentag zu. Auf Home erscheint nur, was heute ansteht.'}</p><div className="space-y-2">{plans.map((plan) => { const routine = draft.routines.find((item) => item.plan_id === plan.id); return <div key={plan.id} className="rounded-xl px-3 py-3" style={{ background: 'rgba(255,247,235,0.035)' }}><div className="flex justify-between items-center"><button onClick={() => onToggleRoutine(plan)} className="text-left text-[12px] cursor-pointer" style={{ color: routine ? TEXT : DIM }}>{routine ? '✓ ' : ''}{plan.name}</button>{routine && draft.mode === 'weekly' && <div className="flex gap-1">{dayLabels.map((label, day) => <button key={label} onClick={() => toggleDay(plan.id, day)} className="tap w-6 h-6 rounded-full text-[9px] cursor-pointer" style={{ color: routine.weekdays.includes(day) ? '#16130f' : DIM, background: routine.weekdays.includes(day) ? SAND : 'rgba(255,247,235,0.06)' }}>{label}</button>)}</div>}</div></div>; })}</div><button onClick={onSave} disabled={saving} className="btn-forge w-full flex items-center justify-center gap-2">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Ablauf speichern</button></div>;
}
