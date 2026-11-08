import { useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { DIM, MINT, formatKg } from './shared';

export interface TrendPoint {
  key: string;
  label: string;
  today: boolean;
  value: number;
  /** Beat everything before it. */
  record: boolean;
}

const W = 320;
const PAD_X = 14;
const TOP = 24;
const BOTTOM = 20;
const DANGER = '#f87171';

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
 * Line chart over the last sessions. The scale hugs the data, so a +0.3 kg step is visible; a dashed line
 * marks the record to beat. Tap or drag to read a single session. The newest point is today's live value.
 */
export default function TrendChart({ title, points, color, recordLine, height = 132, minSpanRatio = 0.025 }: {
  title: string;
  points: TrendPoint[];
  color: string;
  /** Best value before today; drawn as dashed line. */
  recordLine: number | null;
  height?: number;
  /** Smallest visible range as share of the top value, so tiny differences do not look like jumps. */
  minSpanRatio?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = `trend-${useId().replace(/:/g, '')}`;
  if (points.length === 0) return null;

  const count = points.length;
  const active = Math.min(selected ?? count - 1, count - 1);
  const current = points[active];
  const previous = active > 0 ? points[active - 1] : null;
  const delta = previous ? Math.round((current.value - previous.value) * 10) / 10 : null;

  const values = [...points.map((point) => point.value), ...(recordLine !== null ? [recordLine] : [])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, Math.max(high * minSpanRatio, 1)) * 1.3;
  const lo = (low + high) / 2 - span / 2;
  const x = (index: number) => (count === 1 ? W / 2 : PAD_X + (index / (count - 1)) * (W - PAD_X * 2));
  const y = (value: number) => TOP + (1 - (value - lo) / span) * (height - TOP - BOTTOM);

  const coords = points.map((point, index) => ({ x: x(index), y: y(point.value) }));
  const line = smooth(coords);
  const baseline = height - BOTTOM;
  const area = coords.length > 1 ? `${line} L${coords[coords.length - 1].x.toFixed(1)} ${baseline} L${coords[0].x.toFixed(1)} ${baseline} Z` : '';
  const recordY = recordLine !== null ? y(recordLine) : null;

  const pick = (event: PointerEvent<SVGSVGElement>, toggle: boolean) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    coords.forEach((point, index) => { if (Math.abs(point.x - px) < Math.abs(coords[best].x - px)) best = index; });
    setSelected((value) => (toggle && value === best && event.pointerType !== 'mouse' ? null : best));
  };

  return (
    <div>
      <div className="flex min-h-[38px] items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>{title} · {current.today ? 'Heute' : current.label}</p>
          <p className="text-[20px] font-semibold leading-tight tabular-nums" style={{ color }}>
            {formatKg(current.value)}<span className="ml-0.5 text-[11px] font-normal" style={{ color: DIM }}>kg</span>
          </p>
        </div>
        <div className="flex items-center gap-2 pb-0.5 text-[11px] tabular-nums">
          {current.record && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: '#16130f', background: MINT }}>Rekord</span>}
          {delta !== null && delta !== 0 && <span style={{ color: delta > 0 ? MINT : DANGER }}>{delta > 0 ? '+' : ''}{formatKg(delta)} kg</span>}
          {delta === 0 && <span style={{ color: DIM }}>±0</span>}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="mt-1 block w-full select-none"
        style={{ touchAction: 'pan-y' }}
        role="img"
        aria-label={`${title}, ${count} ${count === 1 ? 'Einheit' : 'Einheiten'}, zuletzt ${formatKg(points[count - 1].value)} kg`}
        onPointerDown={(event) => pick(event, true)}
        onPointerMove={(event) => { if (event.pointerType === 'mouse' || event.buttons > 0) pick(event, false); }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setSelected(null); }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {recordY !== null && recordLine !== null && (
          <>
            <line x1={PAD_X} x2={W - PAD_X} y1={recordY} y2={recordY} stroke="rgba(242,236,226,0.3)" strokeWidth={1} strokeDasharray="4 4" />
            <text x={PAD_X + 2} y={recordY - 5} fontSize={9.5} fill="rgba(242,236,226,0.5)">Rekord {formatKg(recordLine)}</text>
          </>
        )}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {coords.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="nut-draw" />}

        {selected !== null && <line x1={coords[active].x} x2={coords[active].x} y1={TOP - 8} y2={baseline + 2} stroke="rgba(232,197,138,0.3)" strokeWidth={1} />}

        {coords.map((point, index) => {
          const item = points[index];
          const isActive = index === active && (selected !== null || index === count - 1);
          return (
            <circle
              key={`${item.key}-${item.value}`}
              cx={point.x}
              cy={point.y}
              r={isActive ? 5 : item.record ? 3.6 : 2.8}
              fill={isActive ? '#16130f' : color}
              fillOpacity={isActive || item.record ? 1 : 0.55}
              stroke={color}
              strokeWidth={isActive ? 2.4 : 0}
              className="nut-pop"
              style={{ ['--d' as string]: item.today ? '0s' : `${Math.min(0.3 + index * 0.03, 0.9)}s` }}
            />
          );
        })}

        <text x={count === 1 ? W / 2 : PAD_X} y={height - 5} fontSize={9.5} fill="rgba(242,236,226,0.35)" textAnchor={count === 1 ? 'middle' : 'start'}>{points[0].today ? 'Heute' : points[0].label}</text>
        {count > 1 && <text x={W - PAD_X} y={height - 5} fontSize={9.5} textAnchor="end" fill="rgba(242,236,226,0.35)">{points[count - 1].today ? 'Heute' : points[count - 1].label}</text>}
      </svg>
    </div>
  );
}
