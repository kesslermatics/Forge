import type { OverviewMeal } from '../../api/api';
import { DIM, FAINT, TEXT } from '../track/trackUtils';
import CardHeader from './CardHeader';
import { MEAL_PALETTE } from './overviewUtils';
import type { Range } from './overviewUtils';

/** Share of calories per meal slot as one stacked bar with a legend. */
export default function MealsCard({ meals, range }: { meals: OverviewMeal[]; range: Range }) {
  const total = meals.reduce((sum, meal) => sum + meal.kcal, 0);
  return (
    <section className="card-forge p-5" aria-label="Mahlzeiten">
      <CardHeader title="Verteilung auf Mahlzeiten" chip={`${range} Tage`} />
      {total === 0 ? (
        <p className="py-4 text-center text-[13px]" style={{ color: FAINT }}>Noch nichts getrackt in diesem Zeitraum.</p>
      ) : (
        <>
          <div className="flex h-4 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
            {meals.map((meal, index) => (
              <span
                key={meal.name}
                className="nut-seg h-full rounded-[5px]"
                style={{ flex: `${meal.kcal} 1 0`, background: MEAL_PALETTE[index % MEAL_PALETTE.length], ['--d' as string]: `${index * 0.08}s` }}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {meals.map((meal, index) => (
              <li key={meal.name} className="flex items-center gap-3 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MEAL_PALETTE[index % MEAL_PALETTE.length] }} />
                <span className="min-w-0 flex-1 truncate" style={{ color: TEXT }}>{meal.name}</span>
                <span className="tabular-nums" style={{ color: DIM }}>{Math.round((meal.kcal / total) * 100)} %</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
