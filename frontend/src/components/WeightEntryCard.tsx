import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Minus, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { deleteWeight, getWeightClothing, saveWeight, type ClothingItem, type WeightMeasurement } from '../api/api';
import { haptic } from './navigation';
import { berlinToday } from './track/trackUtils';
import ClothingIcon from './ClothingIcon';
import ClothingEditorSheet from './ClothingEditorSheet';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.5)';
const FAINT = 'rgba(242,236,226,0.32)';
const BORDER = 'rgba(232,197,138,0.12)';

const AUTOSAVE_MS = 5_000;
const PENDING_KEY = 'forge.pendingWeight';
const FALLBACK_KG = 70;

interface Pending { date: string; weight_kg: number }

const readPending = (): Pending | null => {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null;
    return value && typeof value.weight_kg === 'number' && typeof value.date === 'string' ? value : null;
  } catch { return null; }
};
const writePending = (value: Pending | null) => {
  try { if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value)); else localStorage.removeItem(PENDING_KEY); }
  catch { /* storage unavailable */ }
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const format = (value: number) => value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

// One request per page load, also under StrictMode's double effects; updated after editing.
let clothingRequest: Promise<{ items: ClothingItem[] }> | null = null;
const loadClothing = () => clothingRequest ??= getWeightClothing().catch((caught: unknown) => { clothingRequest = null; throw caught; });

interface Props {
  /** Newest stored weighing (any day), or null when nothing was ever entered. */
  latest: WeightMeasurement | null;
  /** Today's weighings, oldest first. */
  today: WeightMeasurement[];
  onSaved: (entry: WeightMeasurement) => void;
  onDeleted: () => void;
}

/**
 * Weight entry: − / value / +, steps of 0.1 kg (hold to repeat). Every save adds a weighing; a day can
 * have several (shown as chips below, tap twice to delete one).
 *
 * Saving: 5 s after the last change. Anything unsaved is also sent the moment the app goes to the
 * background or the page closes (keepalive request survives that) and when the dashboard is left.
 * The pending value additionally sits in localStorage and is sent on the next start, so a killed
 * app or a failed request loses nothing.
 *
 * Below the stepper sit the user's clothing tiles (shorts, phone, ...). Once a weight was entered, a
 * tap subtracts that item from the value, a second tap adds it back; after saving all reset.
 */
export default function WeightEntryCard({ latest, today: todayEntries, onSaved, onDeleted }: Props) {
  const today = berlinToday();
  const savedToday = latest?.date === today;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef(0);
  // `draft` is the unsaved value; without one the card shows the stored weight.
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null); // raw text while the field is being edited
  const [status, setStatus] = useState<Status>('idle');
  const [changeCount, setChangeCount] = useState(0);
  const [clothing, setClothing] = useState<ClothingItem[] | null>(null);
  const [clothingFailed, setClothingFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const value = draft ?? latest?.weight_kg ?? FALLBACK_KG;

  const draftRef = useRef<number | null>(null);
  // Unrounded value, so adding an item back (e.g. 250 g) restores exactly what was there before.
  const rawRef = useRef<number | null>(null);
  const latestRef = useRef(latest);
  const timerRef = useRef(0);
  const savingRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  const flushRef = useRef<(keepalive: boolean) => Promise<void>>(async () => undefined);
  const scheduleRef = useRef<() => void>(() => undefined);
  const currentValue = () => draftRef.current ?? latestRef.current?.weight_kg ?? FALLBACK_KG;

  function schedule() {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = 0; void flushRef.current(false); }, AUTOSAVE_MS);
  }

  async function flush(keepalive: boolean) {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    const weight = draftRef.current;
    if (weight === null || savingRef.current) return;
    const payload: Pending = { date: berlinToday(), weight_kg: weight };
    writePending(payload);
    savingRef.current = true;
    if (!keepalive) setStatus('saving');
    try {
      const saved = await saveWeight(payload.weight_kg, payload.date, keepalive);
      onSavedRef.current(saved);
      // Only clean when the value did not change while the request was running.
      if (draftRef.current === payload.weight_kg) { draftRef.current = null; rawRef.current = null; setDraft(null); setSelected(new Set()); writePending(null); }
      setStatus(draftRef.current === null ? 'saved' : 'dirty');
      if (!keepalive) haptic('success');
    } catch {
      setStatus(keepalive ? 'dirty' : 'error');
    } finally {
      savingRef.current = false;
    }
    // Failed (online) or changed meanwhile: try again later. Backgrounded apps retry when visible again.
    if (draftRef.current !== null && !keepalive && !timerRef.current) scheduleRef.current();
  }

  useEffect(() => {
    latestRef.current = latest;
    onSavedRef.current = onSaved;
    flushRef.current = flush;
    scheduleRef.current = schedule;
  });

  function commit(clamped: number, raw = clamped) {
    rawRef.current = raw;
    draftRef.current = clamped;
    setDraft(clamped);
    setStatus('dirty');
    setChangeCount((count) => count + 1);
    writePending({ date: berlinToday(), weight_kg: clamped });
    schedule();
  }

  function change(next: number) {
    const clamped = Math.min(400, Math.max(20, round1(next)));
    if (clamped === currentValue()) return;
    commit(clamped);
  }

  function toggleClothing(item: ClothingItem) {
    if (draftRef.current === null) return;
    const on = !selected.has(item.id);
    const raw = (rawRef.current ?? draftRef.current) + (on ? -1 : 1) * item.weight_g / 1000;
    commit(Math.min(400, Math.max(20, round1(raw))), raw);
    setSelected((current) => { const next = new Set(current); if (on) next.add(item.id); else next.delete(item.id); return next; });
    haptic('tap');
  }

  useEffect(() => {
    let active = true;
    loadClothing().then((result) => { if (active) setClothing(result.items); }).catch(() => { if (active) setClothingFailed(true); });
    return () => { active = false; };
  }, []);

  // A previous session may have ended before saving: send what is still pending.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    saveWeight(pending.weight_kg, pending.date).then((saved) => {
      if (draftRef.current === null) writePending(null);
      onSavedRef.current(saved);
    }).catch(() => undefined);
  }, []);

  // Save when the app is backgrounded, the page closes or the dashboard is left.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flushRef.current(true);
      else if (draftRef.current !== null && !timerRef.current) scheduleRef.current();
    };
    const onPageHide = () => void flushRef.current(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flushRef.current(true);
    };
  }, []);

  // Hold − / + to repeat.
  const holdRef = useRef({ delay: 0, repeat: 0 });
  const stopHold = () => {
    window.clearTimeout(holdRef.current.delay);
    window.clearInterval(holdRef.current.repeat);
  };
  useEffect(() => () => {
    window.clearTimeout(holdRef.current.delay);
    window.clearInterval(holdRef.current.repeat);
  }, []);

  const startHold = (direction: 1 | -1) => (event: React.PointerEvent) => {
    event.preventDefault();
    stopHold();
    haptic('tap');
    setText(null);
    change(currentValue() + direction * 0.1);
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.repeat = window.setInterval(() => change(currentValue() + direction * 0.1), 70);
    }, 420);
  };
  const onKeyStep = (direction: 1 | -1) => (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setText(null); change(currentValue() + direction * 0.1); }
  };

  const commitText = () => {
    if (text === null) return;
    const parsed = Number(text.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) change(parsed);
    setText(null);
  };

  const stepButton = (direction: 1 | -1) => (
    <button
      type="button"
      onPointerDown={startHold(direction)}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyStep(direction)}
      aria-label={direction === 1 ? '0,1 Kilogramm mehr' : '0,1 Kilogramm weniger'}
      className="tap flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-2xl"
      style={{ color: SAND, background: 'rgba(232,197,138,0.1)', border: `1px solid ${BORDER}`, touchAction: 'none' }}
    >
      {direction === 1 ? <Plus size={22} /> : <Minus size={22} />}
    </button>
  );

  useEffect(() => () => window.clearTimeout(confirmTimerRef.current), []);

  // First tap arms the chip ("Löschen?"), a second one within 3 s deletes the weighing.
  async function pressMeasurement(entry: WeightMeasurement) {
    window.clearTimeout(confirmTimerRef.current);
    if (confirmId !== entry.id) {
      setConfirmId(entry.id);
      confirmTimerRef.current = window.setTimeout(() => setConfirmId(null), 3000);
      haptic('tap');
      return;
    }
    setConfirmId(null);
    try {
      await deleteWeight(entry.id);
      haptic('success');
    } catch { /* the list below is reloaded either way */ }
    onDeleted();
  }

  const offsetKg = (clothing ?? []).filter((item) => selected.has(item.id)).reduce((sum, item) => sum + item.weight_g, 0) / 1000;
  const canPick = draft !== null;

  const hint = (() => {
    if (status === 'saving') return <><Loader2 size={11} className="animate-spin" />Speichert…</>;
    if (status === 'error') return <span style={{ color: '#fca5a5' }}>Nicht gespeichert · neuer Versuch folgt</span>;
    if (status === 'dirty') return <>Speichert automatisch{offsetKg > 0 ? ` · −${offsetKg.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg Kleidung` : ''}</>;
    if (status === 'saved' || savedToday) return <><Check size={11} style={{ color: '#4ade80' }} />Heute gespeichert{todayEntries.length > 1 ? ` · ${todayEntries.length} Messungen` : ''}</>;
    if (latest) {
      const label = new Date(`${latest.date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
      return <>Zuletzt gewogen am {label}</>;
    }
    return <>Trag dein erstes Gewicht ein</>;
  })();

  return (
    <section className="forge-anim forge-d2" aria-label="Gewicht eintragen">
      <div className="card-forge relative overflow-hidden p-2.5" style={{ borderColor: status === 'dirty' ? `${SAND}44` : undefined }}>
        <div className="flex items-center gap-2.5">
          {stepButton(-1)}
          <div className="min-w-0 flex-1 text-center">
            <div className="flex items-baseline justify-center gap-1">
              <Scale size={13} className="self-center" style={{ color: DIM }} aria-hidden="true" />
              <input
                value={text ?? format(value)}
                onFocus={(event) => { setText(format(currentValue())); event.target.select(); }}
                onChange={(event) => setText(event.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
                onBlur={commitText}
                onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
                inputMode="decimal"
                enterKeyHint="done"
                aria-label="Gewicht in Kilogramm"
                className="track-amount-input w-[104px] bg-transparent text-center text-[30px] font-semibold tabular-nums leading-none outline-none"
                style={{ color: latest || draft !== null ? TEXT : FAINT }}
              />
              <span className="text-[13px]" style={{ color: DIM }}>kg</span>
            </div>
            <p className="mt-1.5 flex h-3.5 items-center justify-center gap-1 text-[10.5px]" style={{ color: DIM }} aria-live="polite">{hint}</p>
          </div>
          {stepButton(1)}
        </div>
        {todayEntries.length > 0 && <div className="mt-2 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Messungen heute">
          {todayEntries.map((entry) => {
            const armed = confirmId === entry.id;
            return <button key={entry.id} type="button" onClick={() => void pressMeasurement(entry)}
              aria-label={armed ? 'Messung löschen' : `Messung ${entry.time ?? ''} ${format(entry.weight_kg)} Kilogramm, zum Löschen zweimal tippen`}
              className="tap flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] tabular-nums"
              style={armed ? { color: '#fca5a5', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)' } : { color: DIM, background: 'rgba(232,197,138,0.06)', border: `1px solid ${BORDER}` }}>
              {armed ? <><Trash2 size={12} />Löschen?</> : <>{entry.time && <span style={{ color: FAINT }}>{entry.time}</span>}<span style={{ color: TEXT }}>{format(entry.weight_kg)} kg</span></>}
            </button>;
          })}
        </div>}
        {!clothingFailed && <div className="mt-2.5 flex items-center gap-1.5">
          {clothing === null ? <div className="forge-skeleton h-11 flex-1 rounded-xl" aria-hidden="true" /> : <>
            <div className="flex min-w-0 flex-1 gap-1.5" role="group" aria-label="Kleidung abziehen">
              {clothing.map((item) => {
                const active = selected.has(item.id);
                return <button key={item.id} type="button" onClick={() => toggleClothing(item)} disabled={!canPick} aria-pressed={active}
                  aria-label={`${item.name}, ${item.weight_g} g abziehen`} title={`${item.name} · ${item.weight_g} g`}
                  className="tap flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl disabled:opacity-35"
                  style={active ? { color: '#16130f', background: SAND } : { color: SAND, background: 'rgba(232,197,138,0.08)', border: `1px solid ${BORDER}` }}>
                  <ClothingIcon icon={item.icon} size={19} />
                </button>;
              })}
            </div>
            <button type="button" onClick={() => setEditorOpen(true)} aria-label="Kleidung bearbeiten" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color: DIM }}><Pencil size={16} /></button>
          </>}
        </div>}
        {/* Countdown to the automatic save; restarts with every change. */}
        {status === 'dirty' && <span key={changeCount} className="weight-countdown absolute bottom-0 left-0 h-[2px]" style={{ background: SAND, animationDuration: `${AUTOSAVE_MS}ms` }} aria-hidden="true" />}
      </div>
      {editorOpen && clothing && <ClothingEditorSheet
        items={clothing}
        onSaved={(items) => {
          clothingRequest = Promise.resolve({ items });
          setClothing(items);
          setSelected((current) => new Set(items.filter((item) => current.has(item.id)).map((item) => item.id)));
        }}
        onClose={() => setEditorOpen(false)}
      />}
    </section>
  );
}
