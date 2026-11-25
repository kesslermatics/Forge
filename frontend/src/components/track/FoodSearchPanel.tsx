import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, History, Leaf, ListPlus, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import { getRecentFoods, searchFoods, type FoodSummary, type RecentFoods, type TrackContext } from '../../api/api';
import { haptic } from '../navigation';
import { ATTRIBUTION, BORDER, DIM, FAINT, SAND, TEXT, cacheSearch, cachedSearch, fmt, fmtAmount, foodKey, scaled } from './trackUtils';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  /** Quick add with the item's default amount; resolves once the entry is stored. */
  onQuickAdd: (item: FoodSummary) => Promise<void>;
  onOpenFood: (item: FoodSummary) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Meal and day being tracked: suggestions, order and default amounts depend on them. */
  context: TrackContext;
  slotName: string;
  /** Swiping a row to the right puts the food on the meal's temporary list; ``from`` is where the row was. */
  onSwipeAdd?: (item: FoodSummary, from: DOMRect) => void;
  /** Show the one-line hint about swiping (while the list is still empty). */
  swipeHint?: boolean;
}

/** A burst of quick adds of one food: the button confirms each tap at once and counts them. */
interface AddState { status: 'done' | 'error'; count: number }
/** The confirmation stays this long after the last tap, then the button is a "+" again. */
const CONFIRM_MS = 900;

/** How far a row has to be pulled to the right before letting go adds it to the list. */
const SWIPE_ADD = 84;

/** One food: tap opens it, "+" tracks the default amount, a swipe to the right collects it in the list. */
function FoodRow({ item, state, onOpen, onQuickAdd, onSwipeAdd }: {
  item: FoodSummary;
  state: AddState | undefined;
  onOpen: () => void;
  onQuickAdd: () => void;
  onSwipeAdd?: (from: DOMRect) => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [landed, setLanded] = useState(0);
  // Keeps the "added" look on the revealed strip while the row springs back.
  const [holding, setHolding] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  // A swipe must not end in a tap on the row or the "+" underneath the finger.
  const suppressClick = useRef(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const done = state?.status === 'done';
  const armed = dx >= SWIPE_ADD || holding;
  const progress = Math.min(1, dx / SWIPE_ADD);
  // Values refer to the amount that the + button tracks, not to 100 g.
  const kcal = scaled(item.kcal, item.default_amount);
  const protein = scaled(item.protein, item.default_amount);

  const end = () => {
    const wasSwiping = swiping.current;
    start.current = null; swiping.current = false; setDragging(false);
    if (!wasSwiping) return;
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    if (dx >= SWIPE_ADD && onSwipeAdd && rowRef.current) {
      onSwipeAdd(rowRef.current.getBoundingClientRect());
      setLanded((count) => count + 1);
      setHolding(true);
      window.setTimeout(() => setHolding(false), 380);
    }
    setDx(0);
  };

  return <li ref={rowRef} className="relative overflow-hidden rounded-2xl">
    {onSwipeAdd && <div aria-hidden="true" className="absolute inset-0 flex items-center gap-2 rounded-2xl pl-4 text-[12.5px] font-semibold"
      style={{
        opacity: dx > 0 || holding ? 1 : 0,
        color: armed ? '#16130f' : SAND,
        background: armed ? `linear-gradient(90deg, ${SAND}, #d4aa70)` : `rgba(232,197,138,${0.06 + progress * 0.12})`,
        transition: dragging ? 'background 0.18s, color 0.18s' : 'background 0.18s, color 0.18s, opacity 0.3s',
      }}>
      <span className="flex" style={{ transform: `scale(${armed ? 1.18 : 0.7 + progress * 0.3}) rotate(${armed ? 0 : -12 + progress * 12}deg)`, transition: 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)' }}><ListPlus size={19} /></span>
      <span style={{ opacity: Math.min(1, Math.max(0, (dx - 24) / 40)) }}>{armed ? 'Loslassen' : 'In die Liste'}</span>
    </div>}
    <div
      className="relative flex items-center rounded-2xl"
      onPointerDown={(event) => { if (onSwipeAdd && event.button === 0) { start.current = { x: event.clientX, y: event.clientY }; swiping.current = false; } }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const deltaX = event.clientX - start.current.x;
        const deltaY = event.clientY - start.current.y;
        if (!swiping.current) {
          if (Math.abs(deltaY) > 12 || deltaX < -12) { start.current = null; return; }
          if (deltaX > 12 && deltaX > Math.abs(deltaY) * 1.4) {
            swiping.current = true; setDragging(true);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
          } else return;
        }
        const raw = Math.max(0, deltaX);
        // Past the threshold the row follows with resistance, so it feels like a detent.
        const next = raw <= SWIPE_ADD ? raw : SWIPE_ADD + (raw - SWIPE_ADD) * 0.3;
        if (dx < SWIPE_ADD && next >= SWIPE_ADD) haptic('tap');
        setDx(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={(event) => { if (suppressClick.current || dx !== 0) { event.stopPropagation(); event.preventDefault(); } }}
      style={{
        transform: `translateX(${dx}px)`,
        // Springs back with a small overshoot after letting go.
        transition: dragging ? 'none' : 'transform 0.38s cubic-bezier(0.34, 1.4, 0.64, 1)',
        // Opaque, so the strip behind only shows where the row has moved away.
        background: onSwipeAdd ? '#16130f' : undefined,
        touchAction: 'pan-y',
      }}
    >
      {(landed > 0 || done) && <span key={done ? `t${state.count}` : `l${landed}`} aria-hidden="true" className="track-row-flash pointer-events-none absolute inset-0 rounded-2xl" />}
      <button type="button" onClick={() => { haptic('tap'); onOpen(); }} className="tap flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-3 pr-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {item.tracked_count > 0 && !item.suggested && <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(232,197,138,0.14)', color: SAND }} role="img" aria-label="Schon getrackt"><History size={11} /></span>}
            <span className="truncate text-[16px] font-medium leading-snug" style={{ color: TEXT }}>{item.name}</span>
            {item.source === 'bls' && <Leaf size={13} className="shrink-0" style={{ color: '#83d6ad' }} aria-label="Grundnahrungsmittel" />}
          </span>
          {item.brand && <span className="block truncate text-[13px] leading-snug" style={{ color: DIM }}>{item.brand}</span>}
          <span className="block truncate text-[13px] leading-snug tabular-nums" style={{ color: FAINT }}>{fmtAmount(item.default_amount)} {item.unit}</span>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-[16px] font-semibold leading-snug" style={{ color: TEXT }}>{fmt(kcal)}<span className="ml-0.5 text-[11px] font-normal" style={{ color: DIM }}>kcal</span></span>
          {protein != null && <span className="block text-[12px] leading-snug" style={{ color: FAINT }}>{fmt(protein, 1)} g P</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onQuickAdd}
        aria-label={`${item.name} mit ${fmtAmount(item.default_amount)} ${item.unit} hinzufügen`}
        className="tap relative mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={done
          ? { color: '#16130f', background: SAND, transition: 'background-color 0.12s' }
          : { color: state?.status === 'error' ? '#fca5a5' : SAND, background: 'rgba(232,197,138,0.1)', border: `1px solid ${state?.status === 'error' ? 'rgba(248,113,113,0.4)' : `${SAND}40`}`, transition: 'background-color 0.12s' }}
      >
        {/* Keyed by the tap count, so every tap replays the pop. */}
        <span key={done ? state.count : 'idle'} className={done ? 'track-add-pop flex' : 'flex'}>{done ? <Check size={18} /> : <Plus size={20} />}</span>
        {done && state.count > 1 && <span key={`n${state.count}`} className="track-count-bump absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums"
          style={{ color: SAND, background: '#2a2318', border: `1px solid ${SAND}66` }} aria-hidden="true">{state.count}×</span>}
      </button>
      {/* Without a swipe (keyboard, screen reader) the list is still reachable. */}
      {onSwipeAdd && <button type="button" className="sr-only" onClick={() => { if (rowRef.current) onSwipeAdd(rowRef.current.getBoundingClientRect()); }}>{item.name} zur Liste hinzufügen</button>}
    </div>
  </li>;
}

const recentCache = new Map<string, RecentFoods>();
const scopeOf = (context: TrackContext) => `${context.slotId ?? 'unassigned'}|${context.date}`;

/** Inline live search: this meal's habits and recent foods while empty, hybrid catalog search while typing. */
export default function FoodSearchPanel({ query, onQueryChange, onQuickAdd, onOpenFood, inputRef, context, slotName, onSwipeAdd, swipeHint }: Props) {
  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;
  const scope = scopeOf(context);
  const [fetched, setFetched] = useState<{ q: string; items?: FoodSummary[]; error?: string } | null>(null);
  const [recent, setRecent] = useState<RecentFoods | null>(() => recentCache.get(scope) ?? null);
  const [added, setAdded] = useState<Record<string, AddState>>({});
  const timers = useRef<Record<string, number>>({});
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    getRecentFoods(context)
      .then((data) => { recentCache.set(scope, data); if (active) setRecent(data); })
      .catch(() => { if (active) setRecent((current) => current ?? { items: [], basis: null }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => () => Object.values(timers.current).forEach((timer) => window.clearTimeout(timer)), []);

  // Results are derived: cache hit → instant; otherwise the previous list stays (dimmed) until the new one arrives.
  const cached = searchable ? cachedSearch(scope, trimmed) : undefined;
  const current = fetched?.q === trimmed ? fetched : null;
  const results = cached ?? current?.items ?? (searchable ? fetched?.items ?? null : null);
  const error = current?.error ?? null;
  const searching = searchable && !cached && !current;

  useEffect(() => {
    if (!searchable || cachedSearch(scope, trimmed)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchFoods(trimmed, context, controller.signal)
        .then((data) => { cacheSearch(scope, trimmed, data.items); setFetched({ q: trimmed, items: data.items }); })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setFetched((previous) => ({ q: trimmed, items: previous?.items, error: caught instanceof Error ? caught.message : 'Suche fehlgeschlagen.' }));
        });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, searchable, scope]);

  // Confirmed on tap (the request runs in the background), so a second "+" never has to wait.
  const quickAdd = (item: FoodSummary) => {
    const key = foodKey(item);
    haptic('success');
    setAdded((state) => ({ ...state, [key]: { status: 'done', count: state[key]?.status === 'done' ? state[key].count + 1 : 1 } }));
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => setAdded((state) => { const next = { ...state }; delete next[key]; return next; }), CONFIRM_MS);
    onQuickAdd(item).catch(() => {
      haptic('warning');
      window.clearTimeout(timers.current[key]);
      setAdded((state) => ({ ...state, [key]: { status: 'error', count: 0 } }));
    });
  };

  // Lift the field to the top on focus, so the list stays visible above the keyboard.
  const liftIntoView = () => window.setTimeout(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260);

  const row = (item: FoodSummary) => {
    const key = foodKey(item);
    return <FoodRow key={key} item={item} state={added[key]} onOpen={() => onOpenFood(item)} onQuickAdd={() => quickAdd(item)}
      onSwipeAdd={onSwipeAdd ? (from) => onSwipeAdd(item, from) : undefined} />;
  };

  const heading = (icon: React.ReactNode, label: string) =>
    <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND }}>{icon}{label}</h3>;

  const empty = (title: string, text: string) => <div className="px-6 py-10 text-center">
    <p className="text-[14px] font-medium" style={{ color: TEXT }}>{title}</p>
    <p className="mt-1 text-[12px]" style={{ color: DIM }}>{text}</p>
  </div>;

  const skeleton = <div className="space-y-2">{[0, 1, 2, 3].map((item) => <div key={item} className="forge-skeleton h-14 rounded-2xl" />)}</div>;

  const idle = () => {
    if (recent == null) return skeleton;
    if (!recent.items.length) return empty('Noch nichts getrackt', 'Was du trackst, erscheint hier für den schnellen Zugriff.');
    const habits = recent.items.filter((item) => item.suggested);
    const others = recent.items.filter((item) => !item.suggested);
    return <div className="space-y-4">
      {habits.length > 0 && <div>
        {heading(recent.basis === 'time' ? <Clock3 size={12} /> : <Sparkles size={12} />, recent.basis === 'time' ? 'Typisch um diese Zeit' : `Typisch für ${slotName}`)}
        <ul className="-mx-2 space-y-0.5">{habits.map(row)}</ul>
      </div>}
      {others.length > 0 && <div>
        {heading(<History size={12} />, 'Zuletzt getrackt')}
        <ul className="-mx-2 space-y-0.5">{others.map(row)}</ul>
      </div>}
    </div>;
  };

  return <section ref={sectionRef} className="forge-anim forge-d3 scroll-mt-[68px]" aria-label="Lebensmittel suchen">
    <label className="flex h-[52px] items-center gap-2.5 rounded-2xl px-4" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${query ? `${SAND}66` : BORDER}`, transition: 'border-color 0.2s' }}>
      {searching ? <Loader2 size={18} className="shrink-0 animate-spin" style={{ color: SAND }} /> : <Search size={18} className="shrink-0" style={{ color: query ? SAND : DIM }} />}
      <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onFocus={liftIntoView}
        type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
        placeholder="Lebensmittel oder Marke suchen" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none" style={{ color: TEXT }} aria-label="Lebensmittel suchen" />
      {query && <button type="button" onClick={() => { onQueryChange(''); inputRef.current?.focus(); }} aria-label="Suche leeren" className="tap -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={15} /></button>}
    </label>

    {onSwipeAdd && swipeHint && <p className="flex items-center gap-1.5 px-1 pt-2.5 text-[11px]" style={{ color: FAINT }}><ListPlus size={13} style={{ color: SAND }} />Produkt nach rechts wischen, um eine Mahlzeit zusammenzustellen</p>}
    <div className="pt-3" aria-live="polite">
      {error && <p className="my-2 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      {!searchable ? idle()
        : results == null ? skeleton
          : results.length
            ? <ul className={`-mx-2 space-y-0.5 transition-opacity duration-200 ${searching ? 'opacity-55' : 'opacity-100'}`}>{results.map(row)}</ul>
            : empty('Nichts gefunden', 'Versuch einen anderen Begriff oder scanne den Barcode.')}
      {searchable && results && results.length > 0 && <p className="px-4 pt-4 text-center text-[10px] leading-relaxed" style={{ color: FAINT }}>{ATTRIBUTION}</p>}
    </div>
  </section>;
}
