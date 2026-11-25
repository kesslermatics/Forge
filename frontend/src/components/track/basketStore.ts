import { useCallback, useEffect, useState } from 'react';
import type { FoodSummary, FoodUnit } from '../../api/api';
import { SAND, foodKey, scaled } from './trackUtils';

/** A food collected by swiping, not tracked yet. Nutrients are per 100 g/ml. */
export interface BasketItem {
  key: string;
  source: FoodSummary['source'];
  source_id: string;
  name: string;
  brand: string | null;
  unit: FoodUnit;
  per_100: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };
  amount: number;
}

type Macros = { kcal: number; protein: number; carbs: number; fat: number };

const STORAGE_PREFIX = 'forge-track-basket:';

export function basketTotals(items: BasketItem[]): Macros {
  return items.reduce((acc, item) => ({
    kcal: acc.kcal + (scaled(item.per_100.kcal, item.amount) ?? 0),
    protein: acc.protein + (scaled(item.per_100.protein, item.amount) ?? 0),
    carbs: acc.carbs + (scaled(item.per_100.carbs, item.amount) ?? 0),
    fat: acc.fat + (scaled(item.per_100.fat, item.amount) ?? 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

function read(scope: string): BasketItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as BasketItem[] : [];
  } catch {
    return [];
  }
}

/**
 * The temporary list of one meal on one day. Kept in sessionStorage, so it survives opening a
 * product page and coming back (and a reload), but not the end of the browser session.
 */
export function useMealBasket(scope: string) {
  const [state, setState] = useState(() => ({ scope, items: read(scope) }));
  // Another meal or day: switch to its own list while rendering.
  const items = state.scope === scope ? state.items : read(scope);
  if (state.scope !== scope) setState({ scope, items });

  useEffect(() => {
    try {
      if (items.length) sessionStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(items));
      else sessionStorage.removeItem(STORAGE_PREFIX + scope);
    } catch { /* storage full or blocked: the list just stays in memory */ }
  }, [scope, items]);

  const update = useCallback((change: (current: BasketItem[]) => BasketItem[]) =>
    setState((current) => ({ scope: current.scope, items: change(current.items) })), []);

  /** A food swiped in twice gets a second portion instead of a second row. */
  const add = useCallback((food: FoodSummary) => update((current) => {
    const key = foodKey(food);
    const existing = current.find((item) => item.key === key);
    if (existing) return current.map((item) => item.key === key ? { ...item, amount: Math.min(10000, item.amount + food.default_amount) } : item);
    return [...current, {
      key, source: food.source, source_id: food.source_id, name: food.name, brand: food.brand, unit: food.unit,
      per_100: { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat }, amount: food.default_amount,
    }];
  }), [update]);
  const setAmount = useCallback((key: string, amount: number) =>
    update((current) => current.map((item) => item.key === key ? { ...item, amount } : item)), [update]);
  const remove = useCallback((key: string) => update((current) => current.filter((item) => item.key !== key)), [update]);
  const clear = useCallback(() => update(() => []), [update]);

  return { items, add, setAmount, remove, clear };
}

/**
 * A chip with the food's name flies from the swiped row into the list button. Resolves when it
 * has landed (at once without a target or with reduced motion), so the button can bump then.
 */
export function flyToBasket(from: DOMRect, label: string): Promise<void> {
  const target = document.querySelector('[data-basket-target]');
  if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof document.body.animate !== 'function') return Promise.resolve();
  const to = target.getBoundingClientRect();
  const chip = document.createElement('div');
  chip.textContent = label;
  Object.assign(chip.style, {
    position: 'fixed', left: `${from.left + 12}px`, top: `${from.top + from.height / 2 - 17}px`, height: '34px', maxWidth: '220px',
    padding: '0 14px', display: 'flex', alignItems: 'center', borderRadius: '999px', background: SAND, color: '#16130f',
    fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    zIndex: '70', pointerEvents: 'none', boxShadow: '0 14px 30px -10px rgba(0,0,0,0.85)', willChange: 'transform, opacity',
  });
  document.body.appendChild(chip);
  const start = chip.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (start.left + start.width / 2);
  const dy = to.top + to.height / 2 - (start.top + start.height / 2);
  // Lifts a little first, then drops into the button in an arc while shrinking.
  const animation = chip.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.25}px, ${Math.min(dy * 0.15, 0) - 28}px) scale(1.04)`, opacity: 1, offset: 0.28 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.18)`, opacity: 0.35 },
  ], { duration: 560, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' });
  return animation.finished.then(() => undefined, () => undefined).finally(() => chip.remove());
}
