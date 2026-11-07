import { useEffect, useRef, useState } from 'react';
import { Check, History, Leaf, Loader2, Plus, Search, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import { getRecentFoods, searchFoods, type FoodSummary } from '../../api/api';
import { ATTRIBUTION, BORDER, DIM, FAINT, PANEL, SAND, TEXT, fmt, fmtAmount, foodKey } from './trackUtils';

interface Props {
  slotName: string;
  /** Quick add with the item's default amount; resolves once the entry is stored. */
  onQuickAdd: (item: FoodSummary) => Promise<void>;
  onOpenFood: (item: FoodSummary) => void;
  onClose: () => void;
}

type AddState = 'busy' | 'done' | 'error';
const keyOf = foodKey;

export default function FoodSearchSheet({ slotName, onQuickAdd, onOpenFood, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[] | null>(null);
  const [recent, setRecent] = useState<FoodSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, AddState>>({});
  const [addedCount, setAddedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getRecentFoods().then((data) => setRecent(data.items)).catch(() => setRecent([]));
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => { window.clearTimeout(timer); requestRef.current?.abort(); };
  }, []);

  const changeQuery = (value: string) => {
    setQuery(value);
    const searchable = value.trim().length >= 2;
    setSearching(searchable);
    if (!searchable) { setResults(null); setError(null); }
  };

  useEffect(() => {
    const trimmed = query.trim();
    requestRef.current?.abort();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => {
      searchFoods(trimmed, controller.signal)
        .then((data) => { if (!controller.signal.aborted) { setResults(data.items); setError(null); } })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setError(caught instanceof Error ? caught.message : 'Suche fehlgeschlagen.');
        })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const quickAdd = async (item: FoodSummary) => {
    const key = keyOf(item);
    if (added[key] === 'busy') return;
    setAdded((current) => ({ ...current, [key]: 'busy' }));
    try {
      await onQuickAdd(item);
      navigator.vibrate?.(12);
      setAdded((current) => ({ ...current, [key]: 'done' }));
      setAddedCount((count) => count + 1);
    } catch {
      setAdded((current) => ({ ...current, [key]: 'error' }));
    }
  };

  const showingRecent = query.trim().length < 2;
  const list = showingRecent ? recent : results;

  const row = (item: FoodSummary) => {
    const key = keyOf(item);
    const state = added[key];
    return <li key={key} className={`flex items-center gap-1 rounded-2xl ${state === 'done' ? 'track-row-flash' : ''}`}>
      <button type="button" onClick={() => onOpenFood(item)} className="tap flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
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

  return <ForgeSheet label={`Suche für ${slotName}`} onClose={onClose} fullscreen>
    <header className="space-y-3 border-b px-4 pb-3 pt-3" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{slotName}</p>
          <h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>Lebensmittel suchen</h2>
        </div>
        <div className="flex items-center gap-2">
          {addedCount > 0 && <span key={addedCount} className="track-count-bump flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-semibold" style={{ color: '#16130f', background: SAND }}><Check size={13} />{addedCount}</span>}
          <button type="button" onClick={onClose} aria-label="Suche schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
        </div>
      </div>
      <label className="flex h-12 items-center gap-2 rounded-2xl px-3.5" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${query ? `${SAND}55` : BORDER}`, transition: 'border-color 0.2s' }}>
        {searching ? <Loader2 size={17} className="animate-spin" style={{ color: SAND }} /> : <Search size={17} style={{ color: DIM }} />}
        <input ref={inputRef} value={query} onChange={(event) => changeQuery(event.target.value)} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          placeholder="z. B. Skyr, Haferflocken, Banane" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: TEXT }} aria-label="Lebensmittel suchen" />
        {query && <button type="button" onClick={() => { changeQuery(''); inputRef.current?.focus(); }} aria-label="Suche leeren" className="tap p-1" style={{ color: DIM }}><X size={16} /></button>}
      </label>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-2" style={{ background: PANEL }}>
      {showingRecent && <h3 className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}><History size={12} />Zuletzt getrackt</h3>}
      {error && <p className="mx-2 my-2 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      {list === null
        ? <div className="space-y-2 px-2 pt-1">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="forge-skeleton h-14 rounded-2xl" />)}</div>
        : list.length
          ? <ul className={`space-y-0.5 transition-opacity ${searching ? 'opacity-60' : 'opacity-100'}`} aria-live="polite">{list.map(row)}</ul>
          : <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-medium" style={{ color: TEXT }}>{showingRecent ? 'Noch nichts getrackt' : 'Nichts gefunden'}</p>
            <p className="mt-1 text-[12px]" style={{ color: DIM }}>{showingRecent ? 'Suche ein Lebensmittel. Was du trackst, erscheint hier für den schnellen Zugriff.' : 'Versuch es mit einem anderen Begriff oder scanne den Barcode.'}</p>
          </div>}
      {!showingRecent && list && list.length > 0 && <p className="px-4 pt-4 text-center text-[10px] leading-relaxed" style={{ color: FAINT }}>{ATTRIBUTION}</p>}
    </div>
  </ForgeSheet>;
}
