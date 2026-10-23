import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CalendarDays, ChevronRight, Clock3, Copy, GripVertical, History, Library, Loader2, MoreHorizontal, Pencil, Plus, RotateCw, Settings2, Share, Trash2, X } from 'lucide-react';
import { createForgePlan, createForgeProgram, deleteForgePlan, getForgePlans, getForgePrograms, updateForgeProgram } from '../api/api';
import type { ForgePlan, ForgePlanInput, ForgeProgram, ForgeProgramInput } from '../api/api';
import ConfirmDialog from './ConfirmDialog';
import ForgePlanImagePreview from './ForgePlanImagePreview';
import ForgeProgramExportDialog from './ForgeProgramExportDialog';
import ForgeSheet from './ForgeSheet';
import SortableList from './forge/SortableList';
import { estimateMinutes, muscleLabel, planMuscleFocus } from './forge/labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const planStats = (plan: ForgePlan) => {
  const rows = plan.exercises.map((entry) => ({
    warmups: entry.sets.filter((set) => set.set_type === 'warmup').length,
    workings: entry.sets.filter((set) => set.set_type === 'working').length,
  }));
  return { sets: rows.reduce((sum, row) => sum + row.workings, 0), minutes: estimateMinutes(rows) };
};

/** Copy only the structure of a plan (exercises, set types, profiles, notes). */
const copyInput = (plan: ForgePlan, position: number): ForgePlanInput => ({
  name: `${plan.name} (Kopie)`.slice(0, 255),
  description: plan.description,
  plan_type: plan.plan_type,
  default_duration_minutes: plan.default_duration_minutes,
  position,
  exercises: plan.exercises.map((entry) => ({
    exercise_id: entry.exercise.id,
    machine_profile_id: entry.machine_profile?.id ?? null,
    notes: entry.notes,
    sets: entry.sets.map((set) => ({ set_type: set.set_type })),
  })),
});

type RoutineDraft = { key: string; plan_id: string; weekdays: number[] };

export default function ForgePlanPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<ForgePlan[]>([]);
  const [programs, setPrograms] = useState<ForgeProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programSheet, setProgramSheet] = useState(false);
  const [programName, setProgramName] = useState('');
  const [programMode, setProgramMode] = useState<ForgeProgramInput['mode']>('rotation');
  const [routines, setRoutines] = useState<RoutineDraft[]>([]);
  const [menuPlan, setMenuPlan] = useState<ForgePlan | null>(null);
  const [deletePlan, setDeletePlan] = useState<ForgePlan | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const activeProgram = useMemo(() => programs.find((program) => program.is_active) ?? programs[0] ?? null, [programs]);
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);

  useEffect(() => {
    Promise.all([getForgePlans(), getForgePrograms()])
      .then(([loadedPlans, loadedPrograms]) => { setPlans(loadedPlans.sort((a, b) => a.position - b.position)); setPrograms(loadedPrograms); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Forge konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  const openProgram = () => {
    setProgramName(activeProgram?.name ?? 'Mein Trainingsplan');
    setProgramMode(activeProgram?.mode ?? 'rotation');
    setRoutines(activeProgram
      ? activeProgram.routines.map((routine) => ({ key: crypto.randomUUID(), plan_id: routine.plan.id, weekdays: routine.weekdays }))
      : plans.map((plan) => ({ key: crypto.randomUUID(), plan_id: plan.id, weekdays: [] })));
    setProgramSheet(true);
  };

  const switchMode = (mode: ForgeProgramInput['mode']) => {
    if (mode === programMode) return;
    setProgramMode(mode);
    if (mode === 'rotation') { setRoutines((current) => current.map((routine) => ({ ...routine, weekdays: [] }))); return; }
    // A weekly plan lists each routine once and merges its days.
    setRoutines((current) => {
      const merged = new Map<string, number[]>();
      current.forEach((routine) => merged.set(routine.plan_id, [...new Set([...(merged.get(routine.plan_id) ?? []), ...routine.weekdays])].sort()));
      return [...merged].map(([plan_id, weekdays]) => ({ key: crypto.randomUUID(), plan_id, weekdays }));
    });
  };

  const toggleWeekday = (planId: string, day: number) => setRoutines((current) => {
    const existing = current.find((routine) => routine.plan_id === planId);
    if (!existing) return [...current, { key: crypto.randomUUID(), plan_id: planId, weekdays: [day] }];
    const weekdays = existing.weekdays.includes(day) ? existing.weekdays.filter((value) => value !== day) : [...existing.weekdays, day].sort();
    return weekdays.length ? current.map((routine) => (routine.plan_id === planId ? { ...routine, weekdays } : routine)) : current.filter((routine) => routine.plan_id !== planId);
  });

  const saveProgram = async () => {
    if (!programName.trim()) { setError('Gib dem Programm einen Namen.'); return; }
    setBusy(true); setError(null);
    try {
      const input: ForgeProgramInput = { name: programName.trim(), mode: programMode, is_active: true, routines: routines.map(({ plan_id, weekdays }) => ({ plan_id, weekdays })) };
      const saved = activeProgram ? await updateForgeProgram(activeProgram.id, input) : await createForgeProgram(input);
      setPrograms((current) => [...current.filter((program) => program.id !== saved.id), saved]);
      setProgramSheet(false);
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Ablauf konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  };

  const duplicate = async (plan: ForgePlan) => {
    setMenuPlan(null); setBusy(true); setError(null);
    try { const copy = await createForgePlan(copyInput(plan, plans.length)); setPlans((current) => [...current, copy]); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht dupliziert werden.'); }
    finally { setBusy(false); }
  };

  const removePlan = async () => {
    if (!deletePlan) return;
    setBusy(true); setError(null);
    try {
      await deleteForgePlan(deletePlan.id);
      setPlans((current) => current.filter((plan) => plan.id !== deletePlan.id));
      setPrograms(await getForgePrograms());
      setDeletePlan(null);
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht gelöscht werden.'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

  const nextRoutine = activeProgram?.mode === 'rotation' && activeProgram.routines.length
    ? activeProgram.routines[activeProgram.rotation_cursor % activeProgram.routines.length]?.plan.name
    : null;
  const programSummary = activeProgram
    ? activeProgram.mode === 'rotation'
      ? activeProgram.routines.map((routine) => routine.plan.name).join(' → ')
      : activeProgram.routines.map((routine) => `${routine.weekdays.map((day) => WEEKDAYS[day]).join('/')} ${routine.plan.name}`).join(' · ')
    : 'Leg fest, in welcher Reihenfolge oder an welchen Tagen du trainierst.';

  return <div className="space-y-5 forge-anim">
    <header><h1 className="text-[28px] font-semibold tracking-tight" style={{ color: TEXT }}>Dein Training</h1><p className="mt-1 text-[12.5px]" style={{ color: DIM }}>Programm, Trainingstage und Übungen</p></header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <section className="rounded-[22px] p-4" style={{ background: 'linear-gradient(135deg, rgba(232,197,138,0.12), rgba(255,247,235,0.025))', border: `1px solid ${SAND}33` }}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ color: SAND, background: 'rgba(232,197,138,0.12)' }}>{activeProgram?.mode === 'weekly' ? <CalendarDays size={20} /> : <RotateCw size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{activeProgram ? activeProgram.mode === 'weekly' ? 'Wochenplan' : 'Rotation' : 'Programm'}</p>
          <h2 className="mt-0.5 truncate text-[16px] font-semibold" style={{ color: TEXT }}>{activeProgram?.name ?? 'Noch kein Programm'}</h2>
          <p className="mt-1 text-[12px] leading-snug" style={{ color: DIM }}>{programSummary}</p>
          {nextRoutine && <p className="mt-1.5 text-[12px]" style={{ color: SAND }}>Als Nächstes: {nextRoutine}</p>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={openProgram} disabled={!plans.length} className="tap flex h-11 items-center justify-center gap-2 rounded-xl text-[13px] font-medium disabled:opacity-40" style={{ color: '#16130f', background: SAND }}><Pencil size={15} />{activeProgram ? 'Ablauf bearbeiten' : 'Programm anlegen'}</button>
        <button type="button" onClick={() => setExportOpen(true)} disabled={!activeProgram} className="tap flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-30" aria-label="Programm exportieren" style={{ color: SAND, border: `1px solid ${SAND}44` }}><Share size={16} /></button>
      </div>
    </section>

    <div className="grid grid-cols-3 gap-2">
      {[
        { icon: <Library size={18} />, label: 'Übungen', to: '/forge/exercises' },
        { icon: <Settings2 size={18} />, label: 'Geräte', to: '/forge/machine-profiles' },
        { icon: <History size={18} />, label: 'Verlauf', to: '/forge/history' },
      ].map((item) => <button key={item.to} type="button" onClick={() => navigate(item.to)} className="card-forge tap flex h-[72px] flex-col items-center justify-center gap-1.5 text-[12.5px] font-medium" style={{ color: TEXT }}><span style={{ color: SAND }}>{item.icon}</span>{item.label}</button>)}
    </div>

    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>Trainingstage</h2>
        <button type="button" onClick={() => navigate('/forge/days/new')} className="tap flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><Plus size={15} />Neuer Tag</button>
      </div>
      {plans.map((plan) => {
        const stats = planStats(plan);
        const focus = planMuscleFocus(plan);
        return <article key={plan.id} className="card-forge relative flex overflow-hidden" style={{ borderColor: `${SAND}22` }}>
          {plan.has_image && <ForgePlanImagePreview plan={plan} className="m-2 mr-0 w-20 shrink-0 self-stretch rounded-xl" />}
          <button type="button" onClick={() => navigate(`/forge/days/${plan.id}`)} className="tap min-w-0 flex-1 p-4 text-left">
            <span className="block truncate text-[16.5px] font-semibold" style={{ color: TEXT }}>{plan.name}</span>
            {plan.description && <span className="mt-0.5 block line-clamp-2 text-[12px] leading-snug" style={{ color: DIM }}>{plan.description}</span>}
            <span className="mt-2 flex items-center gap-1.5 text-[12px] tabular-nums" style={{ color: SAND }}>
              {plan.plan_type === 'course' ? <><Clock3 size={13} />Kurs · {plan.default_duration_minutes} Min</> : <>{plan.exercises.length} Übungen · {stats.sets} Sätze · ca. {stats.minutes} Min</>}
            </span>
            {focus.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{focus.map((muscle) => <span key={muscle} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ color: TEXT, background: 'rgba(255,247,235,0.06)' }}>{muscleLabel(muscle)}</span>)}</span>}
          </button>
          <button type="button" onClick={() => setMenuPlan(plan)} className="tap flex w-12 shrink-0 items-start justify-center pt-4" aria-label={`Aktionen für ${plan.name}`} style={{ color: DIM }}><MoreHorizontal size={19} /></button>
        </article>;
      })}
      {!plans.length && <div className="card-forge p-7 text-center"><BookOpen className="mx-auto" size={24} style={{ color: SAND }} /><p className="mt-3 text-[15px] font-medium" style={{ color: TEXT }}>Bau deinen ersten Trainingstag</p><p className="mt-1 text-[12px]" style={{ color: DIM }}>Übungen wählen, Reihenfolge festlegen, Satzanzahl planen.</p><button type="button" onClick={() => navigate('/forge/days/new')} className="btn-forge mt-4 inline-flex h-11 items-center gap-2"><Plus size={15} />Trainingstag anlegen</button></div>}
    </section>

    {programSheet && <ForgeSheet label="Programm bearbeiten" onClose={() => setProgramSheet(false)} fullscreen>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: BORDER }}>
        <h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>Ablauf</h2>
        <button type="button" onClick={() => setProgramSheet(false)} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
        <input value={programName} onChange={(event) => setProgramName(event.target.value)} className="input-forge h-12 w-full text-[15px]" placeholder="Programmname" aria-label="Programmname" />
        <div className="grid grid-cols-2 gap-1 rounded-2xl p-1" style={{ background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
          {(['rotation', 'weekly'] as const).map((mode) => <button key={mode} type="button" onClick={() => switchMode(mode)} aria-pressed={programMode === mode} className="tap flex h-11 items-center justify-center gap-2 rounded-xl text-[13px] font-medium" style={{ color: programMode === mode ? '#16130f' : DIM, background: programMode === mode ? SAND : 'transparent' }}>{mode === 'rotation' ? <><RotateCw size={15} />Rotation</> : <><CalendarDays size={15} />Wochenplan</>}</button>)}
        </div>
        {programMode === 'rotation' ? <div className="space-y-3">
          <p className="text-[12px]" style={{ color: DIM }}>Die Tage laufen der Reihe nach durch, egal an welchem Wochentag. Gedrückt halten zum Verschieben.</p>
          <SortableList className="space-y-2" items={routines} getKey={(routine) => routine.key} onReorder={(from, to) => setRoutines((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; })} renderItem={(routine, index) => <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: '#211c15', border: `1px solid ${BORDER}` }}>
            <GripVertical size={16} style={{ color: 'rgba(242,236,226,0.25)' }} aria-hidden="true" />
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ color: '#16130f', background: SAND }}>{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[14px]" style={{ color: TEXT }}>{planById.get(routine.plan_id)?.name ?? 'Gelöschter Tag'}</span>
            <button type="button" data-nodrag onClick={() => setRoutines((current) => current.filter((item) => item.key !== routine.key))} aria-label="Aus Ablauf entfernen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM }}><X size={17} /></button>
          </div>} />
          {!routines.length && <p className="rounded-2xl p-4 text-center text-[12.5px]" style={{ color: DIM, border: `1px dashed ${BORDER}` }}>Noch keine Tage im Ablauf.</p>}
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: DIM }}>Tag anhängen</p>
            <div className="flex flex-wrap gap-1.5">{plans.map((plan) => <button key={plan.id} type="button" disabled={routines.length >= 30} onClick={() => setRoutines((current) => [...current, { key: crypto.randomUUID(), plan_id: plan.id, weekdays: [] }])} className="tap flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] disabled:opacity-40" style={{ color: SAND, border: `1px dashed ${SAND}55` }}><Plus size={14} />{plan.name}</button>)}</div>
            <p className="mt-2 text-[11px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Ein Tag darf mehrfach vorkommen, z. B. Push · Pull · Push.</p>
          </div>
        </div> : <div className="space-y-2">
          <p className="text-[12px]" style={{ color: DIM }}>Tipp die Wochentage an, an denen du den Tag trainierst.</p>
          {plans.map((plan) => {
            const days = routines.find((routine) => routine.plan_id === plan.id)?.weekdays ?? [];
            return <div key={plan.id} className="rounded-2xl p-3" style={{ background: '#211c15', border: `1px solid ${days.length ? `${SAND}44` : BORDER}` }}>
              <p className="truncate text-[14px] font-medium" style={{ color: TEXT }}>{plan.name}</p>
              <div className="mt-2 grid grid-cols-7 gap-1">{WEEKDAYS.map((day, index) => <button key={day} type="button" onClick={() => toggleWeekday(plan.id, index)} aria-pressed={days.includes(index)} className="tap h-10 rounded-xl text-[12px] font-medium" style={{ color: days.includes(index) ? '#16130f' : DIM, background: days.includes(index) ? SAND : 'rgba(255,247,235,0.05)' }}>{day}</button>)}</div>
            </div>;
          })}
        </div>}
      </div>
      <footer className="border-t p-4" style={{ borderColor: BORDER, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <button type="button" onClick={() => void saveProgram()} disabled={busy} className="btn-forge flex h-12 w-full items-center justify-center gap-2 text-[14px]">{busy && <Loader2 size={16} className="animate-spin" />}Ablauf speichern</button>
      </footer>
    </ForgeSheet>}

    {menuPlan && <ForgeSheet label="Aktionen" onClose={() => setMenuPlan(null)}>
      <div className="flex items-center justify-between pb-3"><p className="truncate text-[15px] font-semibold" style={{ color: TEXT }}>{menuPlan.name}</p><button type="button" onClick={() => setMenuPlan(null)} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM }}><X size={18} /></button></div>
      <div className="space-y-1.5">
        {[
          { icon: <Pencil size={18} />, label: 'Bearbeiten', onClick: () => navigate(`/forge/days/${menuPlan.id}`) },
          { icon: <Copy size={18} />, label: 'Duplizieren', onClick: () => void duplicate(menuPlan) },
          { icon: <Trash2 size={18} />, label: 'Löschen', danger: true, onClick: () => { setDeletePlan(menuPlan); setMenuPlan(null); } },
        ].map((item) => <button key={item.label} type="button" onClick={item.onClick} disabled={busy} className="tap flex w-full items-center gap-3 rounded-2xl p-3.5 text-left text-[14px] font-medium disabled:opacity-50" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}`, color: item.danger ? '#fca5a5' : TEXT }}><span style={{ color: item.danger ? '#f87171' : SAND }}>{item.icon}</span>{item.label}<ChevronRight size={16} className="ml-auto" style={{ color: 'rgba(242,236,226,0.3)' }} /></button>)}
      </div>
    </ForgeSheet>}

    {exportOpen && activeProgram && <ForgeProgramExportDialog program={activeProgram} onClose={() => setExportOpen(false)} />}
    <ConfirmDialog open={Boolean(deletePlan)} busy={busy} destructive title="Trainingstag löschen?" description={deletePlan ? `„${deletePlan.name}“ wird dauerhaft entfernt. Dein Trainingsverlauf bleibt erhalten.` : ''} confirmLabel="Löschen" onCancel={() => setDeletePlan(null)} onConfirm={() => void removePlan()} />
  </div>;
}
