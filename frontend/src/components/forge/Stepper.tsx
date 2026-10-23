import { Minus, Plus } from 'lucide-react';

const vibrate = () => { try { navigator.vibrate?.(5); } catch { /* unsupported */ } };

/** Compact − value + control with 44 px touch targets. */
export default function Stepper({ label, value, min, max, onChange, suffix }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix?: string;
}) {
  return <div data-nodrag className="flex items-center justify-between gap-3">
    <span className="text-[13px]" style={{ color: 'rgba(242,236,226,0.75)' }}>{label}</span>
    <div className="flex items-center rounded-xl" style={{ background: 'rgba(255,247,235,0.045)', border: '1px solid rgba(255,247,235,0.09)' }}>
      <button type="button" aria-label={`${label} verringern`} disabled={value <= min} onClick={() => { vibrate(); onChange(value - 1); }} className="tap flex h-11 w-11 items-center justify-center disabled:opacity-25" style={{ color: '#f2ece0' }}><Minus size={16} /></button>
      <span className="min-w-9 text-center text-[16px] font-semibold tabular-nums" style={{ color: '#f2ece0' }} aria-live="polite">{value}{suffix ? <span className="ml-0.5 text-[11px] font-normal" style={{ color: 'rgba(242,236,226,0.5)' }}>{suffix}</span> : null}</span>
      <button type="button" aria-label={`${label} erhöhen`} disabled={value >= max} onClick={() => { vibrate(); onChange(value + 1); }} className="tap flex h-11 w-11 items-center justify-center disabled:opacity-25" style={{ color: '#f2ece0' }}><Plus size={16} /></button>
    </div>
  </div>;
}
