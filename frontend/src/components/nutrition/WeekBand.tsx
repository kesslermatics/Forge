import { useNavigate } from 'react-router-dom';
import { Flame } from 'lucide-react';
import type { NutritionOverview } from '../../api/api';
import { DIM, FAINT, SAND, TEXT } from '../track/trackUtils';
import { STATUS_COLOR, TRACK, WEEKDAYS, dayOfMonth, kcalStatus } from './overviewUtils';

const SIZE = 44;
const STROKE = 4.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Monday to Sunday of the current week as small rings, plus the logging streak. */
export default function WeekBand({ week, streak, today }: { week: NutritionOverview['week']; streak: number; today: string }) {
  const navigate = useNavigate();
  return (
    <section className="card-forge forge-anim forge-d2 px-3 pb-4 pt-4" aria-label="Diese Woche">
      <div className="grid grid-cols-7">
        {week.map((day, index) => {
          const status = kcalStatus(day.kcal, day.logged, day.goal_kcal);
          const pct = day.logged ? (day.goal_kcal ? Math.min(day.kcal / day.goal_kcal, 1) : 1) : 0;
          const isToday = day.date === today;
          return (
            <button
              key={day.date}
              type="button"
              disabled={day.future}
              onClick={() => navigate(isToday ? '/nutrition/track' : `/nutrition/track?date=${day.date}`)}
              className="tap flex flex-col items-center gap-1.5 py-1 disabled:pointer-events-none"
              aria-label={`${WEEKDAYS[index]}, ${day.date}${day.logged ? `, ${Math.round(day.kcal)} kcal` : ''}`}
            >
              <span className="text-[11px] font-medium" style={{ color: isToday ? SAND : FAINT }}>{WEEKDAYS[index]}</span>
              <span className="relative block" style={{ width: SIZE, height: SIZE, opacity: day.future ? 0.4 : 1 }}>
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden="true">
                  <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={isToday ? 'rgba(232,197,138,0.22)' : TRACK} strokeWidth={STROKE} />
                  {pct > 0 && (
                    <circle
                      cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={STATUS_COLOR[status]} strokeWidth={STROKE} strokeLinecap="round"
                      strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - pct)}
                      className="ring-anim"
                      style={{ ['--ring-start' as string]: `${CIRCUMFERENCE}`, ['--ring-end' as string]: `${CIRCUMFERENCE * (1 - pct)}`, animationDelay: `${0.15 + index * 0.06}s`, animationFillMode: 'both' }}
                    />
                  )}
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[13px] tabular-nums" style={{ color: isToday ? SAND : day.logged ? TEXT : DIM, fontWeight: isToday ? 700 : 500 }}>
                  {dayOfMonth(day.date)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px]" style={{ color: DIM }}>
        <Flame size={13} style={{ color: streak > 0 ? SAND : FAINT }} />
        {streak > 0 ? <span><span className="font-semibold" style={{ color: TEXT }}>{streak}</span> {streak === 1 ? 'Tag' : 'Tage'} in Folge getrackt</span> : <span>Tracke heute, um eine Serie zu starten</span>}
      </div>
    </section>
  );
}
