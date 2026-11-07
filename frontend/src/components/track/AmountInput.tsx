import { Minus, Plus } from 'lucide-react';
import type { FoodServing, FoodUnit } from '../../api/api';
import { BORDER, DIM, SAND, TEXT, parseAmount, toAmountInput } from './trackUtils';

interface Props {
  value: string;
  unit: FoodUnit;
  onChange: (value: string) => void;
  servings?: FoodServing[];
  autoFocus?: boolean;
}

/** Large amount field with steppers and one-tap serving chips. */
export default function AmountInput({ value, unit, onChange, servings = [], autoFocus = false }: Props) {
  const current = parseAmount(value) ?? 0;
  const step = current >= 200 ? 25 : current >= 50 ? 10 : 5;
  const nudge = (delta: number) => onChange(toAmountInput(Math.max(1, Math.round((current + delta) / step) * step)));

  return <div>
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => nudge(-step)} disabled={current <= step} aria-label={`${step} ${unit} weniger`} className="tap flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl disabled:opacity-30" style={{ color: SAND, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}><Minus size={20} /></button>
      <label className="flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl px-3" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${SAND}55` }}>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, '').slice(0, 7))}
          onFocus={(event) => event.target.select()}
          inputMode="decimal"
          autoFocus={autoFocus}
          aria-label={`Menge in ${unit === 'ml' ? 'Millilitern' : 'Gramm'}`}
          className="track-amount-input w-24 min-w-0 bg-transparent text-right text-[26px] font-semibold tabular-nums outline-none"
          style={{ color: TEXT }}
        />
        <span className="text-[15px]" style={{ color: DIM }}>{unit}</span>
      </label>
      <button type="button" onClick={() => nudge(step)} aria-label={`${step} ${unit} mehr`} className="tap flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl" style={{ color: SAND, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}><Plus size={20} /></button>
    </div>
    {servings.length > 0 && <div className="forge-chip-row -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">{servings.map((serving) => {
      const active = parseAmount(value) === serving.amount;
      return <button key={`${serving.label}-${serving.amount}`} type="button" onClick={() => onChange(toAmountInput(serving.amount))} aria-pressed={active}
        className="tap flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px]"
        style={{ color: active ? '#16130f' : TEXT, background: active ? SAND : 'rgba(255,247,235,0.05)', border: `1px solid ${active ? SAND : BORDER}` }}>
        <span className="font-medium">{serving.label}</span>{serving.detail && <span style={{ opacity: 0.7 }}>{serving.detail}</span>}
      </button>;
    })}</div>}
  </div>;
}
