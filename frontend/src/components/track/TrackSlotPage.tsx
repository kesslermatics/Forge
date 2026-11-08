import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, MessageSquareText, ScanBarcode, Search, Undo2, X } from 'lucide-react';
import {
  createTrackEntry, deleteTrackEntry, getMealSlots, getTrackEntries, updateTrackEntry,
  type FoodDetail, type FoodSummary, type MealSlot, type TrackEntry, type TrackMacros,
} from '../../api/api';
import { haptic, useGoBack } from '../navigation';
import FoodSearchPanel from './FoodSearchPanel';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import SmartTrackSheet from './SmartTrackSheet';
import EntryEditSheet from './EntryEditSheet';
import { MacroPills, SlotIcon } from './shared';
import {
  BORDER, DIM, FAINT, SAND, TEXT, berlinToday, clearTrackFlash, fmt, fmtAmount, isValidIsoDate, peekTrackFlash, shortDate,
} from './trackUtils';

const EMPTY: TrackMacros = { kcal: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, saturated: 0, salt: 0 };

function sum(entries: TrackEntry[]): TrackMacros {
  return entries.reduce((acc, entry) => ({
    kcal: acc.kcal + entry.kcal, protein: acc.protein + entry.protein, carbs: acc.carbs + entry.carbs, fat: acc.fat + entry.fat,
    sugar: acc.sugar + (entry.sugar ?? 0), fiber: acc.fiber + (entry.fiber ?? 0), saturated: acc.saturated + (entry.saturated ?? 0), salt: acc.salt + (entry.salt ?? 0),
  }), { ...EMPTY });
}

async function fetchSlot(date: string, slotId: string | null): Promise<{ slot: MealSlot; entries: TrackEntry[] } | { error: string }> {
  try {
    const [slotData, entryData] = await Promise.all([getMealSlots(), getTrackEntries(date, slotId)]);
    const slot = slotId ? slotData.items.find((item) => item.id === slotId) ?? null : { id: 'unassigned', name: 'Ohne Mahlzeit', position: -1 };
    if (!slot) return { error: 'Diese Mahlzeit gibt es nicht mehr.' };
    return { slot, entries: entryData.items };
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
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [editing, setEditing] = useState<TrackEntry | null>(null);
  // An entry added on the product page arrives via the flash store for instant feedback.
  const [addedOnProduct] = useState(peekTrackFlash);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(addedOnProduct ? [addedOnProduct.id] : []));
  const [undo, setUndo] = useState<Undo | null>(() => addedOnProduct ? { kind: 'added', entry: addedOnProduct, label: addedLabel(addedOnProduct) } : null);
  const [soon, setSoon] = useState<string | null>(null);
  const undoTimer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const applyLoaded = useCallback((result: Awaited<ReturnType<typeof fetchSlot>>) => {
    if ('error' in result) { setError(result.error); setEntries((current) => current ?? []); return; }
    setError(null); setSlot(result.slot); setEntries(result.entries);
  }, []);

  const load = useCallback(() => fetchSlot(date, realSlotId).then(applyLoaded), [date, realSlotId, applyLoaded]);

  useEffect(() => {
    let active = true;
    fetchSlot(date, realSlotId).then((result) => { if (active) applyLoaded(result); });
    return () => { active = false; };
  }, [date, realSlotId, applyLoaded]);

  const markFresh = useCallback((id: string) => {
    setFresh((current) => new Set(current).add(id));
    window.setTimeout(() => setFresh((current) => { const next = new Set(current); next.delete(id); return next; }), 1400);
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
    const freshTimer = window.setTimeout(() => setFresh(new Set()), 1400);
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
    else if (key === 'camera') setSoon('Foto-Erkennung kommt in einer späteren Version.');
    else setTextOpen(true);
  };

  const totals = sum(entries ?? []);
  const tiles = [
    { key: 'search', icon: <Search size={19} />, label: 'Suche', active: true, disabled: false },
    { key: 'barcode', icon: <ScanBarcode size={19} />, label: 'Barcode', active: false, disabled: false },
    { key: 'camera', icon: <Camera size={19} />, label: 'Kamera', active: false, disabled: true },
    { key: 'voice', icon: <MessageSquareText size={19} />, label: 'Text', active: false, disabled: false },
  ];

  return <div className="space-y-4 pb-10">
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

    <section className="forge-anim forge-d1"><MacroPills totals={totals} /></section>

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
    {soon && <p className="forge-msg-in -mt-1 rounded-2xl px-4 py-3 text-[12px]" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}>{soon}</p>}

    {slot && <FoodSearchPanel
      inputRef={searchRef}
      query={query}
      onQueryChange={setQuery}
      onQuickAdd={quickAdd}
      onOpenFood={(item) => openFood(item.source, item.source_id)}
    />}

    {undo && <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: 'calc(var(--forge-nav-h, 64px) + 20px)', transition: 'bottom 0.2s' }}>
      <div role="status" className="forge-toast pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl py-2 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: `1px solid ${SAND}44` }}>
        <span className="min-w-0 flex-1 truncate">{undo.label}</span>
        <button type="button" onClick={() => void undoLast()} className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold" style={{ color: SAND }}><Undo2 size={15} />Rückgängig</button>
        <button type="button" onClick={() => setUndo(null)} aria-label="Hinweis schließen" className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={14} /></button>
      </div>
    </div>}

    {scanOpen && <BarcodeScannerSheet
      onFound={(food: FoodDetail) => { setScanOpen(false); openFood(food.source, food.source_id, { state: { food }, replace: true }); }}
      onOpenSearch={() => { setScanOpen(false); window.setTimeout(() => searchRef.current?.focus(), 320); }}
      onClose={() => setScanOpen(false)}
    />}
    {textOpen && <SmartTrackSheet
      date={date}
      slotId={realSlotId}
      onTracked={(entry) => { setEntries((current) => [...(current ?? []), entry]); markFresh(entry.id); }}
      onRemoved={(id) => setEntries((current) => (current ?? []).filter((item) => item.id !== id))}
      onSearch={(value) => { setQuery(value); window.setTimeout(() => searchRef.current?.focus(), 320); }}
      onClose={() => setTextOpen(false)}
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
