import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, NotebookPen } from 'lucide-react';
import { getDayNote, saveDayNote } from '../api/api';
import { haptic } from './navigation';
import { berlinToday } from './track/trackUtils';

const SAND = '#e8c58a';
const DIM = 'rgba(242,236,226,0.5)';
const BORDER = 'rgba(232,197,138,0.12)';
const AUTOSAVE_MS = 1500;
const MAX_LENGTH = 2000;

type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Free-text note for today ("erkältet", "schlecht geschlafen", "Restaurant").
 * It is delivered with the day's nutrition and training, so the Coach can explain outliers.
 * Saves shortly after typing stops, and immediately (keepalive) when the app goes to the background.
 */
export default function DayNoteCard() {
  const day = berlinToday();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [loaded, setLoaded] = useState(false);

  const textRef = useRef('');
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef(0);
  const flushRef = useRef<(keepalive: boolean) => Promise<void>>(async () => undefined);

  async function flush(keepalive: boolean) {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
    if (!dirtyRef.current || savingRef.current) return;
    const sent = textRef.current;
    savingRef.current = true;
    if (!keepalive) setStatus('saving');
    try {
      await saveDayNote(day, sent, keepalive);
      if (textRef.current === sent) { dirtyRef.current = false; setStatus('saved'); if (!keepalive) haptic('success'); }
      else setStatus('dirty');
    } catch {
      setStatus(keepalive ? 'dirty' : 'error');
    } finally {
      savingRef.current = false;
    }
    if (dirtyRef.current && !keepalive && !timerRef.current) {
      timerRef.current = window.setTimeout(() => { timerRef.current = 0; void flushRef.current(false); }, AUTOSAVE_MS * 2);
    }
  }

  useEffect(() => { flushRef.current = flush; });

  useEffect(() => {
    let cancelled = false;
    getDayNote(day).then((data) => {
      if (cancelled || dirtyRef.current) return;
      textRef.current = data.text ?? '';
      setText(textRef.current);
    }).catch(() => undefined).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [day]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') void flushRef.current(true); };
    const onPageHide = () => void flushRef.current(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void flushRef.current(true);
    };
  }, []);

  const onChange = (value: string) => {
    const next = value.slice(0, MAX_LENGTH);
    textRef.current = next;
    dirtyRef.current = true;
    setText(next);
    setStatus('dirty');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = 0; void flushRef.current(false); }, AUTOSAVE_MS);
  };

  const hint = status === 'saving' ? <><Loader2 size={10} className="animate-spin" />Speichert…</>
    : status === 'error' ? <span style={{ color: '#fca5a5' }}>Nicht gespeichert · neuer Versuch folgt</span>
    : status === 'dirty' ? <>Speichert automatisch</>
    : status === 'saved' ? <><Check size={10} style={{ color: '#4ade80' }} />Gespeichert</>
    : <>Für Training und Ernährung von heute</>;

  return (
    <section className="forge-anim forge-d2" aria-label="Tagesnotiz">
      <div className="card-forge p-3.5" style={{ borderColor: status === 'dirty' ? `${SAND}44` : undefined }}>
        <div className="mb-2 flex items-center justify-between text-[11px]" style={{ color: DIM }}>
          <span className="flex items-center gap-1.5"><NotebookPen size={12} style={{ color: SAND }} />Tagesnotiz</span>
          <span className="flex items-center gap-1 text-[10.5px]" aria-live="polite">{hint}</span>
        </div>
        <textarea
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => void flushRef.current(false)}
          disabled={!loaded}
          rows={2}
          maxLength={MAX_LENGTH}
          placeholder="z. B. erkältet, schlecht geschlafen, Geburtstagsessen …"
          aria-label="Notiz für heute"
          className="input-forge w-full resize-none text-[13px] leading-relaxed"
          style={{ border: `1px solid ${BORDER}`, minHeight: 58 }}
        />
      </div>
    </section>
  );
}
