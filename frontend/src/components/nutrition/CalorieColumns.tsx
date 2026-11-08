import { useState } from 'react';
import type { OverviewDay } from '../../api/api';
import { DIM, FAINT, SAND, TEXT, fmt } from '../track/trackUtils';
import CardHeader from './CardHeader';
import { OVER, STATUS_COLOR, WEEKDAYS, kcalStatus, longDate, mean, shortDay, signed, weekdayIndex } from './overviewUtils';
import type { Range } from './overviewUtils';

const HEIGHT = 150;

/** Daily calories as columns with the goal line. Tap a column for its exact value. */
export default function CalorieColumns({ days, range }: { days: OverviewDay[]; range: Range }) {
  const [selected, setSelected] = useState<number | null>(null);
  const goal = [...days].reverse().find((day) => day.goal_kcal)?.goal_kcal ?? null;
  const logged = days.filter((day) => day.logged);
  const average = mean(logged.map((day) => day.kcal));
  const withGoal = logged.filter((day) => day.goal_kcal);
  const inTarget = withGoal.filter((day) => kcalStatus(day.kcal, true, day.goal_kcal) === 'target').length;
  const scaleMax = Math.max(goal ?? 0, ...days.map((day) => day.kcal), 1) * 1.12;
  const active = selected === null ? null : days[selected];
  const compact = range === 30;

  return (
    <section className="card-forge p-5" aria-label="Kalorienverlauf">
      <CardHeader title="Kalorien" chip={`${range} Tage`} />

      <div className="mb-4 flex min-h-[48px] items-end justify-between gap-3">
        {active ? (
          <>
            <div>
              <div className="text-[11px]" style={{ color: DIM }}>{longDate(active.date)}</div>
              <div className="text-[26px] font-light leading-tight tabular-nums" style={{ color: TEXT }}>
                {active.logged ? fmt(active.kcal) : '–'}<span className="text-[13px]" style={{ color: DIM }}> kcal</span>
              </div>
            </div>
            <div className="pb-1 text-right text-[12px]" style={{ color: active.goal_kcal && active.kcal > active.goal_kcal * 1.05 ? OVER : DIM }}>
              {!active.logged ? 'Nicht getrackt' : active.goal_kcal ? `${signed(active.kcal - active.goal_kcal, 0)} zum Ziel` : ''}
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="text-[11px]" style={{ color: DIM }}>Durchschnitt</div>
              <div className="text-[26px] font-light leading-tight tabular-nums" style={{ color: TEXT }}>
                {average === null ? '–' : fmt(average)}<span className="text-[13px]" style={{ color: DIM }}> kcal</span>
              </div>
            </div>
            <div className="pb-1 text-right text-[12px]" style={{ color: DIM }}>
              {withGoal.length > 0 ? <><span className="font-semibold" style={{ color: SAND }}>{inTarget}</span> von {withGoal.length} Tagen im Ziel</> : logged.length > 0 ? `${logged.length} Tage getrackt` : ''}
            </div>
          </>
        )}
      </div>

      {logged.length === 0 ? (
        <div className="flex items-center justify-center text-[13px]" style={{ height: HEIGHT, color: FAINT }}>Noch nichts getrackt in diesem Zeitraum.</div>
      ) : (
        <>
          <div className="relative" style={{ height: HEIGHT }}>
            {goal !== null && (
              <div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed" style={{ bottom: `${(goal / scaleMax) * 100}%`, borderColor: 'rgba(242,236,226,0.3)' }}>
                <span className="absolute right-0 -top-4 text-[10px] tabular-nums" style={{ color: FAINT }}>Ziel {fmt(goal)}</span>
              </div>
            )}
            <div className={`flex h-full items-end ${compact ? 'gap-[3px]' : 'gap-2'}`}>
              {days.map((day, index) => {
                const status = kcalStatus(day.kcal, day.logged, day.goal_kcal);
                const height = day.logged ? Math.max((day.kcal / scaleMax) * 100, 3) : 0;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelected(selected === index ? null : index)}
                    className="flex h-full min-w-0 flex-1 items-end justify-center"
                    aria-label={`${longDate(day.date)}: ${day.logged ? `${Math.round(day.kcal)} kcal` : 'nicht getrackt'}`}
                    aria-pressed={selected === index}
                  >
                    <span
                      className="nut-col block w-full rounded-t-md"
                      style={{
                        height: day.logged ? `${height}%` : 3,
                        maxWidth: compact ? undefined : 30,
                        background: STATUS_COLOR[status],
                        opacity: selected === null || selected === index ? 1 : 0.4,
                        transition: 'opacity 0.2s ease',
                        ['--d' as string]: `${index * (compact ? 0.014 : 0.05)}s`,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex gap-2 text-[11px]" style={{ color: FAINT }}>
            {compact ? (
              <><span>{shortDay(days[0].date)}</span><span className="ml-auto">{shortDay(days[days.length - 1].date)}</span></>
            ) : days.map((day) => (
              <span key={day.date} className="flex-1 text-center">{WEEKDAYS[weekdayIndex(day.date)]}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
