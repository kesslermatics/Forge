import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Minus, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import { createTrackEntry, deleteTrackEntry, getMealIdeas, type MealIdea, type MealIdeaItem, type TrackEntry } from '../../api/api';
import { haptic } from '../navigation';
import { MacroPills } from './shared';
import { BORDER, DIM, FAINT, SAND, TEXT, fmt, parseAmount, toAmountInput } from './trackUtils';

interface Props {
  date: string;
  slotId: string | null;
  slotName: string;
  /** What is left of the day when the sheet opens (from the page's live totals). */
  remainingKcal: number | null;
  remainingProtein: number | null;
  onTracked: (entry: TrackEntry) => void;
  onRemoved: (entry: TrackEntry) => void;
  onClose: () => void;
}

/** One ingredient of the idea as the user is building it: own amount, tracked or not. */
interface Row { item: MealIdeaItem; draft: string; entry: TrackEntry | null; busy: boolean }

const PLACEHOLDER = 'Optional: worauf hast du Lust? z. B. „Müsli mit dem griechischen Joghurt“';
const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;
const rowAmount = (row: Row) => row.entry?.amount ?? parseAmount(row.draft) ?? 0;
const macrosOf = (row: Row) => {
  const amount = rowAmount(row);
  const per = row.item.per_100;
  return { kcal: per.kcal * amount / 100, protein: per.protein * amount / 100, carbs: per.carbs * amount / 100, fat: per.fat * amount / 100 };
};
const stepFor = (amount: number) => amount >= 200 ? 25 : amount >= 50 ? 10 : 5;

/** "Was passt noch?": the AI proposes one meal from the user's own foods; each ingredient is tuned and tracked on its own. */
export default function MealIdeasSheet({ date, slotId, slotName, remainingKcal, remainingProtein, onTracked, onRemoved, onClose }: Props) {
  // The page's totals move as ingredients get tracked; the budget of this idea is the one at opening.
  const [budget] = useState(() => ({ kcal: remainingKcal, protein: remainingProtein }));
  const [wish, setWish] = useState('');
  const [idea, setIdea] = useState<MealIdea | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => () => { request.current += 1; }, []);

  const patch = (index: number, changes: Partial<Row>) =>
    setRows((current) => current.map((row, position) => position === index ? { ...row, ...changes } : row));

  const load = async () => {
    const id = ++request.current;
    haptic('tap');
    setLoading(true); setError(null);
    try {
      const result = await getMealIdeas({ date, slot_id: slotId, wish: wish.trim() || undefined });
      if (id !== request.current) return;
      const next = result.ideas[0] ?? null;
      setIdea(next);
      // Ingredients already tracked stay in the meal; the new idea only replaces the open ones.
      setRows((current) => [
        ...current.filter((row) => row.entry),
        ...(next?.items ?? []).map((item) => ({ item, draft: toAmountInput(item.amount), entry: null, busy: false })),
      ]);
    } catch (caught: unknown) {
      if (id === request.current) setError(errorText(caught, 'Der Vorschlag konnte nicht geladen werden.'));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  const nudge = (index: number, direction: 1 | -1) => {
    const current = parseAmount(rows[index].draft) ?? 0;
    const step = stepFor(direction > 0 ? current : current - 1);
    const next = Math.max(step, Math.round((current + direction * step) / step) * step);
    haptic('tap');
    patch(index, { draft: toAmountInput(next) });
  };

  const trackRow = async (index: number) => {
    const row = rows[index];
    const amount = parseAmount(row.draft);
    if (!row || row.busy || row.entry || !amount) return;
    patch(index, { busy: true }); setError(null);
    try {
      const entry = await createTrackEntry({ date, slot_id: slotId, source: row.item.source, source_id: row.item.source_id, amount });
      onTracked(entry);
      haptic('success');
      patch(index, { busy: false, entry });
    } catch (caught: unknown) {
      haptic('warning');
      patch(index, { busy: false });
      setError(errorText(caught, `${row.item.name} konnte nicht getrackt werden.`));
    }
  };

  const untrackRow = async (index: number) => {
    const row = rows[index];
    if (!row?.entry || row.busy) return;
    const entry = row.entry;
    patch(index, { busy: true }); setError(null);
    try {
      await deleteTrackEntry(entry.id);
      onRemoved(entry);
      haptic('tap');
      patch(index, { busy: false, entry: null, draft: toAmountInput(entry.amount) });
    } catch (caught: unknown) {
      patch(index, { busy: false });
      setError(errorText(caught, 'Entfernen fehlgeschlagen.'));
    }
  };

  const trackAll = async () => {
    for (const [index, row] of rows.entries()) {
      if (!row.entry && parseAmount(row.draft)) await trackRow(index);
    }
  };

  const totals = rows.reduce((acc, row) => {
    const macros = macrosOf(row);
    return { kcal: acc.kcal + macros.kcal, protein: acc.protein + macros.protein, carbs: acc.carbs + macros.carbs, fat: acc.fat + macros.fat };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const after = budget.kcal == null ? null : budget.kcal - totals.kcal;
  const open = rows.filter((row) => !row.entry);
  const anyBusy = rows.some((row) => row.busy);

  const budgetLine = budget.kcal == null ? null
    : budget.kcal > 0 ? `Noch ${fmt(budget.kcal)} kcal${budget.protein != null && budget.protein > 0 ? ` · ${fmt(budget.protein)} g Protein` : ''} offen`
      : `Budget schon um ${fmt(-budget.kcal)} kcal überschritten`;

  return <ForgeSheet label="Was passt noch?" onClose={onClose}>
    <div className="space-y-4 p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}><Sparkles size={12} />{slotName}</p>
          <h2 className="mt-1 text-[20px] font-semibold leading-tight" style={{ color: TEXT }}>Was passt noch?</h2>
          {budgetLine && <p className="mt-1 text-[12px] tabular-nums" style={{ color: DIM }}>{budgetLine}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={17} /></button>
      </div>

      <div>
        <textarea
          value={wish}
          onChange={(event) => setWish(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!loading) void load(); } }}
          maxLength={300}
          rows={2}
          placeholder={PLACEHOLDER}
          className="input-forge min-h-[60px] resize-none text-[14px] leading-relaxed"
        />
        <button type="button" onClick={() => void load()} disabled={loading || anyBusy}
          className="btn-forge mt-2 flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-60">
          {loading ? <Loader2 size={16} className="animate-spin" /> : idea ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {loading ? 'Coach stellt zusammen…' : idea ? 'Neuer Vorschlag' : 'Vorschlag holen'}
        </button>
      </div>

      {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

      {loading && !rows.length && <div className="forge-skeleton h-[220px] rounded-2xl" aria-label="Vorschlag wird erstellt" />}

      {rows.length > 0 && <article className={`rounded-2xl p-3.5 ${loading ? 'opacity-60' : 'forge-msg-in'}`} style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug" style={{ color: TEXT }}>{idea?.title ?? 'Deine Mahlzeit'}</h3>
            {idea?.reason && <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: DIM }}>{idea.reason}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[17px] font-semibold leading-none tabular-nums" style={{ color: TEXT }}>{fmt(totals.kcal)}</p>
            <p className="mt-1 text-[10px]" style={{ color: DIM }}>kcal</p>
          </div>
        </div>

        <ul className="mt-3 space-y-2">
          {rows.map((row, index) => {
            const tracked = Boolean(row.entry);
            const amount = parseAmount(row.draft);
            return <li key={`${row.item.source}-${row.item.source_id}-${index}`} className="rounded-xl p-2.5" style={{ background: tracked ? 'rgba(232,197,138,0.08)' : 'rgba(255,247,235,0.03)', border: `1px solid ${tracked ? `${SAND}55` : BORDER}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium" style={{ color: TEXT }}>{row.item.name}{row.item.brand && <span className="font-normal" style={{ color: FAINT }}> · {row.item.brand}</span>}</p>
                <span className="shrink-0 text-[12px] tabular-nums" style={{ color: DIM }}>{fmt(macrosOf(row).kcal)} kcal · {fmt(macrosOf(row).protein)} g P</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-xl" style={{ background: 'rgba(255,247,235,0.045)', border: '1px solid rgba(255,247,235,0.09)' }}>
                  <button type="button" onClick={() => nudge(index, -1)} disabled={tracked || !amount || amount <= 5} aria-label={`${row.item.name} weniger`} className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-25" style={{ color: SAND }}><Minus size={15} /></button>
                  <label className="flex min-w-0 flex-1 items-center justify-center gap-1">
                    <input
                      value={tracked ? toAmountInput(row.entry!.amount) : row.draft}
                      disabled={tracked}
                      onChange={(event) => patch(index, { draft: event.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })}
                      onFocus={(event) => event.target.select()}
                      inputMode="decimal"
                      aria-label={`Menge ${row.item.name} in ${row.item.unit}`}
                      className="h-10 w-16 min-w-0 bg-transparent text-right text-[15px] font-semibold tabular-nums outline-none"
                      style={{ color: TEXT }}
                    />
                    <span className="text-[12px]" style={{ color: DIM }}>{row.item.unit}</span>
                  </label>
                  <button type="button" onClick={() => nudge(index, 1)} disabled={tracked} aria-label={`${row.item.name} mehr`} className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-25" style={{ color: SAND }}><Plus size={15} /></button>
                </div>
                <button type="button" onClick={() => void (tracked ? untrackRow(index) : trackRow(index))} disabled={row.busy || (!tracked && !amount)}
                  aria-label={tracked ? `${row.item.name} wieder entfernen` : `${row.item.name} tracken`} aria-pressed={tracked}
                  className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl disabled:opacity-50"
                  style={tracked ? { color: '#16130f', background: SAND } : { color: SAND, background: 'rgba(232,197,138,0.1)', border: `1px solid ${SAND}55` }}>
                  {row.busy ? <Loader2 size={16} className="animate-spin" /> : tracked ? <Check size={17} strokeWidth={2.6} /> : <Plus size={18} />}
                </button>
              </div>
            </li>;
          })}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-2">
          <MacroPills totals={totals} compact />
          {after != null && <span className="text-[10.5px] tabular-nums" style={{ color: after < 0 ? '#fca5a5' : FAINT }}>{after < 0 ? `${fmt(-after)} kcal drüber` : `danach ${fmt(after)} kcal offen`}</span>}
        </div>

        {open.length > 0 && <button type="button" onClick={() => void trackAll()} disabled={anyBusy || loading}
          className="tap mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold disabled:opacity-60"
          style={{ color: SAND, border: `1px solid ${SAND}55` }}>
          <Check size={15} />{open.length === rows.length ? 'Alles tracken' : `Restliche ${open.length} tracken`}
        </button>}
        {!open.length && <button type="button" onClick={onClose} className="btn-forge mt-3 h-11 w-full text-[13px]">Fertig</button>}
      </article>}

      {rows.length > 0 && <p className="text-center text-[10.5px]" style={{ color: FAINT }}>Mengen anpassen und mit + einzeln tracken · ✓ tippen nimmt es wieder raus</p>}

      {!rows.length && !loading && !error && <p className="text-[11.5px] leading-relaxed" style={{ color: FAINT }}>
        Der Coach kennt deine üblichen Kombinationen für {slotName} und was du die letzten Tage gegessen hast, und passt die Mengen an dein Restbudget an.
      </p>}
    </div>
  </ForgeSheet>;
}
