import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle, Loader2, Target } from 'lucide-react';
import { getGoals, saveGoals } from '../api/api';
import type { GoalsData, GoalsInput } from '../api/api';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const MAX_RULES = 2000;

interface Form {
  startKg: string; startDate: string; targetKg: string; targetDate: string;
  kcal: string; protein: string; carbs: string; fat: string; sugar: string; salt: string;
  rules: string;
}

const text = (value: number | string | null | undefined) => (value === null || value === undefined ? '' : String(value));

const toForm = (data: GoalsData): Form => ({
  startKg: text(data.weight.start_kg), startDate: text(data.weight.start_date),
  targetKg: text(data.weight.target_kg), targetDate: text(data.weight.target_date),
  kcal: text(data.nutrition?.kcal), protein: text(data.nutrition?.protein), carbs: text(data.nutrition?.carbs),
  fat: text(data.nutrition?.fat), sugar: text(data.nutrition?.sugar), salt: text(data.nutrition?.salt),
  rules: data.nutrition_rules ?? '',
});

const parse = (value: string): number | null => {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : NaN;
};

type Feedback = { type: 'success' | 'error'; text: string } | null;

/** Weight goal with dates, daily kcal/macro/sugar/salt targets and free-text nutrition rules. */
export default function GoalsCard() {
  const [saved, setSaved] = useState<GoalsData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    getGoals().then((data) => { setSaved(data); setForm(toForm(data)); })
      .catch((caught: unknown) => setLoadError(caught instanceof Error ? caught.message : 'Ziele konnten nicht geladen werden.'));
  }, []);

  // /settings#ziele scrolls here once the card is rendered.
  useEffect(() => {
    if (location.hash === '#ziele' && form) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [location.hash, form !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof Form) => (value: string) => setForm((current) => current ? { ...current, [key]: value } : current);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || !saved) return;
    const numbers = {
      startKg: parse(form.startKg), targetKg: parse(form.targetKg),
      kcal: parse(form.kcal), protein: parse(form.protein), carbs: parse(form.carbs), fat: parse(form.fat),
      sugar: parse(form.sugar), salt: parse(form.salt),
    };
    if (Object.values(numbers).some((value) => Number.isNaN(value))) {
      setFeedback({ type: 'error', text: 'Bitte nur Zahlen eingeben.' });
      return;
    }
    const before = toForm(saved);
    const payload: GoalsInput = {};

    if (form.startKg !== before.startKg || form.startDate !== before.startDate) {
      payload.start_weight_kg = numbers.startKg;
      payload.start_date = form.startDate || null;
    }
    if (form.targetKg !== before.targetKg) payload.target_weight_kg = numbers.targetKg;
    if (form.targetDate !== before.targetDate) payload.target_date = form.targetDate || null;
    if ((payload.start_weight_kg != null) !== (payload.start_date != null) && 'start_date' in payload) {
      setFeedback({ type: 'error', text: 'Startgewicht und Startdatum gehören zusammen.' });
      return;
    }

    const targetKeys = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'salt'] as const;
    if (targetKeys.some((key) => form[key] !== before[key])) {
      const required = [numbers.kcal, numbers.protein, numbers.carbs, numbers.fat];
      if (required.some((value) => value === null)) {
        setFeedback({ type: 'error', text: 'Für die Tagesziele brauche ich Kalorien, Protein, Kohlenhydrate und Fett zusammen.' });
        return;
      }
      payload.kcal = numbers.kcal!; payload.protein = numbers.protein!; payload.carbs = numbers.carbs!; payload.fat = numbers.fat!;
      payload.sugar = numbers.sugar; payload.salt = numbers.salt;
    }
    if (form.rules !== before.rules) payload.nutrition_rules = form.rules;

    if (Object.keys(payload).length === 0) {
      setFeedback({ type: 'success', text: 'Nichts geändert.' });
      return;
    }
    setFeedback(null); setSaving(true);
    try {
      const next = await saveGoals(payload);
      setSaved(next); setForm(toForm(next));
      setFeedback({ type: 'success', text: 'Ziele gespeichert. Tagesziele gelten ab heute, frühere Tage behalten ihre Werte.' });
    } catch (caught: unknown) {
      setFeedback({ type: 'error', text: caught instanceof Error ? caught.message : 'Ziele konnten nicht gespeichert werden.' });
    } finally { setSaving(false); }
  };

  const progress = saved?.weight;
  const field = (label: string, key: keyof Form, props: { unit?: string; type?: string; placeholder?: string } = {}) => (
    <label className="text-[11px]" style={{ color: TEXT_DIM }}>
      {label}{props.unit ? ` (${props.unit})` : ''}
      <input
        type={props.type ?? 'text'}
        inputMode={props.type === 'date' ? undefined : 'decimal'}
        value={form?.[key] ?? ''}
        onChange={(event) => set(key)(event.target.value)}
        placeholder={props.placeholder}
        className="input-forge mt-1 !px-3 !py-2.5 text-[13px]"
        style={props.type === 'date' ? { colorScheme: 'dark' } : undefined}
      />
    </label>
  );

  return (
    <div ref={ref} id="ziele" className="forge-anim scroll-mt-4 space-y-4 rounded-[24px] p-5" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${CARD_BORDER}` }}>
      <div className="flex items-center gap-2.5">
        <Target size={15} style={{ color: SAND }} />
        <span className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>Ziele</span>
      </div>
      {loadError ? <p className="text-[12px]" style={{ color: '#fca5a5' }}>{loadError}</p> : !form ? <p className="text-[13px]" style={{ color: TEXT_DIM }}>Wird geladen…</p> : (
        <form onSubmit={submit} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="mb-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: SAND }}>Gewicht</legend>
            <div className="grid grid-cols-2 gap-3">
              {field('Startgewicht', 'startKg', { unit: 'kg', placeholder: 'z. B. 77' })}
              {field('Startdatum', 'startDate', { type: 'date' })}
              {field('Zielgewicht', 'targetKg', { unit: 'kg', placeholder: 'z. B. 74' })}
              {field('Zieldatum', 'targetDate', { type: 'date' })}
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: TEXT_DIM }}>
              Das Startdatum ist auch der Beginn des Gewichtsgraphen. Das Startgewicht wird als Gewicht dieses Tages gespeichert.
              {progress?.current_kg != null && progress.target_kg != null && <> Aktuell {progress.current_kg.toLocaleString('de-DE')} kg
                {progress.kg_to_go != null && <>, noch {Math.abs(progress.kg_to_go).toLocaleString('de-DE')} kg {progress.kg_to_go <= 0 ? 'abzunehmen' : 'zuzunehmen'}</>}
                {progress.required_rate_kg_per_week != null && <>, nötig sind {Math.abs(progress.required_rate_kg_per_week).toLocaleString('de-DE')} kg pro Woche</>}.</>}
            </p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: SAND }}>Tagesziele</legend>
            <div className="grid grid-cols-2 gap-3">
              {field('Kalorien', 'kcal', { unit: 'kcal' })}
              {field('Protein', 'protein', { unit: 'g' })}
              {field('Kohlenhydrate', 'carbs', { unit: 'g' })}
              {field('Fett', 'fat', { unit: 'g' })}
              {field('Zucker (max.)', 'sugar', { unit: 'g' })}
              {field('Salz (max.)', 'salt', { unit: 'g' })}
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: TEXT_DIM }}>Gelten ab heute. Frühere Tage werden weiter an ihren damaligen Zielen gemessen. Zucker und Salz sind optionale Obergrenzen.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: SAND }}>Ernährungsregeln</legend>
            <textarea
              value={form.rules}
              onChange={(event) => set('rules')(event.target.value.slice(0, MAX_RULES))}
              rows={4}
              maxLength={MAX_RULES}
              aria-label="Ernährungsregeln"
              placeholder="z. B. Kein Alkohol unter der Woche, abends keine Kohlenhydrate, samstags Cheat-Meal"
              className="input-forge w-full resize-y text-[13px] leading-relaxed"
            />
            <p className="text-[10px]" style={{ color: TEXT_DIM }}>Freitext. Der Coach kennt diese Regeln und berücksichtigt sie.</p>
          </fieldset>

          {feedback && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[12px]" role="status" style={{
              background: feedback.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
              border: `1px solid ${feedback.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
              color: feedback.type === 'success' ? '#34d399' : '#f87171',
            }}>
              {feedback.type === 'success' ? <CheckCircle size={14} className="mt-px shrink-0" /> : <AlertCircle size={14} className="mt-px shrink-0" />}
              {feedback.text}
            </div>
          )}
          <button type="submit" disabled={saving} className="btn-forge w-full text-[14px]">
            {saving ? <><Loader2 size={15} className="animate-spin" />Speichert…</> : <><Target size={15} />Ziele speichern</>}
          </button>
        </form>
      )}
    </div>
  );
}
