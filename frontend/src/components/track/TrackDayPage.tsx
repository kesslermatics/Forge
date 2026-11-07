import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus, Settings2 } from 'lucide-react';
import { createMealSlot, getMealSlots, getTrackDay, type MealSlot, type TrackDay } from '../../api/api';
import MealSlotsSheet from './MealSlotsSheet';
import { MacroPills, SlotIcon } from './shared';
import { BORDER, DIM, SAND, SLOT_SUGGESTIONS, TEXT, berlinToday, dayLabel, fmt, isValidIsoDate, shiftDate } from './trackUtils';

export default function TrackDayPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const date = isValidIsoDate(params.get('date')) ? params.get('date')! : berlinToday();
  const [day, setDay] = useState<TrackDay | null>(null);
  const [slots, setSlots] = useState<MealSlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dayData, slotData] = await Promise.all([getTrackDay(date), getMealSlots()]);
      setDay(dayData); setSlots(slotData.items);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Der Tag konnte nicht geladen werden.');
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const setDate = (value: string) => setParams(value === berlinToday() ? {} : { date: value }, { replace: true });
  const openSlot = (slotId: string) => navigate(`/nutrition/track/${slotId}${date === berlinToday() ? '' : `?date=${date}`}`);

  const quickCreate = async (name: string) => {
    setCreating(name); setError(null);
    try {
      const created = await createMealSlot(name);
      setSlots((current) => [...(current ?? []), created]);
      void load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Mahlzeit konnte nicht angelegt werden.');
    } finally { setCreating(null); }
  };

  const daySlots = day?.slots ?? [];
  const loading = !day || !slots;

  return <div className="space-y-4 pb-6">
    <header className="forge-anim flex items-center gap-3">
      <button type="button" onClick={() => navigate('/dashboard')} aria-label="Zurück zum Dashboard" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
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
        {daySlots.map((slot, index) => <button key={slot.id} type="button" onClick={() => openSlot(slot.id)} className={`card-forge tap forge-anim flex w-full items-center gap-3 p-3.5 text-left`} style={{ animationDelay: `${0.08 + index * 0.04}s` }}>
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
        {day.unassigned.entry_count > 0 && <button type="button" onClick={() => openSlot('unassigned')} className="card-forge tap flex w-full items-center gap-3 p-3.5 text-left" style={{ borderStyle: 'dashed' }}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><SlotIcon name="" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold" style={{ color: TEXT }}>Ohne Mahlzeit</span><span className="mt-1 block"><MacroPills compact totals={day.unassigned.totals} /></span></span>
          <span className="shrink-0 text-[16px] font-semibold tabular-nums" style={{ color: TEXT }}>{fmt(day.unassigned.totals.kcal)}<span className="ml-0.5 text-[10px] font-normal" style={{ color: DIM }}>kcal</span></span>
          <ChevronRight size={16} className="shrink-0" style={{ color: DIM }} />
        </button>}
        <div className="flex justify-center pt-1">
          <button type="button" onClick={() => setManageOpen(true)} className="tap flex h-10 items-center gap-2 rounded-full px-4 text-[12px] font-medium" style={{ color: DIM, border: `1px solid ${BORDER}` }}><Settings2 size={14} style={{ color: SAND }} />Mahlzeiten bearbeiten</button>
        </div>
      </section> : <section className="card-forge forge-anim forge-d2 p-5">
        <h2 className="text-[17px] font-semibold" style={{ color: TEXT }}>Wie teilst du deinen Tag ein?</h2>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: DIM }}>Lege deine Mahlzeiten einmal an, zum Beispiel Frühstück oder Pre-Workout. Du kannst sie jederzeit umbenennen oder löschen.</p>
        <div className="mt-4 flex flex-wrap gap-2">{SLOT_SUGGESTIONS.map((item) => <button key={item} type="button" disabled={creating !== null} onClick={() => void quickCreate(item)} className="tap flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] disabled:opacity-50" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>{creating === item ? <Loader2 size={13} className="animate-spin" style={{ color: SAND }} /> : <span style={{ color: SAND }}><SlotIcon name={item} size={14} /></span>}{item}</button>)}</div>
        <button type="button" onClick={() => setManageOpen(true)} className="tap mt-3 text-[12px] font-medium" style={{ color: SAND }}>Eigene Mahlzeit anlegen</button>
      </section>}
    </>}

    {manageOpen && slots && <MealSlotsSheet slots={slots} onChange={(next) => { setSlots(next); void load(); }} onClose={() => setManageOpen(false)} />}
  </div>;
}
