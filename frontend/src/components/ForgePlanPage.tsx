import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, BookOpen, CalendarDays, ChevronRight, Clock3, Dumbbell, History, Library, Loader2, Pencil, Plus, RotateCw, Save, Trash2 } from 'lucide-react';
import { createForgeProgram, deleteForgePlan, getForgePlans, getForgePrograms, updateForgeProgram } from '../api/api';
import type { ForgePlan, ForgeProgram, ForgeProgramInput } from '../api/api';
import ConfirmDialog from './ConfirmDialog';
import ForgePlanImagePreview from './ForgePlanImagePreview';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const setCount = (plan: ForgePlan) => plan.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);

export default function ForgePlanPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<ForgePlan[]>([]);
  const [programs, setPrograms] = useState<ForgeProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProgram, setEditingProgram] = useState(false);
  const [programDraft, setProgramDraft] = useState<ForgeProgramInput | null>(null);
  const [deletePlan, setDeletePlan] = useState<ForgePlan | null>(null);
  const activeProgram = useMemo(() => programs.find((program) => program.is_active) ?? programs[0] ?? null, [programs]);

  useEffect(() => {
    Promise.all([getForgePlans(), getForgePrograms()])
      .then(([loadedPlans, loadedPrograms]) => { setPlans(loadedPlans.sort((a, b) => a.position - b.position)); setPrograms(loadedPrograms); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Forge konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  const startProgramEdit = () => {
    setProgramDraft(activeProgram ? {
      name: activeProgram.name, mode: activeProgram.mode, is_active: activeProgram.is_active,
      routines: activeProgram.routines.map((routine) => ({ plan_id: routine.plan.id, weekdays: routine.weekdays })),
    } : { name: 'Mein Trainingsplan', mode: 'rotation', is_active: true, routines: plans.map((plan) => ({ plan_id: plan.id, weekdays: [] })) });
    setEditingProgram(true);
  };

  const saveProgram = async () => {
    if (!programDraft?.name.trim()) return;
    setSaving(true); setError(null);
    try {
      const saved = activeProgram ? await updateForgeProgram(activeProgram.id, programDraft) : await createForgeProgram(programDraft);
      setPrograms((current) => [...current.filter((program) => program.id !== saved.id), saved]);
      setEditingProgram(false);
    } catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Ablauf konnte nicht gespeichert werden.'); }
    finally { setSaving(false); }
  };

  const removePlan = async () => {
    if (!deletePlan) return;
    setSaving(true); setError(null);
    try { await deleteForgePlan(deletePlan.id); setPlans((current) => current.filter((plan) => plan.id !== deletePlan.id)); setDeletePlan(null); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Trainingstag konnte nicht gelöscht werden.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

  const nextRoutine = activeProgram?.mode === 'rotation' && activeProgram.routines.length
    ? activeProgram.routines[activeProgram.rotation_cursor % activeProgram.routines.length]?.plan.name
    : null;

  return <div className="space-y-5 forge-anim">
    <header><p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: SAND }}>Forge Plan</p><h1 className="mt-1 text-[28px] font-semibold tracking-tight" style={{ color: TEXT }}>Dein Training</h1><p className="mt-1 text-[12px]" style={{ color: DIM }}>Klare Tage. Eine feste Reihenfolge. Volle Konzentration.</p></header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <section className="rounded-[22px] p-4" style={{ background: 'linear-gradient(135deg, rgba(232,197,138,0.12), rgba(255,247,235,0.025))', border: `1px solid ${SAND}33` }}>
      {editingProgram && programDraft ? <div className="space-y-3">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Programm</p><h2 className="mt-1 text-[16px] font-semibold" style={{ color: TEXT }}>Ablauf bearbeiten</h2></div><button onClick={() => setEditingProgram(false)} className="text-[11px]" style={{ color: DIM }}>Abbrechen</button></div>
        <input value={programDraft.name} onChange={(event) => setProgramDraft({ ...programDraft, name: event.target.value })} className="input-forge w-full" placeholder="Programmname" />
        <div className="grid grid-cols-2 gap-2">{(['rotation', 'weekly'] as const).map((mode) => <button key={mode} onClick={() => {
          if (mode === 'rotation') {
            setProgramDraft({ ...programDraft, mode, routines: programDraft.routines.map((routine) => ({ ...routine, weekdays: [] })) });
            return;
          }
          const merged = new Map<string, number[]>();
          programDraft.routines.forEach((routine) => merged.set(routine.plan_id, [...new Set([...(merged.get(routine.plan_id) ?? []), ...routine.weekdays])].sort()));
          setProgramDraft({ ...programDraft, mode, routines: [...merged].map(([plan_id, weekdays]) => ({ plan_id, weekdays })) });
        }} className="tap rounded-xl py-2 text-[11px]" style={{ color: programDraft.mode === mode ? SAND : DIM, border: `1px solid ${programDraft.mode === mode ? SAND : BORDER}` }}>{mode === 'rotation' ? 'Rotation' : 'Wochenplan'}</button>)}</div>
        {programDraft.mode === 'rotation' ? <div className="space-y-3">
          <div className="space-y-2">{programDraft.routines.map((routine, index) => { const plan = plans.find((item) => item.id === routine.plan_id); return <div key={`${routine.plan_id}-${index}`} className="flex items-center gap-2 rounded-xl p-3" style={{ background: 'rgba(255,247,235,0.035)' }}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ color: '#16130f', background: SAND }}>{index + 1}</span><span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: TEXT }}>{plan?.name ?? 'Unbekannter Trainingstag'}</span><button onClick={() => { const routines = [...programDraft.routines];[routines[index - 1], routines[index]] = [routines[index], routines[index - 1]]; setProgramDraft({ ...programDraft, routines }); }} disabled={index === 0} className="tap p-1 disabled:opacity-20" aria-label={`${plan?.name ?? 'Trainingstag'} nach oben`} style={{ color: SAND }}><ArrowUp size={14} /></button><button onClick={() => { const routines = [...programDraft.routines];[routines[index], routines[index + 1]] = [routines[index + 1], routines[index]]; setProgramDraft({ ...programDraft, routines }); }} disabled={index === programDraft.routines.length - 1} className="tap p-1 disabled:opacity-20" aria-label={`${plan?.name ?? 'Trainingstag'} nach unten`} style={{ color: SAND }}><ArrowDown size={14} /></button><button onClick={() => setProgramDraft({ ...programDraft, routines: programDraft.routines.filter((_, routineIndex) => routineIndex !== index) })} className="tap p-1" aria-label={`${plan?.name ?? 'Trainingstag'} entfernen`} style={{ color: DIM }}><Trash2 size={14} /></button></div>; })}{!programDraft.routines.length && <p className="rounded-xl p-3 text-[11px]" style={{ color: DIM, background: 'rgba(255,247,235,0.035)' }}>Noch keine Reihenfolge festgelegt.</p>}</div>
          <div><p className="mb-2 text-[10px] uppercase tracking-wider" style={{ color: DIM }}>Trainingstag anhängen</p><div className="flex flex-wrap gap-2">{plans.map((plan) => <button key={plan.id} onClick={() => setProgramDraft({ ...programDraft, routines: [...programDraft.routines, { plan_id: plan.id, weekdays: [] }] })} disabled={programDraft.routines.length >= 30} className="tap rounded-full px-3 py-1.5 text-[10px] disabled:opacity-40" style={{ color: SAND, border: `1px dashed ${BORDER}` }}><Plus size={12} className="mr-1 inline" />{plan.name}</button>)}</div><p className="mt-2 text-[9px]" style={{ color: DIM }}>Ein Tag darf mehrfach vorkommen, zum Beispiel Push · Pull · Push.</p></div>
        </div> : <div className="space-y-2">{plans.map((plan) => { const routine = programDraft.routines.find((item) => item.plan_id === plan.id); return <div key={plan.id} className="rounded-xl p-3" style={{ background: 'rgba(255,247,235,0.035)' }}><div className="flex items-center justify-between gap-3"><span className="text-[12px]" style={{ color: TEXT }}>{plan.name}</span><button onClick={() => setProgramDraft({ ...programDraft, routines: routine ? programDraft.routines.filter((item) => item.plan_id !== plan.id) : [...programDraft.routines, { plan_id: plan.id, weekdays: [] }] })} className="text-[11px]" style={{ color: routine ? SAND : DIM }}>{routine ? 'Enthalten' : 'Hinzufügen'}</button></div>{routine && <div className="mt-2 flex justify-between gap-1">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day, index) => <button key={day} onClick={() => { const weekdays = routine.weekdays.includes(index) ? routine.weekdays.filter((value) => value !== index) : [...routine.weekdays, index].sort(); setProgramDraft({ ...programDraft, routines: programDraft.routines.map((item) => item.plan_id === plan.id ? { ...item, weekdays } : item) }); }} className="h-7 w-7 rounded-full text-[9px]" style={{ color: routine.weekdays.includes(index) ? '#16130f' : DIM, background: routine.weekdays.includes(index) ? SAND : 'rgba(255,247,235,0.06)' }}>{day}</button>)}</div>}</div>; })}</div>}
        <button onClick={() => void saveProgram()} disabled={saving} className="btn-forge flex w-full items-center justify-center gap-2"><Save size={14} />Ablauf speichern</button>
      </div> : <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ color: SAND, background: 'rgba(232,197,138,0.12)' }}>{activeProgram?.mode === 'weekly' ? <CalendarDays size={19} /> : <RotateCw size={19} />}</div><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{activeProgram?.mode === 'weekly' ? 'Wochenplan' : 'Rotation'}</p><h2 className="mt-1 truncate text-[15px] font-semibold" style={{ color: TEXT }}>{activeProgram?.name ?? 'Noch kein Programm'}</h2><p className="mt-1 text-[11px]" style={{ color: DIM }}>{activeProgram ? `${activeProgram.routines.length} Trainingstage${nextRoutine ? ` · als Nächstes ${nextRoutine}` : ''}` : 'Lege Reihenfolge oder Wochentage fest.'}</p></div><button onClick={startProgramEdit} className="tap p-2" aria-label="Programm bearbeiten" style={{ color: SAND }}><Pencil size={16} /></button></div>}
    </section>

    <div className="grid grid-cols-2 gap-2"><button onClick={() => navigate('/forge/exercises')} className="card-forge tap flex items-center gap-3 p-3 text-left"><Library size={17} style={{ color: SAND }} /><span><span className="block text-[12px] font-medium" style={{ color: TEXT }}>Übungen</span><span className="text-[9px]" style={{ color: DIM }}>Bibliothek & Maschinen</span></span></button><button onClick={() => navigate('/forge/history')} className="card-forge tap flex items-center gap-3 p-3 text-left"><History size={17} style={{ color: SAND }} /><span><span className="block text-[12px] font-medium" style={{ color: TEXT }}>Verlauf</span><span className="text-[9px]" style={{ color: DIM }}>Abgeschlossene Einheiten</span></span></button></div>

    <section className="space-y-3"><div className="flex items-end justify-between"><div><p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: SAND }}>Trainingstage</p><h2 className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>{plans.length ? `${plans.length} Einheiten` : 'Noch keine Einheiten'}</h2></div><button onClick={() => navigate('/forge/days/new')} className="tap flex items-center gap-1.5 text-[11px] font-medium" style={{ color: SAND }}><Plus size={14} />Neuer Tag</button></div>
      {plans.map((plan) => <article key={plan.id} className={`card-forge relative overflow-hidden ${plan.has_image ? 'flex gap-2 p-2' : ''}`} style={{ borderColor: `${SAND}22` }}>{plan.has_image && <ForgePlanImagePreview plan={plan} className="w-24 self-stretch rounded-xl sm:w-36" />}<div className={plan.has_image ? 'min-w-0 flex-1 py-3 pr-3 pl-0' : 'w-full'}><button onClick={() => navigate(`/forge/days/${plan.id}`)} className={`tap flex w-full items-center gap-4 text-left ${plan.has_image ? 'py-5 pr-5 pl-0' : 'p-5'}`}><span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-semibold" style={{ color: TEXT }}>{plan.name}</span><span className="mt-1 block truncate text-[11px]" style={{ color: DIM }}>{plan.description || (plan.plan_type === 'course' ? 'Kurs' : 'Freier Trainingsfokus')}</span><span className="mt-2 flex items-center gap-3 text-[10px]" style={{ color: SAND }}>{plan.plan_type === 'course' ? <><Clock3 size={12} />{plan.default_duration_minutes} Min. Kurs</> : <><Dumbbell size={12} />{plan.exercises.length} Übungen <span>·</span> {setCount(plan)} Sätze</>}</span></span><ChevronRight size={19} style={{ color: DIM }} /></button><div className={`flex justify-end gap-4 border-t py-2.5 ${plan.has_image ? 'pr-5 pl-0' : 'px-5'}`} style={{ borderColor: 'rgba(255,247,235,0.06)' }}><button onClick={() => navigate(`/forge/days/${plan.id}/edit`)} className="tap flex items-center gap-1 text-[10px]" style={{ color: SAND }}><Pencil size={13} />Bearbeiten</button><button onClick={() => setDeletePlan(plan)} className="tap flex items-center gap-1 text-[10px]" style={{ color: DIM }}><Trash2 size={13} />Löschen</button></div></div></article>)}
      {!plans.length && <div className="card-forge p-7 text-center"><BookOpen className="mx-auto" size={24} style={{ color: SAND }} /><p className="mt-3 text-[14px] font-medium" style={{ color: TEXT }}>Baue deinen ersten Trainingstag</p><p className="mt-1 text-[11px]" style={{ color: DIM }}>Übungen auswählen, Reihenfolge festlegen, Wiederholungen planen.</p><button onClick={() => navigate('/forge/days/new')} className="btn-forge mt-4 inline-flex items-center gap-2"><Plus size={14} />Trainingstag erstellen</button></div>}
    </section>
    <ConfirmDialog open={Boolean(deletePlan)} busy={saving} destructive title="Trainingstag löschen?" description={deletePlan ? `„${deletePlan.name}“ wird dauerhaft entfernt.` : ''} confirmLabel="Trainingstag löschen" onCancel={() => setDeletePlan(null)} onConfirm={() => void removePlan()} />
  </div>;
}
