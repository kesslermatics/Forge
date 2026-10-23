import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Dumbbell, Loader2, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { deleteForgeExercise, getForgeExerciseHistory, getForgeExercises } from '../api/api';
import type { ForgeExercise, ForgeExerciseHistory, ForgeExerciseHistorySet } from '../api/api';
import ConfirmDialog from './ConfirmDialog';
import ExerciseFormSheet from './forge/ExerciseFormSheet';
import { equipmentLabel, muscleLabel } from './forge/labels';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const MINT = '#83d6ad';
const AXIS_STYLE = { fill: 'rgba(242,236,226,0.45)', fontSize: 10 };

const formatLoad = (weight: number | null, reps: number | null) => {
  if (weight == null && reps == null) return '—';
  return `${weight != null && weight > 0 ? `${weight} kg` : 'BW'}${reps != null ? ` × ${reps}` : ''}`;
};

const estimatedOneRepMax = (set: ForgeExerciseHistorySet) => {
  if (set.actual_weight_kg == null || set.actual_reps == null || set.actual_weight_kg <= 0 || set.actual_reps < 1) return null;
  return set.actual_weight_kg * (1 + set.actual_reps / 30);
};

const shortDate = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(value));
const fullDate = (value: string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value));

export default function ForgeExerciseHistoryPage() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const navigate = useNavigate();
  const [history, setHistory] = useState<ForgeExerciseHistory | null>(null);
  const [machineProfileId, setMachineProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState<ForgeExercise[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!exerciseId) return;
    getForgeExerciseHistory(exerciseId, machineProfileId)
      .then(setHistory)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Übungshistorie konnte nicht geladen werden.'));
  }, [exerciseId, machineProfileId]);

  const chartData = useMemo(() => (history?.sessions ?? []).slice().reverse().flatMap((session) => {
    const logged = session.sets.filter((set) => set.actual_weight_kg != null && set.actual_reps != null);
    if (!logged.length) return [];
    const bestLoad = Math.max(...logged.map((set) => set.actual_weight_kg ?? 0));
    const bestE1rm = Math.max(...logged.map(estimatedOneRepMax).filter((value): value is number => value != null));
    return [{
      date: shortDate(session.completed_at || session.started_at),
      fullDate: fullDate(session.completed_at || session.started_at),
      load: bestLoad,
      e1rm: Number.isFinite(bestE1rm) ? Number(bestE1rm.toFixed(1)) : null,
      workout: session.name,
    }];
  }), [history]);

  if (!history && !error) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;
  if (!history) return <div className="card-forge p-6 text-center text-[13px]" style={{ color: '#fca5a5' }}>{error}</div>;

  const { exercise, sessions } = history;

  const openEditor = () => {
    setEditing(true);
    if (!library) getForgeExercises().then(setLibrary).catch(() => setLibrary([]));
  };

  const remove = async () => {
    setDeleting(true);
    try { await deleteForgeExercise(exercise.id); navigate('/forge/exercises', { replace: true }); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Die Übung wird noch verwendet und kann nicht gelöscht werden.'); setConfirmDelete(false); }
    finally { setDeleting(false); }
  };

  const chip = (active: boolean, label: string, onClick: () => void) => <button key={label} type="button" onClick={onClick} aria-pressed={active} className="tap h-9 shrink-0 rounded-full px-3.5 text-[12.5px]" style={{ color: active ? '#16130f' : TEXT, background: active ? SAND : 'rgba(255,247,235,0.05)', border: `1px solid ${active ? SAND : 'rgba(232,197,138,0.12)'}` }}>{label}</button>;

  return <div className="space-y-4 forge-anim">
    <header className="flex items-start gap-3">
      <button type="button" onClick={() => navigate('/forge/exercises')} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }} aria-label="Zurück zur Übungsbibliothek"><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1">
        <h1 className="text-[23px] font-semibold leading-tight tracking-tight" style={{ color: TEXT }}>{exercise.name}</h1>
        <p className="mt-1 text-[12px]" style={{ color: DIM }}>{muscleLabel(exercise.primary_muscle_group)}{exercise.secondary_muscle_groups.length ? ` + ${exercise.secondary_muscle_groups.map(muscleLabel).join(', ')}` : ''} · {equipmentLabel(exercise.equipment)}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: DIM }}>{sessions.length} abgeschlossene {sessions.length === 1 ? 'Session' : 'Sessions'}</p>
      </div>
      <button type="button" onClick={openEditor} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }} aria-label="Übung bearbeiten"><Pencil size={17} /></button>
      <button type="button" onClick={() => setConfirmDelete(true)} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }} aria-label="Übung löschen"><Trash2 size={17} /></button>
    </header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}
    {exercise.machine_profiles.length > 0 && <div className="forge-chip-row -mx-4 flex gap-1.5 overflow-x-auto px-4">{chip(!machineProfileId, 'Alle Geräte', () => setMachineProfileId(null))}{exercise.machine_profiles.map((profile) => chip(machineProfileId === profile.id, profile.name, () => setMachineProfileId(profile.id)))}</div>}
    {editing && library && <ExerciseFormSheet exercise={exercise} library={library} onClose={() => setEditing(false)} onSaved={(saved) => { setEditing(false); setHistory({ ...history, exercise: saved }); }} />}
    <ConfirmDialog open={confirmDelete} busy={deleting} destructive title="Übung löschen?" description={`„${exercise.name}“ wird aus der Bibliothek entfernt. Übungen, die in Plänen oder Sessions stecken, können nicht gelöscht werden.`} confirmLabel="Löschen" onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />

    <section className="card-forge p-4" style={{ borderColor: `${SAND}24` }}>
      <div className="flex items-start justify-between gap-3 mb-4"><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>Leistungsentwicklung</p><p className="text-[12px] mt-1" style={{ color: DIM }}>Schwerster geloggter Satz und beste geschätzte 1RM je Session.</p></div><TrendingUp size={18} style={{ color: SAND }} /></div>
      {chartData.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,247,235,0.06)" /><XAxis dataKey="date" tick={AXIS_STYLE} axisLine={false} tickLine={false} minTickGap={18} /><YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} width={34} /><Tooltip contentStyle={{ background: '#1c180d', border: `1px solid ${SAND}44`, borderRadius: 12, color: TEXT, fontSize: 11 }} labelStyle={{ color: SAND }} labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate ?? ''} formatter={(value: number | string | undefined, name: string | undefined) => [`${Number(value).toFixed(1)} kg`, name === 'load' ? 'Bestes Gewicht' : 'Geschätzte 1RM']} /><Legend wrapperStyle={{ fontSize: 10, color: DIM, paddingTop: 8 }} formatter={(value) => value === 'load' ? 'Bestes Gewicht' : 'Geschätzte 1RM'} /><Line type="monotone" dataKey="load" name="load" stroke={SAND} strokeWidth={2.2} dot={{ r: 3, fill: SAND, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls /><Line type="monotone" dataKey="e1rm" name="e1rm" stroke={MINT} strokeWidth={2.2} dot={{ r: 3, fill: MINT, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls /></LineChart></ResponsiveContainer> : <div className="py-10 text-center"><Dumbbell size={20} className="mx-auto mb-2" style={{ color: DIM }} /><p className="text-[12px]" style={{ color: DIM }}>Noch keine geloggten Sätze in abgeschlossenen Sessions.</p></div>}
      <p className="text-[10px] leading-relaxed mt-3" style={{ color: DIM }}>e1RM nutzt die Epley-Schätzung aus Gewicht und Wiederholungen; sie ist ein Fortschrittsindikator, kein gemessener Maximalversuch.</p>
    </section>

    <section className="space-y-2"><div className="flex items-center justify-between px-1"><h2 className="text-[14px] font-semibold" style={{ color: TEXT }}>Geloggte Sätze</h2><span className="text-[11px]" style={{ color: DIM }}>{sessions.length} Einträge</span></div>
      {sessions.length ? sessions.map((session) => <article key={`${session.id}-${session.machine_profile_id ?? 'unprofiled'}`} className="card-forge overflow-hidden"><div className="p-4 flex items-start justify-between gap-3"><div><p className="text-[13px] font-medium" style={{ color: TEXT }}>{session.name}</p><p className="text-[11px] mt-1" style={{ color: DIM }}>{fullDate(session.completed_at || session.started_at)}{session.machine_profile_name ? ` · ${session.machine_profile_name}` : ''}</p>{session.session_note && <p className="mt-1.5 text-[12px] leading-snug" style={{ color: 'rgba(242,236,226,0.75)' }}>Notiz: {session.session_note}</p>}</div><span className="text-[10px] uppercase tracking-wider" style={{ color: SAND }}>{session.sets.filter((set) => set.actual_weight_kg != null && set.actual_reps != null).length} Sätze</span></div><div className="border-t" style={{ borderColor: 'rgba(255,247,235,0.06)' }}><div className="grid px-4 py-2 text-[9px] uppercase tracking-wider" style={{ gridTemplateColumns: '52px 1fr 1fr', color: DIM }}><span>Satz</span><span className="text-center">Geloggte Leistung</span><span className="text-right">e1RM</span></div>{session.sets.map((set, index) => { const e1rm = estimatedOneRepMax(set); return <div key={set.position} className="grid px-4 py-2.5 text-[12px] tabular-nums" style={{ gridTemplateColumns: '52px 1fr 1fr', background: index % 2 ? 'transparent' : 'rgba(255,247,235,0.025)' }}><span style={{ color: DIM }}>{set.set_type === 'warmup' ? 'Warm-up' : `Satz ${set.position + 1}`}</span><span className="text-center font-medium" style={{ color: set.actual_weight_kg != null && set.actual_reps != null ? TEXT : DIM }}>{formatLoad(set.actual_weight_kg, set.actual_reps)}</span><span className="text-right" style={{ color: e1rm != null ? MINT : DIM }}>{e1rm != null ? `${e1rm.toFixed(1)} kg` : '—'}</span>{set.note && <p className="col-span-3 pt-1 text-[10px]" style={{ color: DIM }}>{set.note}</p>}</div>; })}</div></article>) : <div className="card-forge p-6 text-center text-[12px]" style={{ color: DIM }}>Schließe eine Forge-Session mit dieser Übung ab, dann erscheint sie hier.</div>}
    </section>
  </div>;
}
