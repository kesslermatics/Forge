import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Target } from 'lucide-react';
import type { NutritionGoals, TrackMacros } from '../../api/api';
import { OVER, TRACK } from '../nutrition/overviewUtils';
import { useCountUp } from '../nutrition/useCountUp';
import { MacroPills } from './shared';
import { CARBS, DIM, FAINT, FAT, PROTEIN, SAND, TEXT, fmt } from './trackUtils';

type Macros = Pick<TrackMacros, 'kcal' | 'protein' | 'carbs' | 'fat'>;

/** Bars grow from zero once after mounting; later changes glide via the CSS transition. */
function useShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return shown;
}

const GLIDE = 'width 0.55s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.3s';

interface MacroLine { key: 'protein' | 'carbs' | 'fat'; label: string; short: string; color: string; /** Reaching it is the point (protein); for the others, going over is the warning. */ minimum: boolean }
const MACROS: MacroLine[] = [
  { key: 'protein', label: 'Protein', short: 'P', color: PROTEIN, minimum: true },
  { key: 'carbs', label: 'Carbs', short: 'C', color: CARBS, minimum: false },
  { key: 'fat', label: 'Fett', short: 'F', color: FAT, minimum: false },
];

/* ── Day page: ring with what is left, one column per macro ──────────────────── */

const RING = 108;
const RING_STROKE = 10;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

function Ring({ pct, color }: { pct: number; color: string }) {
  const shown = useShown();
  const offset = RING_C * (1 - (shown ? Math.min(pct, 1) : 0));
  return <div className="relative shrink-0" style={{ width: RING, height: RING }}>
    <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="-rotate-90" aria-hidden="true">
      <circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke={TRACK} strokeWidth={RING_STROKE} />
      <circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke={color} strokeWidth={RING_STROKE} strokeLinecap="round"
        strokeDasharray={RING_C} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.3s', filter: `drop-shadow(0 0 6px ${color}55)`, opacity: pct > 0 ? 1 : 0 }} />
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <span className="text-[19px] font-semibold leading-none tabular-nums" style={{ color: TEXT }}>{Math.round(pct * 100)}<span className="text-[11px] font-normal" style={{ color: DIM }}> %</span></span>
      <span className="mt-1 text-[9.5px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>vom Ziel</span>
    </div>
  </div>;
}

function MacroColumn({ line, eaten, goal, delay }: { line: MacroLine; eaten: number; goal: number; delay: number }) {
  const shown = useShown();
  const left = goal - eaten;
  const reached = line.minimum && left <= 0;
  const over = !line.minimum && left < 0;
  const pct = goal > 0 ? Math.min(eaten / goal, 1) : 0;
  const fill = over ? OVER : line.color;
  return <div className="min-w-0">
    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} />{line.label}
    </p>
    <p className="mt-1 flex items-baseline gap-1 tabular-nums" style={{ color: over ? OVER : TEXT }}>
      {reached
        ? <span className="flex items-center gap-1 text-[15px] font-semibold" style={{ color: line.color }}><Check size={14} strokeWidth={2.6} />Ziel</span>
        : <><span className="text-[18px] font-semibold leading-none">{fmt(Math.abs(left))}</span><span className="text-[11px]" style={{ color: over ? OVER : DIM }}>g {over ? 'drüber' : 'übrig'}</span></>}
    </p>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: TRACK }}>
      <div className="h-full rounded-full" style={{ width: `${shown ? pct * 100 : 0}%`, background: fill, transition: GLIDE, transitionDelay: shown ? '0s' : `${delay}s` }} />
    </div>
    <p className="mt-1 text-[10.5px] tabular-nums" style={{ color: FAINT }}>{fmt(eaten)} / {fmt(goal)} g</p>
  </div>;
}

/** Day summary at the top of the tracking page: what is left today, or the plain totals without goals. */
export function DayBudgetCard({ totals, goals, entryCount }: { totals: TrackMacros; goals: NutritionGoals | null; entryCount: number }) {
  const navigate = useNavigate();
  const eaten = Math.round(totals.kcal);
  const left = goals ? goals.kcal - eaten : 0;
  const over = goals !== null && left < 0;
  const big = Math.round(useCountUp(goals ? Math.abs(left) : eaten, 700));
  const entries = `${entryCount} ${entryCount === 1 ? 'Eintrag' : 'Einträge'}`;

  if (!goals) return <section className="card-forge forge-anim forge-d1 p-5" style={{ borderColor: `${SAND}24` }}>
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: DIM }}>Tagessumme</p>
      <p className="text-[11px]" style={{ color: DIM }}>{entries}</p>
    </div>
    <p className="mt-1 text-[40px] font-light leading-none tabular-nums" style={{ color: TEXT }}>{big.toLocaleString('de-DE')}<span className="ml-1.5 text-[15px]" style={{ color: DIM }}>kcal</span></p>
    <div className="mt-4"><MacroPills totals={totals} /></div>
    <button type="button" onClick={() => navigate('/settings#ziele')} className="tap mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-2xl text-[13px] font-semibold" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>
      <Target size={14} />Ziele festlegen, um zu sehen, was übrig ist
    </button>
  </section>;

  return <section className="card-forge forge-anim forge-d1 p-5" style={{ borderColor: `${over ? OVER : SAND}2e` }} aria-label="Tagesbudget">
    <div className="flex items-center gap-4">
      <Ring pct={goals.kcal > 0 ? eaten / goals.kcal : 0} color={over ? OVER : SAND} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: over ? OVER : DIM }}>{over ? 'Über dem Ziel' : 'Noch übrig'}</p>
        <p className="mt-1 text-[40px] font-light leading-none tabular-nums" style={{ color: over ? OVER : TEXT }}>
          {big.toLocaleString('de-DE')}<span className="ml-1.5 text-[15px]" style={{ color: over ? OVER : DIM }}>kcal</span>
        </p>
        <p className="mt-2 text-[11.5px] tabular-nums" style={{ color: FAINT }}>
          <span style={{ color: DIM }}>{eaten.toLocaleString('de-DE')}</span> gegessen · Ziel {goals.kcal.toLocaleString('de-DE')}
        </p>
        <p className="mt-0.5 text-[11px]" style={{ color: FAINT }}>{entries}</p>
      </div>
    </div>
    <div className="mt-5 grid grid-cols-3 gap-4 border-t pt-4" style={{ borderColor: 'rgba(232,197,138,0.1)' }}>
      {MACROS.map((line, index) => <MacroColumn key={line.key} line={line} eaten={totals[line.key]} goal={goals[line.key]} delay={0.15 + index * 0.06} />)}
    </div>
  </section>;
}

/* ── Meal page: slim strip that moves with every add ─────────────────────────── */

/**
 * The day's budget seen from one meal. `day` is the whole day including this meal, `meal` this meal's
 * share; the bar shows the other meals dimmed and this meal bright, so each add visibly eats into what is left.
 */
export function MealBudgetStrip({ day, meal, goals, mealName }: { day: Macros; meal: Macros; goals: NutritionGoals | null; mealName: string }) {
  const shown = useShown();
  if (!goals) return <MacroPills totals={meal} />;

  const eaten = Math.max(day.kcal, 0);
  const left = Math.round(goals.kcal - eaten);
  const over = left < 0;
  // Over the goal the bar is the whole day; otherwise the goal is the full width.
  const scale = Math.max(goals.kcal, eaten) || 1;
  const others = Math.max(eaten - meal.kcal, 0) / scale;
  const mine = Math.max(meal.kcal, 0) / scale;
  const tone = over ? OVER : SAND;

  return <section className="card-forge px-4 pb-3.5 pt-3" aria-label="Tagesbudget">
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[13px]" style={{ color: DIM }}>
        <span key={left} className="track-number inline-block text-[17px] font-semibold tabular-nums" style={{ color: over ? OVER : TEXT }}>{Math.abs(left).toLocaleString('de-DE')}</span>
        {' '}kcal {over ? 'über dem Ziel' : 'heute übrig'}
      </p>
      <p className="shrink-0 text-[11px] tabular-nums" style={{ color: FAINT }}>Ziel {goals.kcal.toLocaleString('de-DE')}</p>
    </div>
    <div className="mt-2 flex h-2 overflow-hidden rounded-full" style={{ background: TRACK }}
      role="img" aria-label={`Andere Mahlzeiten ${Math.round(eaten - meal.kcal)} kcal, ${mealName} ${Math.round(meal.kcal)} kcal, Ziel ${goals.kcal} kcal`}>
      <span className="h-full" style={{ width: `${shown ? others * 100 : 0}%`, background: tone, opacity: 0.38, transition: GLIDE }} />
      <span className="h-full" style={{ width: `${shown ? mine * 100 : 0}%`, background: tone, transition: GLIDE, boxShadow: mine > 0 ? `0 0 8px ${tone}66` : undefined }} />
    </div>
    <div className="mt-2.5 flex items-center gap-3 text-[11px] tabular-nums">
      {MACROS.map((line) => {
        const rest = goals[line.key] - day[line.key];
        const warn = !line.minimum && rest < 0;
        const done = line.minimum && rest <= 0;
        return <span key={line.key} className="flex items-center gap-1" style={{ color: warn ? OVER : DIM }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: line.color }} aria-hidden="true" />
          <span className="sr-only">{line.label} </span>
          {done ? <Check size={12} strokeWidth={2.6} style={{ color: line.color }} aria-label="Ziel erreicht" />
            : <><span style={{ color: warn ? OVER : TEXT }}>{fmt(Math.abs(rest))}</span> g{warn ? ' drüber' : ''}</>}
        </span>;
      })}
      <span className="ml-auto flex min-w-0 items-center gap-1.5" style={{ color: FAINT }}>
        <span className="h-1.5 w-3 shrink-0 rounded-full" style={{ background: tone }} aria-hidden="true" /><span className="truncate">{mealName}</span>
      </span>
    </div>
  </section>;
}
