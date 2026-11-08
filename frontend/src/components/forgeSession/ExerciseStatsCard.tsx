import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Loader2 } from 'lucide-react';
import { getForgeExerciseHistory } from '../../api/api';
import type { ForgeExerciseHistory, ForgeSessionSet } from '../../api/api';
import { BORDER, DIM, MINT, SAND, TEXT, epley, formatKg } from './shared';
import TrendChart from './TrendChart';
import type { TrendPoint } from './TrendChart';

const CHART_SESSIONS = 10;

interface Facts {
  key: string;
  today: boolean;
  /** Short date for the chart axis and the long one for the record list. */
  label: string;
  longLabel: string;
  e1rm: number;
  e1Kg: number;
  e1Reps: number;
  bestKg: number;
  bestKgReps: number;
  volume: number;
  /** Beat every earlier session (the first session never counts). */
  e1rmRecord: boolean;
  kgRecord: boolean;
}

type Summary = Pick<Facts, 'e1rm' | 'e1Kg' | 'e1Reps' | 'bestKg' | 'bestKgReps' | 'volume'>;

const summarize = (sets: Array<Pick<ForgeSessionSet, 'set_type' | 'actual_weight_kg' | 'actual_reps' | 'completed'>>): Summary | null => {
  const working = sets.filter((set) => set.set_type === 'working' && set.completed && set.actual_reps != null && set.actual_reps > 0 && set.actual_weight_kg != null && set.actual_weight_kg > 0);
  if (!working.length) return null;
  let e1rm = 0;
  let e1Kg = 0;
  let e1Reps = 0;
  let bestKg = 0;
  let bestKgReps = 0;
  let volume = 0;
  for (const set of working) {
    const kg = set.actual_weight_kg!;
    const reps = set.actual_reps!;
    const estimate = Math.round(epley(kg, reps) * 10) / 10;
    volume += kg * reps;
    if (estimate > e1rm) { e1rm = estimate; e1Kg = kg; e1Reps = reps; }
    if (kg > bestKg || (kg === bestKg && reps > bestKgReps)) { bestKg = kg; bestKgReps = reps; }
  }
  return { e1rm, e1Kg, e1Reps, bestKg, bestKgReps, volume: Math.round(volume) };
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
const longDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

interface Holder { label: string; detail: string; value: string; today: boolean; date: string }

/** History with today's completed sets merged in live: trend, records and best weight. */
export default function ExerciseStatsCard({ exerciseId, machineProfileId, todaySets }: {
  exerciseId: string;
  machineProfileId: string | null;
  todaySets: ForgeSessionSet[];
}) {
  const [open, setOpen] = useState(false);
  const key = `${exerciseId}:${machineProfileId ?? ''}`;
  const [result, setResult] = useState<{ key: string; history: ForgeExerciseHistory | null; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getForgeExerciseHistory(exerciseId, machineProfileId)
      .then((value) => { if (!cancelled) setResult({ key, history: value, failed: false }); })
      .catch(() => { if (!cancelled) setResult({ key, history: null, failed: true }); });
    return () => { cancelled = true; };
  }, [exerciseId, machineProfileId, key]);

  // A result for a previous exercise/profile counts as "still loading".
  const current = result?.key === key ? result : null;
  const history = current?.history ?? null;
  const failed = current?.failed ?? false;

  // Oldest first; today (if any set is done) is the last entry.
  const sessions = useMemo<Facts[]>(() => {
    const base = [...(history?.sessions ?? [])].reverse().flatMap((session) => {
      const summary = summarize(session.sets);
      if (!summary) return [];
      const date = session.completed_at || session.started_at;
      return [{ key: session.id, today: false, label: shortDate(date), longLabel: longDate(date), ...summary }];
    });
    const today = summarize(todaySets);
    if (today) base.push({ key: 'today', today: true, label: 'Heute', longLabel: 'Heute', ...today });
    const flagged: Facts[] = [];
    let bestE1rm = 0;
    let bestKg = 0;
    for (const [index, session] of base.entries()) {
      flagged.push({ ...session, e1rmRecord: index > 0 && session.e1rm > bestE1rm, kgRecord: index > 0 && session.bestKg > bestKg });
      bestE1rm = Math.max(bestE1rm, session.e1rm);
      bestKg = Math.max(bestKg, session.bestKg);
    }
    return flagged;
  }, [history, todaySets]);

  const records = useMemo<Holder[]>(() => {
    let e1rm: Facts | null = null;
    let heavy: Facts | null = null;
    let volume: Facts | null = null;
    // Chronological and strict: a tie never takes a record away from the day it was set.
    for (const session of sessions) {
      if (!e1rm || session.e1rm > e1rm.e1rm) e1rm = session;
      if (!heavy || session.bestKg > heavy.bestKg || (session.bestKg === heavy.bestKg && session.bestKgReps > heavy.bestKgReps)) heavy = session;
      if (!volume || session.volume > volume.volume) volume = session;
    }
    if (!e1rm || !heavy || !volume) return [];
    return [
      { label: 'Geschätzte 1RM', detail: `${formatKg(e1rm.e1Kg)} kg × ${e1rm.e1Reps}`, value: `${formatKg(e1rm.e1rm)} kg`, today: e1rm.today, date: e1rm.longLabel },
      { label: 'Schwerstes Gewicht', detail: `× ${heavy.bestKgReps} Wdh.`, value: `${formatKg(heavy.bestKg)} kg`, today: heavy.today, date: heavy.longLabel },
      { label: 'Volumen pro Einheit', detail: 'alle Arbeitssätze', value: `${volume.volume.toLocaleString('de-DE')} kg`, today: volume.today, date: volume.longLabel },
    ];
  }, [sessions]);

  const last = sessions.at(-1);
  const previous = sessions.length > 1 ? sessions.at(-2) : undefined;
  const delta = last && previous ? last.e1rm - previous.e1rm : null;
  const todayIsRecord = Boolean(last?.today && last.e1rmRecord);

  const window = sessions.slice(-CHART_SESSIONS);
  const e1Points: TrendPoint[] = window.map((session) => ({ key: session.key, label: session.label, today: session.today, value: session.e1rm, record: session.e1rmRecord }));
  const kgPoints: TrendPoint[] = window.map((session) => ({ key: session.key, label: session.label, today: session.today, value: session.bestKg, record: session.kgRecord }));
  const past = sessions.filter((session) => !session.today);
  const e1Mark = past.length ? Math.max(...past.map((session) => session.e1rm)) : null;
  const kgMark = past.length ? Math.max(...past.map((session) => session.bestKg)) : null;

  return <section className="rounded-2xl" style={{ background: 'rgba(255,247,235,0.025)', border: `1px solid ${BORDER}` }}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="tap flex w-full items-center gap-3 px-4 py-3.5 text-left">
      <BarChart3 size={17} style={{ color: SAND }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium" style={{ color: TEXT }}>Verlauf & Statistik</span>
        <span className="mt-0.5 block truncate text-[11px] tabular-nums" style={{ color: DIM }}>
          {!history && !failed ? 'Lädt…' : last ? <>e1RM {formatKg(last.e1rm)} kg{delta != null && delta !== 0 && <span style={{ color: delta > 0 ? MINT : '#f87171' }}> · {delta > 0 ? '+' : ''}{formatKg(Math.round(delta * 10) / 10)} kg</span>}{todayIsRecord && <span style={{ color: MINT }}> · Rekord</span>}</> : 'Noch kein Verlauf'}
        </span>
      </span>
      {!history && !failed ? <Loader2 size={15} className="animate-spin" style={{ color: DIM }} /> : <ChevronDown size={17} style={{ color: DIM, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
    </button>
    {open && <div className="forge-expand space-y-5 px-4 pb-4">
      {sessions.length < 1 && <p className="text-[12px]" style={{ color: DIM }}>{failed ? 'Der Verlauf konnte nicht geladen werden.' : 'Sobald du Arbeitssätze abhakst, erscheint hier dein Verlauf.'}</p>}
      {sessions.length > 0 && <>
        <TrendChart title="Geschätzte 1RM" points={e1Points} color={MINT} recordLine={e1Mark} />

        {records.length > 0 && <div>
          <p className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: DIM }}>Rekorde</p>
          <ul>
            {records.map((record, index) => (
              <li key={record.label} className="flex items-center gap-3 py-2.5" style={{ borderTop: index === 0 ? 'none' : `1px solid ${BORDER}` }}>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px]" style={{ color: TEXT }}>{record.label}</p>
                  <p className="text-[11px] tabular-nums" style={{ color: DIM }}>{record.detail}</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] font-semibold tabular-nums" style={{ color: record.today ? MINT : SAND }}>{record.value}</p>
                  <p className="text-[10.5px] tabular-nums" style={{ color: record.today ? MINT : DIM }}>{record.today ? 'Heute · neuer Rekord' : record.date}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>}

        <TrendChart title="Bestes Gewicht" points={kgPoints} color={SAND} recordLine={kgMark} height={112} minSpanRatio={0.04} />
        <p className="text-[10px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Heute wird live aus deinen abgehakten Arbeitssätzen berechnet.</p>
      </>}
    </div>}
  </section>;
}
