import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { getNutritionOverview } from '../api/api';
import type { NutritionOverview } from '../api/api';
import CalorieColumns from './nutrition/CalorieColumns';
import MealsCard from './nutrition/MealsCard';
import ProteinCard from './nutrition/ProteinCard';
import RangeToggle from './nutrition/RangeToggle';
import RingHero from './nutrition/RingHero';
import TopFoodsCard from './nutrition/TopFoodsCard';
import WeekBand from './nutrition/WeekBand';
import WeightTrend from './nutrition/WeightTrend';
import type { Range } from './nutrition/overviewUtils';
import { DIM, SAND, TEXT } from './track/trackUtils';

/** Kept between visits so the page opens instantly and refreshes in the background. */
let cached: NutritionOverview | null = null;

function Skeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="forge-skeleton h-[400px] rounded-3xl" />
      <div className="forge-skeleton h-[130px] rounded-3xl" />
      <div className="forge-skeleton h-[300px] rounded-3xl" />
    </div>
  );
}

export default function NutritionPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<NutritionOverview | null>(cached);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<Range>(7);

  const load = useCallback(() => {
    getNutritionOverview()
      .then((next) => { cached = next; setData(next); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const rangeKey = range === 7 ? '7' : '30';

  return (
    <div className="space-y-5">
      <header className="forge-anim flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: TEXT }}>Ernährung</h1>
        <button type="button" onClick={() => navigate('/nutrition/track')} className="tap flex h-10 items-center gap-1.5 rounded-full pl-3 pr-4 text-[13px] font-semibold" style={{ color: '#16130f', background: SAND }}>
          <Plus size={16} />Tracken
        </button>
      </header>

      {!data ? (
        failed ? (
          <div className="card-forge flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[14px]" style={{ color: DIM }}>Die Übersicht konnte nicht geladen werden.</p>
            <button type="button" onClick={() => { setFailed(false); load(); }} className="tap flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>
              <RefreshCw size={14} />Erneut versuchen
            </button>
          </div>
        ) : <Skeleton />
      ) : (
        <>
          <RingHero today={data.today} />
          <WeekBand week={data.week} streak={data.streak_days} today={data.today.date} />

          <div className="forge-anim forge-d3"><RangeToggle value={range} onChange={setRange} /></div>

          <div className="forge-anim forge-d3"><CalorieColumns key={range} days={data.days.slice(-range)} range={range} /></div>
          <div className="forge-anim forge-d4"><WeightTrend weeks={data.weeks} /></div>
          <div className="forge-anim forge-d5"><ProteinCard key={range} days={data.days.slice(-range)} range={range} weightKg={data.weight_kg} /></div>
          <div className="forge-anim forge-d6"><MealsCard key={range} meals={data.meals[rangeKey]} range={range} /></div>
          {data.top_foods[rangeKey].length > 0 && <div className="forge-anim forge-d6"><TopFoodsCard foods={data.top_foods[rangeKey]} range={range} /></div>}
        </>
      )}
    </div>
  );
}
