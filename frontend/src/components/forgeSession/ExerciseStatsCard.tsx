import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Loader2 } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getForgeExerciseHistory } from '../../api/api';
import type { ForgeExerciseHistory, ForgeSessionSet } from '../../api/api';
import { BORDER, DIM, MINT, SAND, TEXT, epley, formatKg } from './shared';

interface Point {
  key: string;
  label: string;
  today: boolean;
  e1rm: number;
  bestKg: number;
  volume: number;
}

const summarize = (sets: Array<Pick<ForgeSessionSet, 'set_type' | 'actual_weight_kg' | 'actual_reps' | 'completed'>>) => {
  const working = sets.filter((set) => set.set_type === 'working' && set.completed && set.actual_reps != null && set.actual_reps > 0 && set.actual_weight_kg != null && set.actual_weight_kg > 0);
  if (!working.length) return null;
  return {
    e1rm: Math.round(Math.max(...working.map((set) => epley(set.actual_weight_kg!, set.actual_reps!))) * 10) / 10,
    bestKg: Math.max(...working.map((set) => set.actual_weight_kg!)),
    volume: Math.round(working.reduce((sum, set) => sum + set.actual_weight_kg! * set.actual_reps!, 0)),
  };
};

const tooltipStyle = { background: 'rgba(22,19,15,0.96)', border: '1px solid rgba(232,197,138,0.2)', borderRadius: 10, fontSize: 11, color: TEXT, padding: '4px 10px' };

/** Collapsible history with today's completed sets merged in live. */
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

  const points = useMemo<Point[]>(() => {
    const past = [...(history?.sessions ?? [])].reverse().slice(-10).flatMap((session) => {
      const summary = summarize(session.sets);
      if (!summary) return [];
      const date = session.completed_at || session.started_at;
      return [{ key: session.id, today: false, label: new Date(date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }), ...summary }];
    });
    const today = summarize(todaySets);
    return today ? [...past, { key: 'today', today: true, label: 'Heute', ...today }] : past;
  }, [history, todaySets]);

  const last = points.at(-1);
  const previous = points.length > 1 ? points.at(-2) : undefined;
  const delta = last && previous ? last.e1rm - previous.e1rm : null;
  const best = points.length ? Math.max(...points.map((point) => point.e1rm)) : null;
  const todayIsRecord = Boolean(last?.today && previous && best === last.e1rm && last.e1rm > Math.max(...points.slice(0, -1).map((point) => point.e1rm)));

  return <section className="rounded-2xl" style={{ background: 'rgba(255,247,235,0.025)', border: `1px solid ${BORDER}` }}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="tap flex w-full items-center gap-3 px-4 py-3.5 text-left">
      <BarChart3 size={17} style={{ color: SAND }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium" style={{ color: TEXT }}>Verlauf & Statistik</span>
        <span className="mt-0.5 block truncate text-[11px] tabular-nums" style={{ color: DIM }}>
          {!history && !failed ? 'Lädt…' : last ? <>e1RM {formatKg(last.e1rm)} kg{delta != null && <span style={{ color: delta >= 0 ? MINT : '#f87171' }}> · {delta > 0 ? '+' : ''}{formatKg(Math.round(delta * 10) / 10)} kg</span>}{todayIsRecord && <span style={{ color: MINT }}> · Rekord</span>}</> : 'Noch kein Verlauf'}
        </span>
      </span>
      {!history && !failed ? <Loader2 size={15} className="animate-spin" style={{ color: DIM }} /> : <ChevronDown size={17} style={{ color: DIM, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
    </button>
    {open && <div className="forge-expand space-y-4 px-4 pb-4">
      {points.length < 1 && <p className="text-[12px]" style={{ color: DIM }}>{failed ? 'Der Verlauf konnte nicht geladen werden.' : 'Sobald du Arbeitssätze abhakst, erscheint hier dein Verlauf.'}</p>}
      {points.length > 0 && <>
        <Chart title="Geschätzte 1RM" color={MINT} value={last ? `${formatKg(last.e1rm)} kg` : '–'}>
          <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
            <defs><linearGradient id="forgeE1rm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={MINT} stopOpacity={0.3} /><stop offset="100%" stopColor={MINT} stopOpacity={0} /></linearGradient></defs>
            <XAxis dataKey="label" tick={{ fill: 'rgba(242,236,226,0.35)', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={['dataMin - 3', 'dataMax + 3']} hide />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${formatKg(Number(value))} kg`, 'e1RM']} cursor={{ stroke: 'rgba(255,247,235,0.12)' }} />
            <Area type="monotone" dataKey="e1rm" stroke={MINT} strokeWidth={2.2} fill="url(#forgeE1rm)" isAnimationActive animationDuration={450}
              dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => <circle key={props.index} cx={props.cx} cy={props.cy} r={props.payload?.today ? 5 : 2.5} fill={props.payload?.today ? MINT : 'rgba(131,214,173,0.55)'} stroke={props.payload?.today ? '#16130f' : 'none'} strokeWidth={2} />} />
          </AreaChart>
        </Chart>
        <div className="grid grid-cols-2 gap-3">
          <Chart title="Bestes Gewicht" color={SAND} value={last ? `${formatKg(last.bestKg)} kg` : '–'} small>
            <BarChart data={points} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
              <YAxis domain={[0, 'dataMax']} hide />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${formatKg(Number(value))} kg`, 'Bestes']} cursor={{ fill: 'rgba(255,247,235,0.04)' }} />
              <Bar dataKey="bestKg" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={400}>{points.map((point) => <Cell key={point.key} fill={point.today ? SAND : 'rgba(232,197,138,0.35)'} />)}</Bar>
            </BarChart>
          </Chart>
          <Chart title="Volumen" color={SAND} value={last ? `${last.volume.toLocaleString('de-DE')} kg` : '–'} small>
            <BarChart data={points} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
              <YAxis domain={[0, 'dataMax']} hide />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${Number(value).toLocaleString('de-DE')} kg`, 'Volumen']} cursor={{ fill: 'rgba(255,247,235,0.04)' }} />
              <Bar dataKey="volume" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={400}>{points.map((point) => <Cell key={point.key} fill={point.today ? SAND : 'rgba(232,197,138,0.35)'} />)}</Bar>
            </BarChart>
          </Chart>
        </div>
        <p className="text-[10px]" style={{ color: 'rgba(242,236,226,0.35)' }}>Heute wird live aus deinen abgehakten Arbeitssätzen berechnet.</p>
      </>}
    </div>}
  </section>;
}

function Chart({ title, value, color, small = false, children }: { title: string; value: string; color: string; small?: boolean; children: React.ReactElement }) {
  return <div>
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <p className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>{title}</p>
      <p className={`${small ? 'text-[13px]' : 'text-[17px]'} font-semibold tabular-nums`} style={{ color }}>{value}</p>
    </div>
    <ResponsiveContainer width="100%" height={small ? 64 : 96}>{children}</ResponsiveContainer>
  </div>;
}
