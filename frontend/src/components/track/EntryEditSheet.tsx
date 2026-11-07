import { useState } from 'react';
import { ChevronRight, Loader2, Trash2, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import type { TrackEntry } from '../../api/api';
import AmountInput from './AmountInput';
import { MacroPills } from './shared';
import { DIM, SAND, TEXT, fmt, parseAmount, scaled, toAmountInput } from './trackUtils';

interface Props {
  entry: TrackEntry;
  onSave: (amount: number) => Promise<void>;
  onDelete: () => void;
  onOpenFood: () => void;
  onClose: () => void;
}

export default function EntryEditSheet({ entry, onSave, onDelete, onOpenFood, onClose }: Props) {
  const [value, setValue] = useState(toAmountInput(entry.amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(value);
  const preview = (field: 'kcal' | 'protein' | 'carbs' | 'fat') => scaled(entry.per_100[field], amount ?? 0) ?? 0;

  const save = async () => {
    if (amount == null) return;
    setSaving(true); setError(null);
    try { await onSave(amount); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Speichern fehlgeschlagen.'); setSaving(false); }
  };

  return <ForgeSheet label={`${entry.name} bearbeiten`} onClose={onClose}>
    <div className="p-1">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpenFood} className="tap min-w-0 text-left">
          <h2 className="text-[18px] font-semibold leading-snug" style={{ color: TEXT }}>{entry.name}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-[12px]" style={{ color: DIM }}>{entry.brand ? `${entry.brand} · ` : ''}Produkt ansehen<ChevronRight size={12} /></p>
        </button>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
      </div>
      <div className="mt-4"><AmountInput value={value} unit={entry.unit} onChange={setValue} /></div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-[32px] font-light leading-none tabular-nums" style={{ color: TEXT }}>{fmt(preview('kcal'))}<span className="ml-1 text-[13px]" style={{ color: DIM }}>kcal</span></p>
      </div>
      <div className="mt-3"><MacroPills totals={{ protein: preview('protein'), carbs: preview('carbs'), fat: preview('fat') }} /></div>
      {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onDelete} aria-label="Eintrag löschen" className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ color: '#fca5a5', border: '1px solid rgba(248,113,113,0.3)' }}><Trash2 size={17} /></button>
        <button type="button" onClick={() => void save()} disabled={amount == null || saving || amount === entry.amount} className="btn-forge h-12 flex-1 text-[14px] disabled:opacity-40">{saving ? <Loader2 size={16} className="animate-spin" /> : null}Speichern</button>
      </div>
      <p className="mt-3 text-center text-[10px]" style={{ color: DIM }}>Werte aus dem Stand beim Tracken · <span style={{ color: SAND }}>{fmt(entry.per_100.kcal)} kcal / 100 {entry.unit}</span></p>
    </div>
  </ForgeSheet>;
}
