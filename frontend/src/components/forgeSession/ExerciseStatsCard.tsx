import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { getForgeExerciseHistory } from '../../api/api';
import type { ForgeExerciseHistory, ForgeSessionSet } from '../../api/api';
import { BORDER, DIM, FAINT, MINT, SAND, TEXT, epley, formatKg } from './shared';
import TrendChart from './TrendChart';
import type { TrendPoint } from './TrendChart';

const CHART_SESSIONS = 10;
const TABLE_SESSIONS = 6;

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
}

type LoggedSet = { kg: number | null; reps: number };

/** One row of the recent-sets table: every completed working set of one session, in order. */
interface TableRow { key: string; today: boolean; label: string; sets: LoggedSet[] }

type HistorySet = Pick<ForgeSessionSet, 'set_type' | 'actual_weight_kg' | 'actual_reps' | 'completed' | 'position'>;

/** Bodyweight sets (no load) count too, so the table also works without weights. */
const loggedSets = (sets: HistorySet[]): LoggedSet[] => [...sets]
  .sort((a, b) => a.position - b.position)
  .filter((set) => set.set_type === 'working' && set.completed && set.actual_reps != null && set.actual_reps > 0)
  .map((set) => ({ kg: set.actual_weight_kg != null && set.actual_weight_kg > 0 ? set.actual_weight_kg : null, reps: set.actual_reps! }));

/** Load-aware comparison of the same set position; reps decide for bodyweight sets. */
const setScore = (set: LoggedSet) => (set.kg != null ? epley(set.kg, set.reps) : set.reps);

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
export default function ExerciseStatsCard({ exerciseId, machineProfileId, todaySets, sessionId, completedAt }: {
  exerciseId: string;
  machineProfileId: string | null;
  todaySets: ForgeSessionSet[];
  /** The shown session: its server copy in the history is replaced by the live sets. */
  sessionId: string;
  /** Set for an already completed session, so its live sets keep their real date and place. */
  completedAt: string | null;
}) {
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
    const dated = (history?.sessions ?? []).filter((session) => session.id !== sessionId).flatMap((session) => {
      const summary = summarize(session.sets);
      if (!summary) return [];
      const date = session.completed_at || session.started_at;
      return [{ time: new Date(date).getTime(), facts: { key: session.id, today: false, label: shortDate(date), longLabel: longDate(date), ...summary } }];
    });
    const live = summarize(todaySets);
    if (live) {
      dated.push(completedAt
        ? { time: new Date(completedAt).getTime(), facts: { key: sessionId, today: false, label: shortDate(completedAt), longLabel: longDate(completedAt), ...live } }
        : { time: Number.POSITIVE_INFINITY, facts: { key: 'today', today: true, label: 'Heute', longLabel: 'Heute', ...live } });
    }
    const base = dated.sort((a, b) => a.time - b.time).map((entry) => entry.facts);
    const flagged: Facts[] = [];
    let bestE1rm = 0;
    for (const [index, session] of base.entries()) {
      flagged.push({ ...session, e1rmRecord: index > 0 && session.e1rm > bestE1rm });
      bestE1rm = Math.max(bestE1rm, session.e1rm);
    }
    return flagged;
  }, [history, todaySets, sessionId, completedAt]);

  // Newest first; the shown session uses its live sets, like the chart.
  const rows = useMemo<TableRow[]>(() => {
    const dated = (history?.sessions ?? []).filter((session) => session.id !== sessionId).flatMap((session) => {
      const sets = loggedSets(session.sets);
      if (!sets.length) return [];
      const date = session.completed_at || session.started_at;
      return [{ time: new Date(date).getTime(), row: { key: session.id, today: false, label: shortDate(date), sets } }];
    });
    const live = loggedSets(todaySets);
    if (live.length) {
      dated.push(completedAt
        ? { time: new Date(completedAt).getTime(), row: { key: sessionId, today: false, label: shortDate(completedAt), sets: live } }
        : { time: Number.POSITIVE_INFINITY, row: { key: 'today', today: true, label: 'Heute', sets: live } });
    }
    return dated.sort((a, b) => b.time - a.time).map((entry) => entry.row);
  }, [history, todaySets, sessionId, completedAt]);
  const tableRows = rows.slice(0, TABLE_SESSIONS);
  const columns = Math.max(0, ...tableRows.map((row) => row.sets.length));

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
  const past = sessions.filter((session) => !session.today);
  const e1Mark = past.length ? Math.max(...past.map((session) => session.e1rm)) : null;

  const loading = !history && !failed;

  return <section className="rounded-2xl" style={{ background: 'rgba(255,247,235,0.025)', border: `1px solid ${BORDER}` }}>
    <header className="flex items-center gap-3 px-4 py-3.5">
      <BarChart3 size={17} style={{ color: SAND }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium" style={{ color: TEXT }}>Verlauf & Statistik</span>
        <span className="mt-0.5 block truncate text-[11px] tabular-nums" style={{ color: DIM }}>
          {loading ? 'Lädt…' : last ? <>e1RM {formatKg(last.e1rm)} kg{delta != null && delta !== 0 && <span style={{ color: delta > 0 ? MINT : '#f87171' }}> · {delta > 0 ? '+' : ''}{formatKg(Math.round(delta * 10) / 10)} kg</span>}{todayIsRecord && <span style={{ color: MINT }}> · Rekord</span>}</> : 'Noch kein Verlauf'}
        </span>
      </span>
      {loading && <Loader2 size={15} className="animate-spin" style={{ color: DIM }} />}
    </header>
    {!loading && <div className="space-y-5 px-4 pb-4">
      {sessions.length < 1 && rows.length < 1 && <p className="text-[12px]" style={{ color: DIM }}>{failed ? 'Der Verlauf konnte nicht geladen werden.' : 'Sobald du Arbeitssätze abhakst, erscheint hier dein Verlauf.'}</p>}
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
      </>}

      {tableRows.length > 0 && <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>Letzte Sätze</p>
          <p className="text-[10px]" style={{ color: FAINT }}>kg × Wdh. · Arbeitssätze</p>
        </div>
        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
          <table className="w-full border-collapse text-left tabular-nums">
            <thead>
              <tr style={{ background: 'rgba(255,247,235,0.03)' }}>
                <th scope="col" className="py-2 pl-3 pr-2 text-[10px] font-medium uppercase tracking-wider" style={{ color: FAINT }}>Datum</th>
                {Array.from({ length: columns }, (_, index) => <th key={index} scope="col" className="px-1.5 py-2 text-center text-[10px] font-medium uppercase tracking-wider" style={{ color: FAINT }}>S{index + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIndex) => {
                // Compared with the same set of the session before (the next row, since newest is first).
                const older = rows[rowIndex + 1];
                return <tr key={row.key} style={{ borderTop: `1px solid ${BORDER}`, background: row.today ? 'rgba(232,197,138,0.07)' : 'transparent' }}>
                  <th scope="row" className="whitespace-nowrap py-2 pl-3 pr-2 text-[11.5px] font-medium" style={{ color: row.today ? SAND : DIM }}>{row.label}</th>
                  {Array.from({ length: columns }, (_, index) => {
                    const set = row.sets[index];
                    if (!set) return <td key={index} className="px-1.5 py-2 text-center text-[12px]" style={{ color: 'rgba(242,236,226,0.18)' }}>–</td>;
                    const before = older?.sets[index];
                    const improved = before != null && setScore(set) > setScore(before) + 1e-9;
                    return <td key={index} className="px-1.5 py-2 text-center leading-tight">
                      <span className="block text-[13px] font-semibold" style={{ color: improved ? MINT : TEXT }}>{set.kg != null ? formatKg(set.kg) : 'BW'}</span>
                      <span className="block text-[10.5px]" style={{ color: improved ? `${MINT}cc` : DIM }}>× {set.reps}</span>
                    </td>;
                  })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[10px]" style={{ color: FAINT }}><span style={{ color: MINT }}>Grün</span> = stärker als derselbe Satz in der Einheit davor.</p>
      </div>}

      {(sessions.length > 0 || tableRows.length > 0) && <p className="text-[10px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Heute wird live aus deinen abgehakten Arbeitssätzen berechnet.</p>}
    </div>}
  </section>;
}
