import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import type { NutritionOverview } from '../../api/api';
import { DIM, FAINT, SAND, TEXT, fmt } from '../track/trackUtils';
import { CARBS, FAT, FIBER, OVER, PROTEIN, SALT, SUGAR, TRACK } from './overviewUtils';
import { useCountUp } from './useCountUp';

const SIZE = 200;
const STROKE = 13;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Tile { label: string; value: number; goal: number; color: string; limit: boolean; decimals: number }

function MacroTile({ tile, index }: { tile: Tile; index: number }) {
  const over = tile.limit && tile.value > tile.goal;
  const pct = tile.goal > 0 ? Math.min(tile.value / tile.goal, 1) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px]" style={{ color: DIM }}>{tile.label}</span>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: over ? OVER : TEXT }}>
          {fmt(tile.value, tile.decimals)}<span style={{ color: FAINT }}> / {tile.limit ? 'max. ' : ''}{fmt(tile.goal, tile.decimals)} g</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: TRACK }}>
        <div
          className="bar-anim h-full rounded-full"
          style={{ ['--bar-w' as string]: `${pct * 100}%`, width: 'var(--bar-w)', background: over ? OVER : tile.color, animationDelay: `${0.25 + index * 0.07}s`, animationFillMode: 'both' }}
        />
      </div>
    </div>
  );
}

/** Today at a glance: calorie ring with what is left, and one slim bar per nutrient goal. */
export default function RingHero({ today }: { today: NutritionOverview['today'] }) {
  const navigate = useNavigate();
  const { totals, goals } = today;
  const eaten = Math.round(totals.kcal);
  const left = goals ? goals.kcal - eaten : 0;
  const over = goals !== null && left < 0;
  const pct = goals ? Math.min(eaten / goals.kcal, 1) : 0;
  const color = over ? OVER : SAND;
  const shown = Math.round(useCountUp(goals ? Math.abs(left) : eaten));

  const tiles: Tile[] = goals ? [
    { label: 'Protein', value: totals.protein, goal: goals.protein, color: PROTEIN, limit: false, decimals: 0 },
    { label: 'Kohlenhydrate', value: totals.carbs, goal: goals.carbs, color: CARBS, limit: false, decimals: 0 },
    { label: 'Fett', value: totals.fat, goal: goals.fat, color: FAT, limit: false, decimals: 0 },
    ...(goals.fiber != null ? [{ label: 'Ballaststoffe', value: totals.fiber, goal: goals.fiber, color: FIBER, limit: false, decimals: 0 }] : []),
    ...(goals.sugar != null ? [{ label: 'Zucker', value: totals.sugar, goal: goals.sugar, color: SUGAR, limit: true, decimals: 0 }] : []),
    ...(goals.salt != null ? [{ label: 'Salz', value: totals.salt, goal: goals.salt, color: SALT, limit: true, decimals: 1 }] : []),
  ] : [];

  return (
    <section className="card-forge forge-anim forge-d1 px-5 pb-6 pt-6" aria-label="Heute">
      <button type="button" onClick={() => navigate('/nutrition/track')} className="tap block w-full" aria-label="Heute tracken">
        <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden="true">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={TRACK} strokeWidth={STROKE} />
            {pct > 0 && (
              <circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - pct)}
                className="ring-anim"
                style={{ ['--ring-start' as string]: `${CIRCUMFERENCE}`, ['--ring-end' as string]: `${CIRCUMFERENCE * (1 - pct)}`, filter: `drop-shadow(0 0 7px ${color}55)` }}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[46px] font-light leading-none tabular-nums" style={{ color: over ? OVER : TEXT }}>{shown.toLocaleString('de-DE')}</span>
            <span className="mt-1.5 text-[13px]" style={{ color: over ? OVER : DIM }}>
              {goals ? (over ? 'kcal drüber' : 'kcal übrig') : 'kcal heute'}
            </span>
            {goals && <span className="mt-1 text-[11px] tabular-nums" style={{ color: FAINT }}>{eaten.toLocaleString('de-DE')} von {goals.kcal.toLocaleString('de-DE')}</span>}
          </div>
        </div>

        {goals ? (
          <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 text-left">
            {tiles.map((tile, index) => <MacroTile key={tile.label} tile={tile} index={index} />)}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-4 gap-2 text-center">
            {[['Protein', totals.protein, PROTEIN], ['Carbs', totals.carbs, CARBS], ['Fett', totals.fat, FAT], ['Ballast.', totals.fiber, FIBER]].map(([label, value, tint]) => (
              <div key={label as string}>
                <div className="text-[17px] tabular-nums" style={{ color: TEXT }}>{fmt(value as number)}<span className="text-[11px]" style={{ color: FAINT }}> g</span></div>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px]" style={{ color: DIM }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: tint as string }} />{label as string}
                </div>
              </div>
            ))}
          </div>
        )}
      </button>

      {!goals && (
        <button type="button" onClick={() => navigate('/settings#ziele')} className="tap mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-[14px] font-semibold" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>
          <Target size={15} />Ziele festlegen
        </button>
      )}
    </section>
  );
}
