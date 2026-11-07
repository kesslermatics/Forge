import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronRight, MessageSquareText, ScanBarcode, Search, Undo2, X } from 'lucide-react';
import {
  createTrackEntry, deleteTrackEntry, getMealSlots, getTrackEntries, updateTrackEntry,
  type FoodDetail, type FoodSummary, type MealSlot, type TrackEntry, type TrackMacros,
} from '../../api/api';
import FoodSearchSheet from './FoodSearchSheet';
import BarcodeScannerSheet from './BarcodeScannerSheet';
import EntryEditSheet from './EntryEditSheet';
import { MacroPills, SlotIcon } from './shared';
import { BORDER, DIM, FAINT, SAND, TEXT, berlinToday, fmt, fmtAmount, isValidIsoDate, shortDate } from './trackUtils';

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

export default function TrackSlotPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { slotId = '' } = useParams();
  const [params] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const realSlotId = slotId === 'unassigned' ? null : slotId;
  const dateQuery = date === berlinToday() ? '' : `?date=${date}`;

  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [entries, setEntries] = useState<TrackEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(params.get('open') === 'search');
  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState<TrackEntry | null>(null);
  // An entry added on the product page arrives via navigation state for instant feedback.
  const [addedViaState] = useState(() => (location.state as { added?: TrackEntry } | null)?.added ?? null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set(addedViaState ? [addedViaState.id] : []));
  const [undo, setUndo] = useState<{ kind: 'added' | 'deleted'; entry: TrackEntry; label: string } | null>(() => addedViaState
    ? { kind: 'added', entry: addedViaState, label: `${addedViaState.name} · ${fmtAmount(addedViaState.amount)} ${addedViaState.unit} hinzugefügt` }
    : null);
  const [soon, setSoon] = useState<string | null>(null);
  const undoTimer = useRef<number>(0);

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

  const showUndo = useCallback((kind: 'added' | 'deleted', entry: TrackEntry, label: string) => {
    window.clearTimeout(undoTimer.current);
    setUndo({ kind, entry, label });
    undoTimer.current = window.setTimeout(() => setUndo(null), 4500);
  }, []);

  useEffect(() => {
    if (!addedViaState) return;
    // Clear the one-shot state so a reload or back navigation does not show the toast again.
    navigate(location.pathname + location.search, { replace: true, state: null });
    undoTimer.current = window.setTimeout(() => setUndo(null), 4500);
    const freshTimer = window.setTimeout(() => setFresh(new Set()), 1400);
    return () => window.clearTimeout(freshTimer);
  }, [addedViaState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const addEntry = async (source: TrackEntry['source'], sourceId: string, amount: number) => {
    const entry = await createTrackEntry({ date, slot_id: realSlotId, source, source_id: sourceId, amount });
    setEntries((current) => [...(current ?? []), entry]);
    markFresh(entry.id);
    return entry;
  };

  const quickAdd = async (item: FoodSummary) => {
    const entry = await addEntry(item.source, item.source_id, item.default_amount);
    showUndo('added', entry, `${entry.name} · ${fmtAmount(entry.amount)} ${entry.unit} hinzugefügt`);
  };

  const removeEntry = async (entry: TrackEntry, offerUndo: boolean) => {
    setEditing(null);
    setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
    try {
      await deleteTrackEntry(entry.id);
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
    if (kind === 'added') { await removeEntry(entry, false); return; }
    try { await addEntry(entry.source, entry.source_id, entry.amount); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Wiederherstellen fehlgeschlagen.'); }
  };

  const openFood = (source: string, sourceId: string, state?: unknown) =>
    navigate(`/nutrition/food/${source}/${encodeURIComponent(sourceId)}?slot=${slotId}${date === berlinToday() ? '' : `&date=${date}`}`, { state });

  const totals = sum(entries ?? []);
  const tiles = [
    { key: 'search', icon: <Search size={22} />, label: 'Suche', hint: 'Name oder Marke', onClick: () => setSearchOpen(true), primary: true },
    { key: 'barcode', icon: <ScanBarcode size={22} />, label: 'Barcode', hint: 'Packung scannen', onClick: () => setScanOpen(true), primary: false },
    { key: 'camera', icon: <Camera size={22} />, label: 'Kamera', hint: 'Bald verfügbar', onClick: () => setSoon('Foto-Erkennung kommt in einer späteren Version.'), disabled: true },
    { key: 'voice', icon: <MessageSquareText size={22} />, label: 'Sprache / Text', hint: 'Bald verfügbar', onClick: () => setSoon('Tracken per Sprache oder Freitext kommt in einer späteren Version.'), disabled: true },
  ];

  return <div className="space-y-4 pb-10">
    <header className="forge-anim flex items-center gap-3">
      <button type="button" onClick={() => navigate(`/nutrition/track${dateQuery}`)} aria-label="Zurück zur Tagesübersicht" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
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

    <section className="card-forge forge-anim forge-d2 overflow-hidden">
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>Getrackt</h2>
        {entries && entries.length > 0 && <span className="text-[11px]" style={{ color: FAINT }}>{entries.length}</span>}
      </div>
      {entries === null ? <div className="space-y-2 p-3">{[0, 1].map((item) => <div key={item} className="forge-skeleton h-12 rounded-xl" />)}</div>
        : entries.length ? <ul className="pb-1.5">{entries.map((entry) => <li key={entry.id} className={`forge-row-enter ${fresh.has(entry.id) ? 'track-row-flash' : ''}`}>
          <button type="button" onClick={() => setEditing(entry)} className="tap flex w-full items-center gap-3 px-4 py-2.5 text-left">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium" style={{ color: TEXT }}>{entry.name}</span>
              <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>{fmtAmount(entry.amount)} {entry.unit}{entry.brand ? ` · ${entry.brand}` : ''} · {fmt(entry.protein)} g P</span>
            </span>
            <span className="shrink-0 text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(entry.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>
            <ChevronRight size={15} className="shrink-0" style={{ color: FAINT }} />
          </button>
        </li>)}</ul>
          : <p className="px-4 pb-4 pt-1 text-[12.5px] leading-relaxed" style={{ color: DIM }}>Noch nichts in {slot?.name ?? 'dieser Mahlzeit'}. Such ein Lebensmittel oder scanne einen Barcode.</p>}
    </section>

    <section className="grid grid-cols-2 gap-2.5 forge-anim forge-d3">
      {tiles.map((tile) => <button key={tile.key} type="button" onClick={tile.onClick} aria-disabled={tile.disabled || undefined}
        className="tap relative flex min-h-[104px] flex-col justify-between rounded-3xl p-4 text-left"
        style={tile.primary
          ? { color: '#16130f', background: `linear-gradient(140deg, ${SAND}, #d4aa70)`, boxShadow: '0 14px 32px -16px rgba(232,197,138,0.65)' }
          : { color: tile.disabled ? FAINT : TEXT, background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}>
        <span style={{ color: tile.primary ? '#16130f' : tile.disabled ? FAINT : SAND }}>{tile.icon}</span>
        <span>
          <span className="block text-[15px] font-semibold">{tile.label}</span>
          <span className="mt-0.5 block text-[11px]" style={{ opacity: tile.primary ? 0.7 : 1, color: tile.primary ? undefined : DIM }}>{tile.hint}</span>
        </span>
        {tile.disabled && <span className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>Bald</span>}
      </button>)}
    </section>
    {soon && <p className="forge-msg-in rounded-2xl px-4 py-3 text-[12px]" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}>{soon}</p>}

    {undo && <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[60] flex justify-center px-4">
      <div role="status" className="forge-toast pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl py-2 pl-4 pr-2 text-[13px] shadow-2xl" style={{ color: TEXT, background: '#2a2318', border: `1px solid ${SAND}44` }}>
        <span className="min-w-0 flex-1 truncate">{undo.label}</span>
        <button type="button" onClick={() => void undoLast()} className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold" style={{ color: SAND }}><Undo2 size={15} />Rückgängig</button>
        <button type="button" onClick={() => setUndo(null)} aria-label="Hinweis schließen" className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={14} /></button>
      </div>
    </div>}

    {searchOpen && slot && <FoodSearchSheet
      slotName={slot.name}
      onQuickAdd={quickAdd}
      onOpenFood={(item) => { setSearchOpen(false); openFood(item.source, item.source_id); }}
      onClose={() => setSearchOpen(false)}
    />}
    {scanOpen && <BarcodeScannerSheet
      onFound={(food: FoodDetail) => { setScanOpen(false); openFood(food.source, food.source_id, { food }); }}
      onOpenSearch={() => { setScanOpen(false); setSearchOpen(true); }}
      onClose={() => setScanOpen(false)}
    />}
    {editing && <EntryEditSheet
      entry={editing}
      onClose={() => setEditing(null)}
      onOpenFood={() => { setEditing(null); openFood(editing.source, editing.source_id); }}
      onDelete={() => void removeEntry(editing, true)}
      onSave={async (amount) => {
        const updated = await updateTrackEntry(editing.id, amount);
        setEntries((current) => (current ?? []).map((item) => item.id === updated.id ? updated : item));
        markFresh(updated.id);
        setEditing(null);
      }}
    />}
  </div>;
}
