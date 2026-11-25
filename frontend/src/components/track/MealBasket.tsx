import { useState } from 'react';
import { Check, ChevronUp, ListPlus, Loader2, Minus, Plus, Trash2, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import { haptic } from '../navigation';
import { MacroPills } from './shared';
import { basketTotals, type BasketItem } from './basketStore';
import { BORDER, DIM, FAINT, SAND, TEXT, fmt, parseAmount, scaled, toAmountInput } from './trackUtils';

/** Bottom bar while the list has items: totals at a glance, tap to adjust, one tap to track all. */
export function MealBasketBar({ items, bump, busy, onOpen, onTrack }: {
  items: BasketItem[];
  /** Changes on every landed item; replays the bump. */
  bump: number;
  busy: boolean;
  onOpen: () => void;
  onTrack: () => void;
}) {
  const totals = basketTotals(items);
  return <div className="fixed inset-x-0 z-30" style={{ bottom: 'var(--forge-nav-h, 64px)', transition: 'bottom 0.2s' }}>
    <div className="mx-auto max-w-2xl px-3 pb-3 pt-3" style={{ background: 'linear-gradient(180deg, rgba(22,19,15,0) 0%, rgba(22,19,15,0.96) 32%)' }}>
      <div className="track-basket-in flex items-center gap-1.5 rounded-[20px] p-1.5" style={{ background: '#211c14', border: `1px solid ${SAND}40`, boxShadow: '0 18px 40px -18px rgba(0,0,0,0.95)' }}>
        <button type="button" onClick={() => { haptic('tap'); onOpen(); }} aria-label={`Liste mit ${items.length} Produkten anpassen`} className="tap flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-1 pl-1 pr-2 text-left">
          <span data-basket-target key={bump} className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${bump ? 'track-basket-bump' : ''}`} style={{ color: SAND, background: 'rgba(232,197,138,0.12)' }}>
            <ListPlus size={19} />
            <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 text-[10.5px] font-bold tabular-nums" style={{ color: '#16130f', background: SAND }}>{items.length}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(totals.kcal)} kcal · {fmt(totals.protein)} g P</span>
            <span className="block truncate text-[11px]" style={{ color: DIM }}>{items.length === 1 ? '1 Produkt' : `${items.length} Produkte`} · Mengen anpassen</span>
          </span>
          <ChevronUp size={16} className="shrink-0" style={{ color: FAINT }} />
        </button>
        <button type="button" onClick={onTrack} disabled={busy} className="tap flex h-11 shrink-0 items-center gap-1.5 rounded-2xl px-4 text-[13.5px] font-semibold disabled:opacity-60" style={{ color: '#16130f', background: SAND }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={2.6} />}Tracken
        </button>
      </div>
    </div>
  </div>;
}

const stepFor = (amount: number) => amount >= 200 ? 25 : amount >= 50 ? 10 : 5;

/** The list itself: a stepper per product, live totals and what is left of the day afterwards. */
export function MealBasketSheet({ items, slotName, remainingKcal, busy, error, onAmount, onRemove, onClear, onTrack, onClose }: {
  items: BasketItem[];
  slotName: string;
  /** Left of today's kcal target before this list (null without a target). */
  remainingKcal: number | null;
  busy: boolean;
  error: string | null;
  onAmount: (key: string, amount: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onTrack: () => void;
  onClose: () => void;
}) {
  // Text while typing ("12,"); the list keeps the last valid number.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const totals = basketTotals(items);
  const after = remainingKcal == null ? null : remainingKcal - totals.kcal;
  const dropDraft = (key: string) => setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });

  const nudge = (item: BasketItem, direction: 1 | -1) => {
    const step = stepFor(direction > 0 ? item.amount : item.amount - 1);
    const next = Math.round((item.amount + direction * step) / step) * step;
    if (next < 1) return;
    haptic('tap');
    dropDraft(item.key);
    onAmount(item.key, Math.min(10000, next));
  };

  return <ForgeSheet label="Liste anpassen" onClose={onClose}>
    <div className="space-y-4 p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}>{slotName}</p>
          <h2 className="mt-1 text-[20px] font-semibold leading-tight" style={{ color: TEXT }}>Zusammenstellen</h2>
          <p className="mt-1 text-[12px]" style={{ color: DIM }}>Mengen anpassen, dann alles auf einmal tracken.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={17} /></button>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const kcal = scaled(item.per_100.kcal, item.amount);
          const protein = scaled(item.per_100.protein, item.amount);
          return <li key={item.key} className="forge-row-enter rounded-2xl p-3" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}` }}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug" style={{ color: TEXT }}>
                <span className="block truncate">{item.name}</span>
                {item.brand && <span className="block truncate text-[12px] font-normal" style={{ color: FAINT }}>{item.brand}</span>}
              </p>
              <button type="button" onClick={() => { haptic('tap'); onRemove(item.key); }} aria-label={`${item.name} aus der Liste nehmen`} className="tap -mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: FAINT }}><X size={16} /></button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center rounded-xl" style={{ background: 'rgba(255,247,235,0.045)', border: '1px solid rgba(255,247,235,0.09)' }}>
                <button type="button" onClick={() => nudge(item, -1)} disabled={item.amount <= 5} aria-label={`${item.name} weniger`} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-25" style={{ color: SAND }}><Minus size={16} /></button>
                <label className="flex min-w-0 flex-1 items-center justify-center gap-1">
                  <input
                    value={drafts[item.key] ?? toAmountInput(item.amount)}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^\d.,]/g, '').slice(0, 7);
                      setDrafts((current) => ({ ...current, [item.key]: raw }));
                      const parsed = parseAmount(raw);
                      if (parsed) onAmount(item.key, parsed);
                    }}
                    onFocus={(event) => event.target.select()}
                    onBlur={() => dropDraft(item.key)}
                    inputMode="decimal"
                    enterKeyHint="done"
                    aria-label={`Menge ${item.name} in ${item.unit}`}
                    className="track-amount-input h-11 w-[70px] min-w-0 bg-transparent text-right text-[17px] font-semibold tabular-nums outline-none"
                    style={{ color: TEXT }}
                  />
                  <span className="text-[13px]" style={{ color: DIM }}>{item.unit}</span>
                </label>
                <button type="button" onClick={() => nudge(item, 1)} aria-label={`${item.name} mehr`} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND }}><Plus size={16} /></button>
              </div>
              <span className="w-[74px] shrink-0 text-right tabular-nums">
                <span key={Math.round(kcal ?? 0)} className="track-number block text-[16px] font-semibold leading-snug" style={{ color: TEXT }}>{fmt(kcal)}<span className="ml-0.5 text-[10.5px] font-normal" style={{ color: DIM }}>kcal</span></span>
                <span className="block text-[11.5px] leading-snug" style={{ color: FAINT }}>{fmt(protein, 1)} g P</span>
              </span>
            </div>
          </li>;
        })}
      </ul>

      <section className="rounded-2xl p-3.5" style={{ background: 'rgba(232,197,138,0.07)', border: `1px solid ${SAND}33` }} aria-label="Summe der Liste">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}>Summe</span>
          <span key={Math.round(totals.kcal)} className="track-number text-[22px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(totals.kcal)}<span className="ml-1 text-[12px] font-normal" style={{ color: DIM }}>kcal</span></span>
        </div>
        <div className="mt-2.5"><MacroPills totals={totals} /></div>
        {after != null && <p className="mt-2.5 text-[12px] tabular-nums" style={{ color: after < 0 ? '#fca5a5' : DIM }}>
          {after < 0 ? `Damit ${fmt(-after)} kcal über deinem Tagesziel` : `Danach noch ${fmt(after)} kcal für heute offen`}
        </p>}
      </section>

      {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

      <div className="space-y-2">
        <button type="button" onClick={onTrack} disabled={busy || !items.length} className="btn-forge flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-60">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={2.6} />}
          {busy ? 'Wird getrackt…' : `${items.length === 1 ? '1 Produkt' : `${items.length} Produkte`} tracken`}
        </button>
        <button type="button" onClick={() => { haptic('tap'); onClear(); }} disabled={busy} className="tap flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-medium disabled:opacity-50" style={{ color: DIM }}>
          <Trash2 size={14} />Liste leeren
        </button>
      </div>
    </div>
  </ForgeSheet>;
}
