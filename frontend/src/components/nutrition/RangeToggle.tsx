import { DIM, SAND } from '../track/trackUtils';
import type { Range } from './overviewUtils';

const OPTIONS: { value: Range; label: string }[] = [{ value: 7, label: '7 Tage' }, { value: 30, label: '30 Tage' }];

/** Segmented control with a sliding thumb; drives every range-dependent card below it. */
export default function RangeToggle({ value, onChange }: { value: Range; onChange: (value: Range) => void }) {
  const index = OPTIONS.findIndex((option) => option.value === value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: DIM }}>Auswertung</span>
      <div role="tablist" aria-label="Zeitraum" className="relative grid h-10 grid-cols-2 rounded-full p-1" style={{ background: 'rgba(255,247,235,0.06)', width: 188 }}>
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1 top-1 rounded-full"
          style={{ width: 'calc(50% - 4px)', background: SAND, transform: `translateX(${index * 100}%)`, transition: 'transform 0.35s cubic-bezier(0.22,1,0.36,1)' }}
        />
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === value}
            onClick={() => onChange(option.value)}
            className="relative z-10 rounded-full text-[13px] font-semibold"
            style={{ color: option.value === value ? '#16130f' : DIM, transition: 'color 0.25s ease' }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
