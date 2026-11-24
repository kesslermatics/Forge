import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, MessageSquareText, ScanBarcode, Search, Sparkles, Undo2, X } from 'lucide-react';
import {
  createTrackEntry, deleteTrackEntry, getMealSlots, getTrackDay, getTrackEntries, updateTrackEntry,
  type FoodDetail, type FoodSummary, type MealSlot, type NutritionGoals, type TrackEntry, type TrackMacros,
} from '../../api/api';
import { haptic, useGoBack } from '../navigation';
import FoodSearchPanel from './FoodSearchPanel';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import SmartTrackSheet from './SmartTrackSheet';
import MealIdeasSheet from './MealIdeasSheet';
import EntryEditSheet from './EntryEditSheet';
import { MealBudgetStrip } from './Budget';
import { SlotIcon } from './shared';
import {
  BORDER, DIM, FAINT, SAND, TEXT, berlinToday, clearTrackFlash, fmt, fmtAmount, isValidIsoDate, peekTrackFlash, photoToDataUrl, shortDate,
} from './trackUtils';

const EMPTY: TrackMacros = { kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, saturated: 0, salt: 0 };

function sum(entries: TrackEntry[]): TrackMacros {
  return entries.reduce((acc, entry) => ({
    kcal: acc.kcal + entry.kcal, protein: acc.protein + entry.protein, carbs: acc.carbs + entry.carbs, fat: acc.fat + entry.fat,
    sugar: acc.sugar + (entry.sugar ?? 0), fiber: acc.fiber + (entry.fiber ?? 0), saturated: acc.saturated + (entry.saturated ?? 0), salt: acc.salt + (entry.salt ?? 0),
  }), { ...EMPTY });
}

/** The rest of the day (everything but this meal) and the targets; this meal's own entries are added live. */
interface DayBase { others: TrackMacros; goals: NutritionGoals | null }

function minus(a: TrackMacros, b: TrackMacros): TrackMacros {
  return { kcal: a.kcal - b.kcal, protein: a.protein - b.protein, carbs: a.carbs - b.carbs, fat: a.fat - b.fat,
    sugar: a.sugar - b.sugar, fiber: a.fiber - b.fiber, saturated: a.saturated - b.saturated, salt: a.salt - b.salt };
}

async function fetchSlot(date: string, slotId: string | null): Promise<{ slot: MealSlot; entries: TrackEntry[]; day: DayBase | null } | { error: string }> {
  try {
    // The budget is a bonus: without the day summary the page still works.
    const [slotData, entryData, dayData] = await Promise.all([getMealSlots(), getTrackEntries(date, slotId), getTrackDay(date).catch(() => null)]);
    const slot = slotId ? slotData.items.find((item) => item.id === slotId) ?? null : { id: 'unassigned', name: 'Ohne Mahlzeit', position: -1 };
    if (!slot) return { error: 'Diese Mahlzeit gibt es nicht mehr.' };
    const mealAtLoad = dayData ? (slotId ? dayData.slots.find((item) => item.id === slotId)?.totals : dayData.unassigned.totals) : undefined;
    const day = dayData ? { others: mealAtLoad ? minus(dayData.totals, mealAtLoad) : dayData.totals, goals: dayData.goals } : null;
    return { slot, entries: entryData.items, day };
  } catch (caught: unknown) {
    return { error: caught instanceof Error ? caught.message : 'Einträge konnten nicht geladen werden.' };
  }
}

type Undo = { kind: 'added' | 'deleted'; entry: TrackEntry; label: string };
const addedLabel = (entry: TrackEntry) => `${entry.name} · ${fmtAmount(entry.amount)} ${entry.unit} hinzugefügt`;

export default function TrackSlotPage() {
  const navigate = useNavigate();
  const { slotId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const realSlotId = slotId === 'unassigned' ? null : slotId;
  const dateQuery = date === berlinToday() ? '' : `?date=${date}`;
  const goBack = useGoBack(`/nutrition/track${dateQuery}`);
  // The query lives in the URL, so coming back from a product restores the result list.
  const query = params.get('q') ?? '';

  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [entries, setEntries] = useState<TrackEntry[] | null>(null);
  const [dayBase, setDayBase] = useState<DayBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<TrackEntry | null>(null);
  // An entry added on the product page arrives via the flash store for instant feedback.
  const [addedOnProduct] = useState(peekTrackFlash);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(addedOnProduct ? [addedOnProduct.id] : []));
  const [undo, setUndo] = useState<Undo | null>(() => addedOnProduct ? { kind: 'added', entry: addedOnProduct, label: addedLabel(addedOnProduct) } : null);
  const undoTimer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);
  // The tracked list sits above the search panel: when it grows or shrinks, scroll by the same amount
  // so the food list (and its + buttons) stays put under the finger for repeated adds.
  const panelRef = useRef<HTMLDivElement>(null);
  const panelTop = useRef<number | null>(null);
  const holdPanel = () => { panelTop.current = panelRef.current?.getBoundingClientRect().top ?? null; };

  const applyLoaded = useCallback((result: Awaited<ReturnType<typeof fetchSlot>>) => {
    if ('error' in result) { setError(result.error); setEntries((current) => current ?? []); return; }
    setError(null); setSlot(result.slot); setEntries(result.entries); setDayBase(result.day);
  }, []);

  const load = useCallback(() => fetchSlot(date, realSlotId).then(applyLoaded), [date, realSlotId, applyLoaded]);

  useEffect(() => {
    let active = true;
    fetchSlot(date, realSlotId).then((result) => { if (active) applyLoaded(result); });
    return () => { active = false; };
  }, [date, realSlotId, applyLoaded]);

  useLayoutEffect(() => {
    const before = panelTop.current;
    panelTop.current = null;
    const after = panelRef.current?.getBoundingClientRect().top;
    if (before == null || after == null || Math.abs(after - before) < 1) return;
    window.scrollBy({ top: after - before, behavior: 'instant' });
  }, [entries]);

  const markFresh = useCallback((id: string) => {
    setFresh((current) => new Set(current).add(id));
    window.setTimeout(() => setFresh((current) => { const next = new Set(current); next.delete(id); return next; }), 800);
  }, []);

  const showUndo = useCallback((kind: Undo['kind'], entry: TrackEntry, label: string) => {
    window.clearTimeout(undoTimer.current);
    setUndo({ kind, entry, label });
    undoTimer.current = window.setTimeout(() => setUndo(null), 4500);
  }, []);

  useEffect(() => {
    if (!addedOnProduct) return;
    clearTrackFlash();
    haptic('success');
    undoTimer.current = window.setTimeout(() => setUndo(null), 4500);
    const freshTimer = window.setTimeout(() => setFresh(new Set()), 800);
    return () => window.clearTimeout(freshTimer);
  }, [addedOnProduct]);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const setQuery = (value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set('q', value); else next.delete('q');
    return next;
  }, { replace: true });

  const addEntry = async (source: TrackEntry['source'], sourceId: string, amount: number) => {
    const entry = await createTrackEntry({ date, slot_id: realSlotId, source, source_id: sourceId, amount });
    holdPanel();
    setEntries((current) => [...(current ?? []), entry]);
    markFresh(entry.id);
    return entry;
  };

  const quickAdd = async (item: FoodSummary) => {
    const entry = await addEntry(item.source, item.source_id, item.default_amount);
    showUndo('added', entry, addedLabel(entry));
  };

  const removeEntry = async (entry: TrackEntry, offerUndo: boolean) => {
    setEditing(null);
    holdPanel();
    setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
    try {
      await deleteTrackEntry(entry.id);
      haptic('tap');
      if (offerUndo) showUndo('deleted', entry, `${entry.name} entfernt`);
      else setUndo(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Löschen fehlgeschlagen.');
      void load();
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    const { kind, entry } = undo;
    setUndo(null);
    haptic('tap');
    if (kind === 'added') { await removeEntry(entry, false); return; }
    try { await addEntry(entry.source, entry.source_id, entry.amount); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Wiederherstellen fehlgeschlagen.'); }
  };

  /** `replace` when leaving from an overlay, so its history entry is overwritten by the product. */
  const openFood = (source: string, sourceId: string, options: { state?: unknown; replace?: boolean } = {}) =>
    navigate(`/nutrition/food/${source}/${encodeURIComponent(sourceId)}?slot=${slotId}${date === berlinToday() ? '' : `&date=${date}`}`, options);

  const onTile = (key: string) => {
    haptic('tap');
    if (key === 'search') searchRef.current?.focus();
    else if (key === 'barcode') setScanOpen(true);
    else if (key === 'camera') cameraRef.current?.click();
    else setTextOpen(true);
  };

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { setPhoto(await photoToDataUrl(file)); }
    catch { setError('Das Foto konnte nicht gelesen werden.'); }
  };

  const totals = sum(entries ?? []);
  // The whole day, live: the other meals as loaded plus this meal as it changes.
  const dayTotals = dayBase ? { kcal: dayBase.others.kcal + totals.kcal, protein: dayBase.others.protein + totals.protein,
    carbs: dayBase.others.carbs + totals.carbs, fat: dayBase.others.fat + totals.fat } : null;
  const goals = dayBase?.goals ?? null;
  const remainingKcal = goals && dayTotals ? goals.kcal - dayTotals.kcal : null;
  const remainingProtein = goals && dayTotals ? goals.protein - dayTotals.protein : null;
  const tiles = [
    { key: 'search', icon: <Search size={19} />, label: 'Suche', active: true, disabled: false },
    { key: 'barcode', icon: <ScanBarcode size={19} />, label: 'Barcode', active: false, disabled: false },
    { key: 'camera', icon: <Camera size={19} />, label: 'Foto', active: false, disabled: false },
    { key: 'voice', icon: <MessageSquareText size={19} />, label: 'Text', active: false, disabled: false },
  ];

  // Native scroll anchoring is off here; the layout effect above does it consistently (incl. iOS Safari).
  return <div className="space-y-4 pb-10" style={{ overflowAnchor: 'none' }}>
    <header className="forge-anim flex items-center gap-3">
      <button type="button" onClick={goBack} aria-label="Zurück zur Tagesübersicht" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{date === berlinToday() ? 'Heute' : shortDate(date)}</p>
        <h1 className="flex items-center gap-2 truncate text-[23px] font-semibold leading-tight tracking-tight" style={{ color: TEXT }}>
          <span className="shrink-0" style={{ color: SAND }}><SlotIcon name={slot?.name ?? ''} size={19} /></span><span className="truncate">{slot?.name ?? ' '}</span>
        </h1>
      </div>
      <div className="shrink-0 text-right">
        <p key={totals.kcal} className="track-number text-[22px] font-semibold leading-none tabular-nums" style={{ color: TEXT }}>{fmt(totals.kcal)}</p>
        <p className="mt-1 text-[10px]" style={{ color: DIM }}>kcal</p>
      </div>
    </header>

    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <section className="forge-anim forge-d1">
      <MealBudgetStrip day={dayTotals ?? totals} meal={totals} goals={dayBase?.goals ?? null} mealName={slot?.name ?? 'Diese Mahlzeit'} />
    </section>

    {goals && slot && <button type="button" onClick={() => { haptic('tap'); setIdeasOpen(true); }}
      className="tap forge-anim forge-d1 flex h-12 w-full items-center gap-3 rounded-2xl px-4 text-left"
      style={{ background: 'linear-gradient(120deg, rgba(232,197,138,0.13), rgba(232,197,138,0.04))', border: `1px solid ${SAND}40` }}>
      <Sparkles size={17} style={{ color: SAND }} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" style={{ color: TEXT }}>Was passt noch?</span>
      {remainingKcal != null && <span className="shrink-0 text-[12px] tabular-nums" style={{ color: remainingKcal < 0 ? '#fca5a5' : SAND }}>{remainingKcal < 0 ? `${fmt(-remainingKcal)} kcal drüber` : `${fmt(remainingKcal)} kcal offen`}</span>}
      <ChevronRight size={15} className="shrink-0" style={{ color: FAINT }} />
    </button>}

    <section className="card-forge forge-anim forge-d1 overflow-hidden">
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>Getrackt</h2>
        {entries && entries.length > 0 && <span className="text-[11px]" style={{ color: FAINT }}>{entries.length}</span>}
      </div>
      {entries === null ? <div className="space-y-2 p-3">{[0, 1].map((item) => <div key={item} className="forge-skeleton h-12 rounded-xl" />)}</div>
        : entries.length ? <ul className="pb-1.5">{entries.map((entry) => <li key={entry.id} className={`forge-row-enter ${fresh.has(entry.id) ? 'track-row-flash' : ''}`}>
          <button type="button" onClick={() => { haptic('tap'); setEditing(entry); }} className="tap flex w-full items-center gap-3 px-4 py-2.5 text-left">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium" style={{ color: TEXT }}>{entry.name}</span>
              <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>{fmtAmount(entry.amount)} {entry.unit}{entry.brand ? ` · ${entry.brand}` : ''} · {fmt(entry.protein)} g P</span>
            </span>
            <span className="shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(entry.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>
            <ChevronRight size={15} className="shrink-0" style={{ color: FAINT }} />
          </button>
        </li>)}</ul>
          : <p className="px-4 pb-4 pt-1 text-[12.5px] leading-relaxed" style={{ color: DIM }}>Noch nichts in {slot?.name ?? 'dieser Mahlzeit'}. Such unten ein Lebensmittel oder scanne einen Barcode.</p>}
    </section>

    <section className="forge-anim forge-d2 grid grid-cols-4 gap-2" aria-label="Wie möchtest du tracken?">
      {tiles.map((tile) => <button key={tile.key} type="button" onClick={() => onTile(tile.key)} aria-disabled={tile.disabled || undefined}
        className="tap relative flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-2xl"
        style={tile.active
          ? { color: '#16130f', background: `linear-gradient(140deg, ${SAND}, #d4aa70)`, boxShadow: '0 10px 24px -14px rgba(232,197,138,0.7)' }
          : { color: tile.disabled ? FAINT : TEXT, background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}>
        <span style={{ color: tile.active ? '#16130f' : tile.disabled ? FAINT : SAND }}>{tile.icon}</span>
        <span className="text-[11.5px] font-semibold leading-none">{tile.label}</span>
        {tile.disabled && <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-semibold uppercase tracking-wider" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>Bald</span>}
      </button>)}
    </section>
    {/* No `capture`: the system offers camera and gallery, so a photo taken earlier can be tracked too. */}
    <input ref={cameraRef} type="file" accept="image/*" className="hidden" onChange={(event) => void onPhoto(event)} aria-hidden="true" tabIndex={-1} />

    <div ref={panelRef}>
      {slot && <FoodSearchPanel
        context={{ slotId: realSlotId, date }}
        slotName={slot.name}
        inputRef={searchRef}
        query={query}
        onQueryChange={setQuery}
        onQuickAdd={quickAdd}
        onOpenFood={(item) => openFood(item.source, item.source_id)}
      />}
    </div>

    {undo && <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: 'calc(var(--forge-nav-h, 64px) + 20px)', transition: 'bottom 0.2s' }}>
      <div role="status" className="forge-toast pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl py-2 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: `1px solid ${SAND}44` }}>
        <span className="min-w-0 flex-1 truncate">{undo.label}</span>
        <button type="button" onClick={() => void undoLast()} className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold" style={{ color: SAND }}><Undo2 size={15} />Rückgängig</button>
        <button type="button" onClick={() => setUndo(null)} aria-label="Hinweis schließen" className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={14} /></button>
      </div>
    </div>}

    {scanOpen && <BarcodeScannerSheet
      slotId={realSlotId}
      onFound={(food: FoodDetail) => { setScanOpen(false); openFood(food.source, food.source_id, { state: { food }, replace: true }); }}
      onOpenSearch={() => { setScanOpen(false); window.setTimeout(() => searchRef.current?.focus(), 320); }}
      onClose={() => setScanOpen(false)}
    />}
    {(textOpen || photo) && <SmartTrackSheet
      photo={photo ?? undefined}
      date={date}
      slotId={realSlotId}
      onTracked={(entry) => { setEntries((current) => [...(current ?? []).filter((item) => item.id !== entry.id), entry]); markFresh(entry.id); }}
      onUpdated={(entry) => { setEntries((current) => (current ?? []).map((item) => item.id === entry.id ? entry : item)); markFresh(entry.id); }}
      onRemoved={(id) => setEntries((current) => (current ?? []).filter((item) => item.id !== id))}
      onSearch={(value) => { setQuery(value); window.setTimeout(() => searchRef.current?.focus(), 320); }}
      // Closing mid-stream may leave an entry the server stored after the last event: resync the meal.
      onClose={() => { setTextOpen(false); setPhoto(null); void load(); }}
    />}
    {ideasOpen && slot && <MealIdeasSheet
      date={date}
      slotId={realSlotId}
      slotName={slot.name}
      remainingKcal={remainingKcal}
      remainingProtein={remainingProtein}
      onTracked={(entry) => { holdPanel(); setEntries((current) => [...(current ?? []), entry]); markFresh(entry.id); }}
      onClose={() => setIdeasOpen(false)}
    />}
    {editing && <EntryEditSheet
      entry={editing}
      onClose={() => setEditing(null)}
      onOpenFood={() => { setEditing(null); openFood(editing.source, editing.source_id, { replace: true }); }}
      onDelete={() => void removeEntry(editing, true)}
      onSave={async (amount) => {
        const updated = await updateTrackEntry(editing.id, amount);
        haptic('success');
        setEntries((current) => (current ?? []).map((item) => item.id === updated.id ? updated : item));
        markFresh(updated.id);
        setEditing(null);
      }}
    />}
  </div>;
}
