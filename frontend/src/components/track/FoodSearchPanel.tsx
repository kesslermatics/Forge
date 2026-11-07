import { useEffect, useRef, useState } from 'react';
import { Check, History, Leaf, Loader2, Plus, Search, X } from 'lucide-react';
import { getRecentFoods, searchFoods, type FoodSummary } from '../../api/api';
import { haptic } from '../navigation';
import { ATTRIBUTION, BORDER, DIM, FAINT, SAND, TEXT, cacheSearch, cachedSearch, fmt, fmtAmount, foodKey } from './trackUtils';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  /** Quick add with the item's default amount; resolves once the entry is stored. */
  onQuickAdd: (item: FoodSummary) => Promise<void>;
  onOpenFood: (item: FoodSummary) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

type AddState = 'busy' | 'done' | 'error';
let recentCache: FoodSummary[] | null = null;

/** Inline live search: recent foods while empty, hybrid catalog search while typing. */
export default function FoodSearchPanel({ query, onQueryChange, onQuickAdd, onOpenFood, inputRef }: Props) {
  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;
  const [fetched, setFetched] = useState<{ q: string; items?: FoodSummary[]; error?: string } | null>(null);
  const [recent, setRecent] = useState<FoodSummary[] | null>(recentCache);
  const [added, setAdded] = useState<Record<string, AddState>>({});
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    getRecentFoods().then((data) => { recentCache = data.items; setRecent(data.items); }).catch(() => setRecent((current) => current ?? []));
  }, []);

  // Results are derived: cache hit → instant; otherwise the previous list stays (dimmed) until the new one arrives.
  const cached = searchable ? cachedSearch(trimmed) : undefined;
  const current = fetched?.q === trimmed ? fetched : null;
  const results = cached ?? current?.items ?? (searchable ? fetched?.items ?? null : null);
  const error = current?.error ?? null;
  const searching = searchable && !cached && !current;

  useEffect(() => {
    if (!searchable || cachedSearch(trimmed)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchFoods(trimmed, controller.signal)
        .then((data) => { cacheSearch(trimmed, data.items); setFetched({ q: trimmed, items: data.items }); })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setFetched((previous) => ({ q: trimmed, items: previous?.items, error: caught instanceof Error ? caught.message : 'Suche fehlgeschlagen.' }));
        });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmed, searchable]);

  const quickAdd = async (item: FoodSummary) => {
    const key = foodKey(item);
    if (added[key] === 'busy') return;
    haptic('tap');
    setAdded((current) => ({ ...current, [key]: 'busy' }));
    try {
      await onQuickAdd(item);
      haptic('success');
      setAdded((current) => ({ ...current, [key]: 'done' }));
      // Back to "+" after a moment, so the same food can be added again.
      window.setTimeout(() => setAdded((current) => { const next = { ...current }; delete next[key]; return next; }), 1800);
    } catch {
      haptic('warning');
      setAdded((current) => ({ ...current, [key]: 'error' }));
    }
  };

  // Lift the field to the top on focus, so the list stays visible above the keyboard.
  const liftIntoView = () => window.setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260);

  const list = searchable ? results : recent;

  const row = (item: FoodSummary) => {
    const key = foodKey(item);
    const state = added[key];
    return <li key={key} className={`flex items-center gap-1 rounded-2xl ${state === 'done' ? 'track-row-flash' : ''}`}>
      <button type="button" onClick={() => { haptic('tap'); onOpenFood(item); }} className="tap flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium" style={{ color: TEXT }}>{item.name}</span>
            {item.source === 'bls' && <Leaf size={12} className="shrink-0" style={{ color: '#83d6ad' }} aria-label="Grundnahrungsmittel" />}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>
            {[item.brand, `${fmt(item.kcal)} kcal`, item.protein != null ? `${fmt(item.protein)} g Protein` : null].filter(Boolean).join(' · ')}
            <span style={{ color: FAINT }}> / 100 {item.unit}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => void quickAdd(item)}
        aria-label={`${item.name} mit ${fmtAmount(item.default_amount)} ${item.unit} hinzufügen`}
        className={`tap mr-1 flex h-11 shrink-0 items-center gap-1 rounded-full pl-2.5 pr-3 text-[11px] font-semibold tabular-nums ${state === 'done' ? 'track-add-pop' : ''}`}
        style={state === 'done'
          ? { color: '#16130f', background: SAND }
          : { color: state === 'error' ? '#fca5a5' : SAND, background: 'rgba(232,197,138,0.1)', border: `1px solid ${state === 'error' ? 'rgba(248,113,113,0.4)' : `${SAND}40`}` }}
      >
        {state === 'busy' ? <Loader2 size={15} className="animate-spin" /> : state === 'done' ? <Check size={15} /> : <Plus size={15} />}
        {fmtAmount(item.default_amount)}{item.unit}
      </button>
    </li>;
  };

  return <section ref={sectionRef} className="forge-anim forge-d3 scroll-mt-[68px]" aria-label="Lebensmittel suchen">
    <label className="flex h-[52px] items-center gap-2.5 rounded-2xl px-4" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${query ? `${SAND}66` : BORDER}`, transition: 'border-color 0.2s' }}>
      {searching ? <Loader2 size={18} className="shrink-0 animate-spin" style={{ color: SAND }} /> : <Search size={18} className="shrink-0" style={{ color: query ? SAND : DIM }} />}
      <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onFocus={liftIntoView}
        type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
        placeholder="Lebensmittel oder Marke suchen" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" style={{ color: TEXT }} aria-label="Lebensmittel suchen" />
      {query && <button type="button" onClick={() => { onQueryChange(''); inputRef.current?.focus(); }} aria-label="Suche leeren" className="tap -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={15} /></button>}
    </label>

    <div className="pt-3">
      {!searchable && <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}><History size={12} />Zuletzt getrackt</h3>}
      {error && <p className="my-2 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      {list == null
        ? <div className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="forge-skeleton h-14 rounded-2xl" />)}</div>
        : list.length
          ? <ul className={`-mx-2 space-y-0.5 transition-opacity duration-200 ${searching ? 'opacity-55' : 'opacity-100'}`} aria-live="polite">{list.map(row)}</ul>
          : <div className="px-6 py-10 text-center">
            <p className="text-[14px] font-medium" style={{ color: TEXT }}>{searchable ? 'Nichts gefunden' : 'Noch nichts getrackt'}</p>
            <p className="mt-1 text-[12px]" style={{ color: DIM }}>{searchable ? 'Versuch einen anderen Begriff oder scanne den Barcode.' : 'Was du trackst, erscheint hier für den schnellen Zugriff.'}</p>
          </div>}
      {searchable && list && list.length > 0 && <p className="px-4 pt-4 text-center text-[10px] leading-relaxed" style={{ color: FAINT }}>{ATTRIBUTION}</p>}
    </div>
  </section>;
}
