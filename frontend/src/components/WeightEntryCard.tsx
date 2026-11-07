import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Minus, Plus, Scale } from 'lucide-react';
import { saveWeight, type WeightHistoryEntry } from '../api/api';
import { haptic } from './navigation';
import { berlinToday } from './track/trackUtils';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.5)';
const FAINT = 'rgba(242,236,226,0.32)';
const BORDER = 'rgba(232,197,138,0.12)';

const AUTOSAVE_MS = 30_000;
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

interface Props {
  /** Newest stored weight (any day), or null when nothing was ever entered. */
  latest: WeightHistoryEntry | null;
  onSaved: (entry: WeightHistoryEntry) => void;
}

/**
 * Weight entry for today: − / value / +, steps of 0.1 kg (hold to repeat).
 *
 * Saving: 30 s after the last change. Anything unsaved is also sent the moment the app goes to the
 * background or the page closes (keepalive request survives that) and when the dashboard is left.
 * The pending value additionally sits in localStorage and is sent on the next start, so a killed
 * app or a failed request loses nothing.
 */
export default function WeightEntryCard({ latest, onSaved }: Props) {
  const today = berlinToday();
  const savedToday = latest?.date === today;
  // `draft` is the unsaved value; without one the card shows the stored weight.
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null); // raw text while the field is being edited
  const [status, setStatus] = useState<Status>('idle');
  const [changeCount, setChangeCount] = useState(0);
  const value = draft ?? latest?.weight_kg ?? FALLBACK_KG;

  const draftRef = useRef<number | null>(null);
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
      if (draftRef.current === payload.weight_kg) { draftRef.current = null; setDraft(null); writePending(null); }
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

  function change(next: number) {
    const clamped = Math.min(400, Math.max(20, round1(next)));
    if (clamped === currentValue()) return;
    draftRef.current = clamped;
    setDraft(clamped);
    setStatus('dirty');
    setChangeCount((count) => count + 1);
    writePending({ date: berlinToday(), weight_kg: clamped });
    schedule();
  }

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

  const hint = (() => {
    if (status === 'saving') return <><Loader2 size={11} className="animate-spin" />Speichert…</>;
    if (status === 'error') return <span style={{ color: '#fca5a5' }}>Nicht gespeichert · neuer Versuch folgt</span>;
    if (status === 'dirty') return <>Speichert automatisch</>;
    if (status === 'saved' || savedToday) return <><Check size={11} style={{ color: '#4ade80' }} />Heute gespeichert</>;
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
        {/* Countdown to the automatic save; restarts with every change. */}
        {status === 'dirty' && <span key={changeCount} className="weight-countdown absolute bottom-0 left-0 h-[2px]" style={{ background: SAND, animationDuration: `${AUTOSAVE_MS}ms` }} aria-hidden="true" />}
      </div>
    </section>
  );
}
