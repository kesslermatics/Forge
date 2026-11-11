import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { WeightHistoryData, WeightHistoryEntry, WeightMeasurement } from '../api/api';
import { SAND, TEXT } from './track/trackUtils';
import { shortDay } from './nutrition/overviewUtils';

const W = 320;
const H = 160;
const PAD_X = 10;
const TOP = 26;
const BOTTOM = 22;
const GREEN = '#4ade80';
const DAY = 86_400_000;
const MIN_SPAN_KG = 2;

const time = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const kg = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Smooth path with horizontal tangents: round like a trend line, never overshoots a point. */
function smooth(points: { x: number; y: number }[]): string {
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const previous = points[index - 1];
    const mid = (previous.x + point.x) / 2;
    return `${path} C${mid.toFixed(1)} ${previous.y.toFixed(1)} ${mid.toFixed(1)} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, '');
}

/**
 * Weight over time inside the range between the starting weight and the target (both dashed).
 * Works from the first weigh-in on; tap or drag across the chart to read single days.
 */
export default function WeightJourney({ entries, goal, latest }: { entries: WeightHistoryEntry[]; goal: WeightHistoryData['goal'] | null; latest?: WeightMeasurement | null }) {
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (entries.length === 0) return null;

  const startKg = goal?.start_kg ?? entries[0].weight_kg;
  const targetKg = goal?.target_kg ?? null;

  // Daily weigh-ins swing with water and food, so from four weigh-ins on the line shows a centred 7-day trend.
  const times = entries.map((entry) => time(entry.date));
  const useTrend = entries.length >= 4;
  const line = entries.map((_, index) => {
    if (!useTrend) return entries[index].weight_kg;
    const nearby = entries.filter((__, other) => Math.abs(times[other] - times[index]) <= 3 * DAY);
    return nearby.reduce((sum, item) => sum + item.weight_kg, 0) / nearby.length;
  });

  const t0 = Math.min(time(goal?.start_date ?? entries[0].date), times[0]);
  // The last weigh-in always sits at the right edge, so the chart fills up and compresses as time passes.
  const t1 = Math.max(times[times.length - 1], t0 + DAY);
  const x = (t: number) => PAD_X + ((t - t0) / (t1 - t0)) * (W - PAD_X * 2);

  const values = [...line, ...entries.map((entry) => entry.weight_kg), startKg, ...(targetKg !== null ? [targetKg] : [])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const centre = (low + high) / 2;
  const span = Math.max(high - low, MIN_SPAN_KG) * 1.3;
  const lo = centre - span / 2;
  const y = (value: number) => TOP + (1 - (value - lo) / span) * (H - TOP - BOTTOM);

  const points = entries.map((entry, index) => ({ x: x(times[index]), y: y(line[index]), raw: y(entry.weight_kg) }));
  const startY = y(startKg);
  const targetY = targetKg !== null ? y(targetKg) : null;
  const startOnTop = targetY === null || startY <= targetY;

  const active = selected ?? entries.length - 1;
  const picked = entries[active];
  // Without a selection "Zuletzt" is the last single weighing, not the day's mean the chart works with.
  const lastMeasurement = selected === null && latest && latest.date === picked.date ? latest : null;
  const current = lastMeasurement ? { date: lastMeasurement.date, weight_kg: lastMeasurement.weight_kg } : picked;
  const losing = targetKg !== null && targetKg < startKg;
  const reached = targetKg !== null && (losing ? current.weight_kg <= targetKg : current.weight_kg >= targetKg);
  const remaining = targetKg !== null ? Math.abs(current.weight_kg - targetKg) : null;

  const pick = (event: PointerEvent<SVGSVGElement>, toggle: boolean) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((point, index) => { if (Math.abs(point.x - px) < Math.abs(points[best].x - px)) best = index; });
    setSelected((previous) => (toggle && previous === best && event.pointerType !== 'mouse' ? null : best));
  };

  return (
    <div>
      <div className="flex min-h-[34px] items-end justify-between gap-3">
        <div>
          <div className="text-[10px]" style={{ color: 'rgba(242,236,226,0.45)' }}>{selected === null ? 'Zuletzt' : 'Gewogen'} · {shortDay(current.date)}</div>
          <div className="text-[15px] font-semibold tabular-nums leading-tight" style={{ color: TEXT }}>
            {kg(current.weight_kg)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: 'rgba(242,236,226,0.45)' }}>kg</span>
          </div>
        </div>
        {remaining !== null && (
          <div className="pb-0.5 text-right text-[11px] tabular-nums" style={{ color: reached ? GREEN : 'rgba(242,236,226,0.6)' }}>
            {reached ? 'Ziel erreicht' : <>noch <span className="font-semibold" style={{ color: TEXT }}>{kg(remaining)}</span> kg bis zum Ziel</>}
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 block w-full select-none"
        style={{ touchAction: 'pan-y' }}
        role="img"
        aria-label={`Gewichtsverlauf, ${entries.length} Messungen${targetKg !== null ? `, Ziel ${kg(targetKg)} kg` : ''}`}
        onPointerDown={(event) => pick(event, true)}
        onPointerMove={(event) => { if (event.pointerType === 'mouse' || event.buttons > 0) pick(event, false); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setSelected(null); }}
      >
        {targetY !== null && (
          <rect x={PAD_X} y={Math.min(startY, targetY)} width={W - PAD_X * 2} height={Math.abs(targetY - startY)} rx={8} fill="rgba(74,222,128,0.06)" />
        )}

        <line x1={PAD_X} x2={W - PAD_X} y1={startY} y2={startY} stroke="rgba(242,236,226,0.3)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={PAD_X + 2} y={startOnTop ? startY - 5 : startY + 12} fontSize={9.5} fill="rgba(242,236,226,0.5)">Start {kg(startKg)}</text>
        {targetY !== null && targetKg !== null && (
          <>
            <line x1={PAD_X} x2={W - PAD_X} y1={targetY} y2={targetY} stroke={GREEN} strokeOpacity={0.75} strokeWidth={1} strokeDasharray="4 4" />
            <text x={W - PAD_X - 2} y={startOnTop ? targetY + 12 : targetY - 5} fontSize={9.5} textAnchor="end" fill={GREEN}>Ziel {kg(targetKg)}</text>
          </>
        )}

        {points.length > 1 && (
          <path d={smooth(points)} fill="none" stroke={SAND} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="nut-draw" />
        )}
        {useTrend && points.map((point, index) => (
          <circle key={`raw-${entries[index].date}`} cx={point.x} cy={point.raw} r={2.2} fill={SAND} opacity={0.4} />
        ))}
        {points.map((point, index) => {
          const last = index === points.length - 1;
          const isActive = index === active && (selected !== null || last);
          return (
            <circle
              key={entries[index].date}
              cx={point.x}
              cy={useTrend ? point.y : point.raw}
              r={isActive ? 5 : useTrend ? 0 : 3.6}
              fill={isActive ? '#16130f' : SAND}
              stroke={SAND}
              strokeWidth={isActive ? 2.4 : 0}
              className="nut-pop"
              style={{ ['--d' as string]: `${Math.min(0.3 + index * 0.02, 0.9)}s` }}
            />
          );
        })}
        {selected !== null && (
          <line x1={points[selected].x} x2={points[selected].x} y1={TOP - 8} y2={H - BOTTOM + 4} stroke="rgba(232,197,138,0.3)" strokeWidth={1} />
        )}

        <text x={PAD_X} y={H - 5} fontSize={9.5} fill="rgba(242,236,226,0.35)">{shortDay(new Date(t0).toISOString().slice(0, 10))}</text>
        <text x={W - PAD_X} y={H - 5} fontSize={9.5} textAnchor="end" fill="rgba(242,236,226,0.35)">{shortDay(new Date(t1).toISOString().slice(0, 10))}</text>
      </svg>
    </div>
  );
}
