import type { OverviewDay } from '../../api/api';
import { DIM, FAINT, TEXT, fmt } from '../track/trackUtils';
import CardHeader from './CardHeader';
import { FIBER, HIT_MIN, PROTEIN, TRACK, mean } from './overviewUtils';
import type { Range } from './overviewUtils';

type Pick = (day: OverviewDay) => { value: number; goal: number | null };

const hit = (day: OverviewDay, pick: Pick) => {
  const { value, goal } = pick(day);
  return day.logged && goal !== null && goal > 0 && value >= goal * HIT_MIN;
};

function Block({ label, color, days, pick, perKg }: { label: string; color: string; days: OverviewDay[]; pick: Pick; perKg: number | null }) {
  const logged = days.filter((day) => day.logged);
  const average = mean(logged.map((day) => pick(day).value));
  const withGoal = logged.filter((day) => (pick(day).goal ?? 0) > 0);
  const hits = withGoal.filter((day) => hit(day, pick)).length;
  const compact = days.length > 7;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px]" style={{ color: DIM }}>{label} Ø pro Tag</div>
          <div className="text-[26px] font-light leading-tight tabular-nums" style={{ color: TEXT }}>
            {average === null ? '–' : fmt(average)}<span className="text-[13px]" style={{ color: DIM }}> g</span>
          </div>
          {perKg !== null && average !== null && <div className="text-[12px] tabular-nums" style={{ color: DIM }}>{fmt(average / perKg, 1)} g pro kg Körpergewicht</div>}
        </div>
        {withGoal.length > 0 && (
          <div className="pb-1 text-right text-[12px]" style={{ color: DIM }}>
            Ziel an <span className="font-semibold" style={{ color }}>{hits}</span> von {withGoal.length} Tagen
          </div>
        )}
      </div>
      <div className={`mt-3 flex ${compact ? 'gap-[2px]' : 'gap-1.5'}`} aria-hidden="true">
        {days.map((day, index) => (
          <span
            key={day.date}
            className="nut-col h-6 min-w-0 flex-1 rounded-md"
            style={{
              background: !day.logged ? TRACK : hit(day, pick) ? color : `${color}40`,
              ['--d' as string]: `${index * (compact ? 0.012 : 0.05)}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Protein (and fiber when a goal is set): daily average, per kg body weight, and on which days the goal was met. */
export default function ProteinCard({ days, range, weightKg }: { days: OverviewDay[]; range: Range; weightKg: number | null }) {
  const hasFiberGoal = days.some((day) => day.goal_fiber !== null);
  return (
    <section className="card-forge space-y-5 p-5" aria-label="Protein">
      <CardHeader title={hasFiberGoal ? 'Protein und Ballaststoffe' : 'Protein'} chip={`${range} Tage`} />
      <Block label="Protein" color={PROTEIN} days={days} pick={(day) => ({ value: day.protein, goal: day.goal_protein })} perKg={weightKg} />
      {hasFiberGoal && <Block label="Ballaststoffe" color={FIBER} days={days} pick={(day) => ({ value: day.fiber, goal: day.goal_fiber })} perKg={null} />}
      <p className="text-[11px]" style={{ color: FAINT }}>Ziel erreicht ab {Math.round(HIT_MIN * 100)} % des Tagesziels.</p>
    </section>
  );
}
