import { Coffee, Cookie, Dumbbell, Moon, Sun, UtensilsCrossed, Zap } from 'lucide-react';
import type { TrackMacros } from '../../api/api';
import { BORDER, CARBS, DIM, FAT, PROTEIN, TEXT, fmt } from './trackUtils';

/** Icon that matches the slot name ("Frühstück" → coffee, "Pre-Workout" → bolt). */
export function SlotIcon({ name, size = 18 }: { name: string; size?: number }) {
  const value = name.toLowerCase();
  if (/früh|breakfast|morgen/.test(value)) return <Coffee size={size} />;
  if (/mittag|lunch/.test(value)) return <Sun size={size} />;
  if (/abend|dinner|nacht/.test(value)) return <Moon size={size} />;
  if (/snack|zwischen|süß|dessert/.test(value)) return <Cookie size={size} />;
  if (/pre|vor/.test(value)) return <Zap size={size} />;
  if (/post|nach|workout|training/.test(value)) return <Dumbbell size={size} />;
  return <UtensilsCrossed size={size} />;
}

export function MacroPills({ totals, compact = false }: { totals: Pick<TrackMacros, 'protein' | 'carbs' | 'fat'>; compact?: boolean }) {
  const items = [
    { label: 'Protein', value: totals.protein, color: PROTEIN },
    { label: 'Carbs', value: totals.carbs, color: CARBS },
    { label: 'Fett', value: totals.fat, color: FAT },
  ];
  return <div className={`flex ${compact ? 'gap-3' : 'gap-2'}`}>{items.map((item) => compact
    ? <span key={item.label} className="flex items-center gap-1 text-[11px] tabular-nums" style={{ color: DIM }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} aria-hidden="true" /><span className="sr-only">{item.label} </span>{fmt(item.value)} g</span>
    : <div key={item.label} className="flex-1 rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ color: DIM }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />{item.label}</div>
      <p className="mt-1 text-[17px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(item.value)}<span className="ml-0.5 text-[11px] font-normal" style={{ color: DIM }}>g</span></p>
    </div>)}</div>;
}
