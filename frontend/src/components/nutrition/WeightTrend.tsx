import type { OverviewWeek } from '../../api/api';
import { DIM, FAINT, SAND, TEXT, fmt } from '../track/trackUtils';
import CardHeader from './CardHeader';
import { dayMonth, mean, signed, slope } from './overviewUtils';

const W = 320;
const H = 132;
const TOP = 16;
const BOTTOM = 14;

/** Weekly average calories (columns) next to the weekly average body weight (line) over eight weeks. */
export default function WeightTrend({ weeks }: { weeks: OverviewWeek[] }) {
  const slot = W / weeks.length;
  const kcal = weeks.map((week) => week.avg_kcal);
  const weights = weeks.map((week) => week.avg_weight_kg);
  const kcalMax = Math.max(...kcal.map((value) => value ?? 0), 1) * 1.1;
  const known = weights.filter((value): value is number => value !== null);
  const wMin = Math.min(...known);
  const span = Math.max(Math.max(...known) - wMin, 1);
  const x = (index: number) => slot * index + slot / 2;
  const y = (weight: number) => TOP + (1 - (weight - wMin) / span) * (H - TOP - BOTTOM);
  const points = weights.flatMap((weight, index) => (weight === null ? [] : [{ x: x(index), y: y(weight), index }]));
  const path = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  const trend = slope(weights);
  const averageKcal = mean(kcal.filter((value): value is number => value !== null));
  const hasData = averageKcal !== null || known.length > 0;

  return (
    <section className="card-forge p-5" aria-label="Kalorien und Gewicht">
      <CardHeader title="Kalorien und Gewicht" chip="8 Wochen" />
      {!hasData ? (
        <p className="py-6 text-center text-[13px]" style={{ color: FAINT }}>Sobald du ein paar Wochen getrackt hast, siehst du hier den Zusammenhang.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Wöchentliche Kalorien als Balken, Gewicht als Linie">
            {kcal.map((value, index) => {
              if (value === null) return null;
              const height = Math.max((value / kcalMax) * (H - TOP), 2);
              const width = slot * 0.5;
              return (
                <rect
                  key={weeks[index].start} x={x(index) - width / 2} y={H - height} width={width} height={height} rx={5}
                  fill="rgba(232,197,138,0.2)" className="nut-col" style={{ ['--d' as string]: `${index * 0.05}s` }}
                />
              );
            })}
            {points.length > 1 && (
              <path d={path} fill="none" stroke={SAND} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="nut-draw" />
            )}
            {points.map((point) => (
              <circle key={point.index} cx={point.x} cy={point.y} r={4} fill="#16130f" stroke={SAND} strokeWidth={2.2} className="nut-pop" style={{ ['--d' as string]: `${0.3 + point.index * 0.07}s` }} />
            ))}
          </svg>
          <div className="mt-1 flex text-[10px] tabular-nums" style={{ color: FAINT }}>
            {weeks.map((week) => <span key={week.start} className="flex-1 text-center">{dayMonth(week.start)}</span>)}
          </div>

          <div className="mt-4 flex items-center gap-4 text-[11px]" style={{ color: DIM }}>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'rgba(232,197,138,0.3)' }} />Ø Kalorien</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: SAND }} />Gewicht</span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl px-3.5 py-3" style={{ background: 'rgba(255,247,235,0.04)' }}>
              <div className="text-[11px]" style={{ color: DIM }}>Ø Kalorien</div>
              <div className="mt-0.5 text-[18px] tabular-nums" style={{ color: TEXT }}>{averageKcal === null ? '–' : fmt(averageKcal)}<span className="text-[12px]" style={{ color: DIM }}> kcal</span></div>
            </div>
            <div className="rounded-2xl px-3.5 py-3" style={{ background: 'rgba(255,247,235,0.04)' }}>
              <div className="text-[11px]" style={{ color: DIM }}>Gewichtstrend</div>
              <div className="mt-0.5 text-[18px] tabular-nums" style={{ color: TEXT }}>
                {trend === null ? '–' : Math.abs(trend) < 0.05 ? 'stabil' : <>{signed(trend)}<span className="text-[12px]" style={{ color: DIM }}> kg / Woche</span></>}
              </div>
            </div>
          </div>
          {trend === null && <p className="mt-3 text-[12px] leading-relaxed" style={{ color: FAINT }}>Für den Trend brauche ich Gewichte aus mindestens drei Wochen.</p>}
        </>
      )}
    </section>
  );
}
