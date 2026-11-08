import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { OverviewFood } from '../../api/api';
import { DIM, FAINT, SAND, TEXT, fmt } from '../track/trackUtils';
import CardHeader from './CardHeader';
import type { Range } from './overviewUtils';

/** Most frequently tracked foods; a tap opens the product to track it again. */
export default function TopFoodsCard({ foods, range }: { foods: OverviewFood[]; range: Range }) {
  const navigate = useNavigate();
  if (foods.length === 0) return null;
  return (
    <section className="card-forge p-5" aria-label="Häufig gegessen">
      <CardHeader title="Häufig gegessen" chip={`${range} Tage`} />
      <ul className="-mx-2 space-y-1">
        {foods.map((food, index) => (
          <li key={`${food.source}:${food.source_id}`}>
            <button
              type="button"
              onClick={() => navigate(`/nutrition/food/${food.source}/${encodeURIComponent(food.source_id)}`)}
              className="tap flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-2 text-left"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]" style={{ color: TEXT }}>{food.name}</span>
                <span className="block truncate text-[11px]" style={{ color: FAINT }}>{food.brand ? `${food.brand} · ` : ''}Ø {fmt(food.avg_kcal)} kcal</span>
              </span>
              <span className="shrink-0 text-[13px] tabular-nums" style={{ color: DIM }}>{food.count}×</span>
              <ChevronRight size={16} className="shrink-0" style={{ color: FAINT }} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
