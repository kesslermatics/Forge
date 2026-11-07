import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import { saveNutritionGoals, type NutritionGoals } from '../../api/api';
import { haptic } from '../navigation';
import { BORDER, CARBS, DIM, FAT, PROTEIN, SAND, TEXT } from './trackUtils';

interface Props {
  current: NutritionGoals | null;
  onSaved: (goals: NutritionGoals) => void;
  onClose: () => void;
}

type Field = keyof NutritionGoals;
const FIELDS: { key: Field; label: string; unit: string; color: string; placeholder: string; min: number; max: number }[] = [
  { key: 'kcal', label: 'Kalorien', unit: 'kcal', color: SAND, placeholder: 'z. B. 2500', min: 800, max: 10000 },
  { key: 'protein', label: 'Protein', unit: 'g', color: PROTEIN, placeholder: 'z. B. 160', min: 0, max: 600 },
  { key: 'carbs', label: 'Kohlenhydrate', unit: 'g', color: CARBS, placeholder: 'z. B. 280', min: 0, max: 1500 },
  { key: 'fat', label: 'Fett', unit: 'g', color: FAT, placeholder: 'z. B. 80', min: 0, max: 600 },
];

const parse = (value: string): number | null => {
  const number = Number(value.replace(',', '.'));
  return value.trim() !== '' && Number.isFinite(number) ? Math.round(number) : null;
};

/** Daily calorie and macro targets. The change applies from today; earlier days keep their targets. */
export default function GoalsSheet({ current, onSaved, onClose }: Props) {
  const [values, setValues] = useState<Record<Field, string>>({
    kcal: current ? String(current.kcal) : '',
    protein: current ? String(current.protein) : '',
    carbs: current ? String(current.carbs) : '',
    fat: current ? String(current.fat) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Object.fromEntries(FIELDS.map((field) => [field.key, parse(values[field.key])])) as Record<Field, number | null>;
  const valid = FIELDS.every((field) => parsed[field.key] !== null && parsed[field.key]! >= field.min && parsed[field.key]! <= field.max);
  const macroKcal = (parsed.protein ?? 0) * 4 + (parsed.carbs ?? 0) * 4 + (parsed.fat ?? 0) * 9;
  const mismatch = valid && parsed.kcal! > 0 && Math.abs(macroKcal - parsed.kcal!) > parsed.kcal! * 0.1;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true); setError(null);
    try {
      const result = await saveNutritionGoals({ kcal: parsed.kcal!, protein: parsed.protein!, carbs: parsed.carbs!, fat: parsed.fat! });
      haptic('success');
      onSaved(result.current);
      onClose();
    } catch (caught: unknown) {
      haptic('warning');
      setError(caught instanceof Error ? caught.message : 'Speichern fehlgeschlagen.');
      setSaving(false);
    }
  };

  return <ForgeSheet label="Tagesziele" onClose={onClose}>
    <form className="p-1" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Ernährung</p>
          <h2 className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>Tagesziele</h2>
          <p className="mt-1 text-[11px]" style={{ color: DIM }}>Gilt ab heute. Frühere Tage werden weiter mit ihrem damaligen Ziel verglichen.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
      </div>

      <div className="mt-4 space-y-2">{FIELDS.map((field, index) => <label key={field.key} className="flex h-14 items-center gap-3 rounded-2xl px-4" style={{ background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: field.color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px]" style={{ color: TEXT }}>{field.label}</span>
        <input
          value={values[field.key]}
          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value.replace(/[^\d]/g, '').slice(0, 5) }))}
          onFocus={(event) => event.target.select()}
          inputMode="numeric"
          enterKeyHint={index === FIELDS.length - 1 ? 'done' : 'next'}
          autoFocus={index === 0 && !current}
          placeholder={field.placeholder}
          aria-label={`${field.label} in ${field.unit}`}
          className="track-amount-input w-24 bg-transparent text-right text-[20px] font-semibold tabular-nums outline-none"
          style={{ color: TEXT }}
        />
        <span className="w-8 text-[12px]" style={{ color: DIM }}>{field.unit}</span>
      </label>)}</div>

      {valid && <p className="mt-3 text-[11px] tabular-nums" style={{ color: mismatch ? CARBS : DIM }}>
        Die Makros ergeben rund {macroKcal.toLocaleString('de-DE')} kcal{mismatch ? ' und weichen vom Kalorienziel ab.' : '.'}
      </p>}
      {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}

      <button type="submit" disabled={!valid || saving} className="btn-forge mt-5 h-12 w-full text-[14px] disabled:opacity-40">
        {saving ? <Loader2 size={16} className="animate-spin" /> : null}Speichern
      </button>
    </form>
  </ForgeSheet>;
}
