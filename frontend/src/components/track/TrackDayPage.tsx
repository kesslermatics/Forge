import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus, Settings2 } from 'lucide-react';
import {
  createMealSlot, deleteTrackEntry, getMealSlots, getTrackDay, getTrackDayEntries, updateTrackEntry,
  type MealSlot, type TrackDay, type TrackEntry,
} from '../../api/api';
import { haptic, useGoBack } from '../navigation';
import MealSlotsSheet from './MealSlotsSheet';
import EntryEditSheet from './EntryEditSheet';
import { MacroPills, SlotIcon } from './shared';
import {
  BORDER, CARBS, DIM, FAINT, FAT, PROTEIN, SAND, SLOT_SUGGESTIONS, TEXT, berlinToday, clearTrackFlash, dayLabel, fmt, fmtAmount,
  isValidIsoDate, shiftDate, timeLabel,
} from './trackUtils';

interface FeedGroup { id: string; name: string; kcal: number; entries: TrackEntry[] }

/** Entries grouped by meal in the user's slot order; food without a meal comes last. */
function feedGroups(slots: MealSlot[], entries: TrackEntry[]): FeedGroup[] {
  const groups: FeedGroup[] = [...slots.map((slot) => ({ id: slot.id, name: slot.name, kcal: 0, entries: [] as TrackEntry[] })),
  { id: 'unassigned', name: 'Ohne Mahlzeit', kcal: 0, entries: [] }];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const entry of entries) {
    const group = byId.get(entry.slot_id ?? 'unassigned') ?? byId.get('unassigned')!;
    group.entries.push(entry);
    group.kcal += entry.kcal;
  }
  return groups.filter((group) => group.entries.length > 0);
}

/** Thin protein/carbs/fat bar, weighted by energy. */
function MacroBar({ entry }: { entry: TrackEntry }) {
  const parts = [
    { value: entry.protein * 4, color: PROTEIN },
    { value: entry.carbs * 4, color: CARBS },
    { value: entry.fat * 9, color: FAT },
  ];
  const total = parts.reduce((acc, part) => acc + part.value, 0) || 1;
  return <span className="mt-1.5 flex h-1 w-16 overflow-hidden rounded-full" style={{ background: 'rgba(255,247,235,0.07)' }} aria-hidden="true">
    {parts.map((part, index) => <span key={index} style={{ width: `${(part.value / total) * 100}%`, background: part.color }} />)}
  </span>;
}

export default function TrackDayPage() {
  const navigate = useNavigate();
  const goBack = useGoBack('/dashboard');
  const [params, setParams] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const [day, setDay] = useState<TrackDay | null>(null);
  const [slots, setSlots] = useState<MealSlot[] | null>(null);
  const [entries, setEntries] = useState<TrackEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [editing, setEditing] = useState<TrackEntry | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dayData, slotData, entryData] = await Promise.all([getTrackDay(date), getMealSlots(), getTrackDayEntries(date)]);
      setDay(dayData); setSlots(slotData.items); setEntries(entryData.items);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Der Tag konnte nicht geladen werden.');
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  // A product added from this page's edit sheet has no meal page to show its toast.
  useEffect(() => { clearTrackFlash(); }, []);

  const setDate = (value: string) => { haptic('tap'); setParams(value === berlinToday() ? {} : { date: value }, { replace: true }); };
  const slotUrl = (slotId: string) => `/nutrition/track/${slotId}${date === berlinToday() ? '' : `?date=${date}`}`;
  const openSlot = (slotId: string) => { haptic('tap'); navigate(slotUrl(slotId)); };

  const quickCreate = async (name: string) => {
    setCreating(name); setError(null);
    try {
      const created = await createMealSlot(name);
      haptic('success');
      setSlots((current) => [...(current ?? []), created]);
      void load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Mahlzeit konnte nicht angelegt werden.');
    } finally { setCreating(null); }
  };

  const removeEntry = async (entry: TrackEntry) => {
    setEditing(null);
    setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
    try { await deleteTrackEntry(entry.id); haptic('tap'); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Löschen fehlgeschlagen.'); }
    void load();
  };

  const daySlots = day?.slots ?? [];
  const loading = !day || !slots || !entries;
  const groups = slots && entries ? feedGroups(slots, entries) : [];

  return <div className="space-y-4 pb-6">
    <header className="forge-anim flex items-center gap-3">
      <button type="button" onClick={goBack} aria-label="Zurück" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Ernährung tracken</p>
        <h1 className="truncate text-[23px] font-semibold leading-tight tracking-tight" style={{ color: TEXT }}>{dayLabel(date)}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => setDate(shiftDate(date, -1))} aria-label="Vorheriger Tag" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ChevronLeft size={19} /></button>
        <button type="button" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= berlinToday()} aria-label="Nächster Tag" className="tap flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-25" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ChevronRight size={19} /></button>
      </div>
    </header>
    {date !== berlinToday() && <button type="button" onClick={() => setDate(berlinToday())} className="tap -mt-2 text-[12px] font-medium" style={{ color: SAND }}>Zu heute springen</button>}

    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    {loading ? <div className="space-y-3">
      <div className="forge-skeleton h-[132px] rounded-3xl" />
      {[0, 1, 2].map((item) => <div key={item} className="forge-skeleton h-[72px] rounded-2xl" />)}
    </div> : <>
      <section className="card-forge forge-anim forge-d1 p-5" style={{ borderColor: `${SAND}24` }}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: DIM }}>Tagessumme</p>
          <p className="text-[11px]" style={{ color: DIM }}>{day.entry_count} {day.entry_count === 1 ? 'Eintrag' : 'Einträge'}</p>
        </div>
        <p className="track-number mt-1 text-[40px] font-light leading-none tabular-nums" key={day.totals.kcal} style={{ color: TEXT }}>{fmt(day.totals.kcal)}<span className="ml-1.5 text-[15px]" style={{ color: DIM }}>kcal</span></p>
        <div className="mt-4"><MacroPills totals={day.totals} /></div>
      </section>

      {slots.length > 0 ? <section className="space-y-2">
        {daySlots.map((slot, index) => <button key={slot.id} type="button" onClick={() => openSlot(slot.id)} className="card-forge tap forge-anim flex w-full items-center gap-3 p-3.5 text-left" style={{ animationDelay: `${0.08 + index * 0.04}s` }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><SlotIcon name={slot.name} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold" style={{ color: TEXT }}>{slot.name}</span>
            {slot.entry_count ? <span className="mt-1 block"><MacroPills compact totals={slot.totals} /></span>
              : <span className="mt-0.5 block text-[12px]" style={{ color: DIM }}>Noch nichts getrackt</span>}
          </span>
          <span className="shrink-0 text-right">
            {slot.entry_count ? <span className="block text-[16px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(slot.totals.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>
              : <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ color: '#16130f', background: SAND }}><Plus size={16} /></span>}
          </span>
          {slot.entry_count > 0 && <ChevronRight size={16} className="shrink-0" style={{ color: DIM }} />}
        </button>)}
        <div className="flex justify-center pt-1">
          <button type="button" onClick={() => { haptic('tap'); setManageOpen(true); }} className="tap flex h-10 items-center gap-2 rounded-full px-4 text-[12px] font-medium" style={{ color: DIM, border: `1px solid ${BORDER}` }}><Settings2 size={14} style={{ color: SAND }} />Mahlzeiten bearbeiten</button>
        </div>
      </section> : <section className="card-forge forge-anim forge-d2 p-5">
        <h2 className="text-[17px] font-semibold" style={{ color: TEXT }}>Wie teilst du deinen Tag ein?</h2>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: DIM }}>Lege deine Mahlzeiten einmal an, zum Beispiel Frühstück oder Pre-Workout. Du kannst sie jederzeit umbenennen oder löschen.</p>
        <div className="mt-4 flex flex-wrap gap-2">{SLOT_SUGGESTIONS.map((item) => <button key={item} type="button" disabled={creating !== null} onClick={() => void quickCreate(item)} className="tap flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] disabled:opacity-50" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>{creating === item ? <Loader2 size={13} className="animate-spin" style={{ color: SAND }} /> : <span style={{ color: SAND }}><SlotIcon name={item} size={14} /></span>}{item}</button>)}</div>
        <button type="button" onClick={() => setManageOpen(true)} className="tap mt-3 text-[12px] font-medium" style={{ color: SAND }}>Eigene Mahlzeit anlegen</button>
      </section>}

      {groups.length > 0 && <section className="forge-anim forge-d3 pt-2" aria-label="Alles, was getrackt wurde">
        <div className="flex items-baseline justify-between px-1 pb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}>{date === berlinToday() ? 'Heute gegessen' : 'Gegessen'}</h2>
          <span className="text-[11px] tabular-nums" style={{ color: FAINT }}>{entries.length} Lebensmittel</span>
        </div>
        <div className="space-y-3">
          {groups.map((group) => <div key={group.id} className="card-forge overflow-hidden">
            <button type="button" onClick={() => openSlot(group.id)} className="tap flex w-full items-center gap-2.5 px-4 pb-2 pt-3.5 text-left">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ color: '#16130f', background: group.id === 'unassigned' ? DIM : SAND }}><SlotIcon name={group.id === 'unassigned' ? '' : group.name} size={14} /></span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: TEXT }}>{group.name}</span>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: SAND }}>{fmt(group.kcal)} kcal</span>
              <ChevronRight size={14} className="shrink-0" style={{ color: FAINT }} />
            </button>
            {/* Timeline: a hairline links the entries of one meal. */}
            <ul className="relative pb-2">
              <span className="absolute bottom-4 left-[29px] top-1 w-px" style={{ background: `linear-gradient(${SAND}55, ${SAND}08)` }} aria-hidden="true" />
              {group.entries.map((entry) => <li key={entry.id}>
                <button type="button" onClick={() => { haptic('tap'); setEditing(entry); }} className="tap relative flex w-full items-start gap-3 py-2 pl-[25px] pr-4 text-left">
                  <span className="relative z-10 mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: '#1d1913', border: `2px solid ${SAND}` }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium" style={{ color: TEXT }}>{entry.name}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] tabular-nums" style={{ color: DIM }}>
                      {fmtAmount(entry.amount)} {entry.unit}{entry.brand ? ` · ${entry.brand}` : ''}
                    </span>
                    <MacroBar entry={entry} />
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[14px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(entry.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>
                    <span className="mt-0.5 block text-[10.5px] tabular-nums" style={{ color: FAINT }}>{timeLabel(entry.logged_at)}</span>
                  </span>
                </button>
              </li>)}
            </ul>
          </div>)}
        </div>
      </section>}
    </>}

    {manageOpen && slots && <MealSlotsSheet slots={slots} onChange={(next) => { setSlots(next); void load(); }} onClose={() => setManageOpen(false)} />}
    {editing && <EntryEditSheet
      entry={editing}
      onClose={() => setEditing(null)}
      onOpenFood={() => {
        setEditing(null);
        navigate(`/nutrition/food/${editing.source}/${encodeURIComponent(editing.source_id)}?slot=${editing.slot_id ?? 'unassigned'}${date === berlinToday() ? '' : `&date=${date}`}`, { replace: true });
      }}
      onDelete={() => void removeEntry(editing)}
      onSave={async (amount) => {
        const updated = await updateTrackEntry(editing.id, amount);
        haptic('success');
        setEntries((current) => (current ?? []).map((item) => item.id === updated.id ? updated : item));
        setEditing(null);
        void load();
      }}
    />}
  </div>;
}
