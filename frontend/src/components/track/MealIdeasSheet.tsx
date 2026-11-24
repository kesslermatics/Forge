import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import { createTrackEntry, getMealIdeas, type MealIdea, type TrackEntry } from '../../api/api';
import { haptic } from '../navigation';
import { MacroPills } from './shared';
import { BORDER, DIM, FAINT, SAND, TEXT, fmt, fmtAmount } from './trackUtils';

interface Props {
  date: string;
  slotId: string | null;
  slotName: string;
  /** What is left of the day before the ideas load (from the page's live totals). */
  remainingKcal: number | null;
  remainingProtein: number | null;
  onTracked: (entry: TrackEntry) => void;
  onClose: () => void;
}

const PLACEHOLDER = 'Optional: worauf hast du Lust? z. B. „Müsli mit dem griechischen Joghurt“';
const errorText = (caught: unknown, fallback: string) => caught instanceof Error ? caught.message : fallback;

/** "Was passt noch?": the AI proposes three meals from the user's own foods, sized to the remaining budget. */
export default function MealIdeasSheet({ date, slotId, slotName, remainingKcal, remainingProtein, onTracked, onClose }: Props) {
  const [wish, setWish] = useState('');
  const [ideas, setIdeas] = useState<MealIdea[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<number | null>(null);
  const [trackedIndex, setTrackedIndex] = useState<number | null>(null);
  const request = useRef(0);
  const closed = useRef(false);
  useEffect(() => { closed.current = false; return () => { closed.current = true; }; }, []);

  const load = async () => {
    const id = ++request.current;
    haptic('tap');
    setLoading(true); setError(null); setIdeas(null); setTrackedIndex(null);
    try {
      const result = await getMealIdeas({ date, slot_id: slotId, wish: wish.trim() || undefined });
      if (id === request.current) setIdeas(result.ideas);
    } catch (caught: unknown) {
      if (id === request.current) setError(errorText(caught, 'Die Vorschläge konnten nicht geladen werden.'));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };

  const track = async (index: number) => {
    const idea = ideas?.[index];
    if (!idea || tracking !== null) return;
    setTracking(index); setError(null);
    let done = 0;
    try {
      for (const item of idea.items) {
        const entry = await createTrackEntry({ date, slot_id: slotId, source: item.source, source_id: item.source_id, amount: item.amount });
        onTracked(entry);
        done += 1;
      }
      haptic('success');
      setTrackedIndex(index);
      window.setTimeout(() => { if (!closed.current) onClose(); }, 650);
    } catch (caught: unknown) {
      haptic('warning');
      setError(`${errorText(caught, 'Tracken fehlgeschlagen.')}${done ? ` (${done} von ${idea.items.length} getrackt)` : ''}`);
    } finally {
      setTracking(null);
    }
  };

  const budgetLine = remainingKcal == null ? null
    : remainingKcal > 0 ? `Noch ${fmt(remainingKcal)} kcal${remainingProtein != null && remainingProtein > 0 ? ` · ${fmt(remainingProtein)} g Protein` : ''} offen`
      : `Budget schon um ${fmt(-remainingKcal)} kcal überschritten`;

  return <ForgeSheet label="Was passt noch?" onClose={onClose}>
    <div className="space-y-4 p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}><Sparkles size={12} />{slotName}</p>
          <h2 className="mt-1 text-[20px] font-semibold leading-tight" style={{ color: TEXT }}>Was passt noch?</h2>
          {budgetLine && <p className="mt-1 text-[12px] tabular-nums" style={{ color: DIM }}>{budgetLine}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM }}><X size={17} /></button>
      </div>

      <div>
        <textarea
          value={wish}
          onChange={(event) => setWish(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!loading) void load(); } }}
          maxLength={300}
          rows={2}
          placeholder={PLACEHOLDER}
          className="input-forge min-h-[60px] resize-none text-[14px] leading-relaxed"
        />
        <button type="button" onClick={() => void load()} disabled={loading || tracking !== null}
          className="btn-forge mt-2 flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-60">
          {loading ? <Loader2 size={16} className="animate-spin" /> : ideas ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {loading ? 'Coach stellt zusammen…' : ideas ? 'Neue Vorschläge' : 'Vorschläge holen'}
        </button>
      </div>

      {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

      {loading && <div className="space-y-2.5" aria-label="Vorschläge werden erstellt">
        {[0, 1, 2].map((item) => <div key={item} className="forge-skeleton h-[136px] rounded-2xl" />)}
      </div>}

      {ideas && !loading && <div className="space-y-2.5">
        {ideas.map((idea, index) => {
          const tracked = trackedIndex === index;
          const busy = tracking === index;
          const after = remainingKcal == null ? null : remainingKcal - idea.totals.kcal;
          return <article key={`${idea.title}-${index}`} className="forge-msg-in rounded-2xl p-3.5" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${tracked ? `${SAND}88` : BORDER}` }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold leading-snug" style={{ color: TEXT }}>{idea.title}</h3>
                {idea.reason && <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: DIM }}>{idea.reason}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[17px] font-semibold leading-none tabular-nums" style={{ color: TEXT }}>≈ {fmt(idea.totals.kcal)}</p>
                <p className="mt-1 text-[10px]" style={{ color: DIM }}>kcal</p>
              </div>
            </div>
            <ul className="mt-2.5 space-y-1">
              {idea.items.map((item) => <li key={`${item.source}-${item.source_id}`} className="flex items-baseline gap-2 text-[13px]">
                <span className="w-[64px] shrink-0 text-right font-semibold tabular-nums" style={{ color: SAND }}>{fmtAmount(item.amount)} {item.unit}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: TEXT }}>{item.name}{item.brand && <span style={{ color: FAINT }}> · {item.brand}</span>}</span>
                <span className="shrink-0 text-[11px] tabular-nums" style={{ color: DIM }}>{fmt(item.kcal)}</span>
              </li>)}
            </ul>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <MacroPills totals={idea.totals} compact />
              {after != null && <span className="text-[10.5px] tabular-nums" style={{ color: after < 0 ? '#fca5a5' : FAINT }}>{after < 0 ? `${fmt(-after)} kcal drüber` : `danach ${fmt(after)} kcal offen`}</span>}
            </div>
            <button type="button" onClick={() => void track(index)} disabled={tracking !== null || trackedIndex !== null}
              className="tap mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold disabled:opacity-60"
              style={tracked ? { color: '#16130f', background: SAND } : { color: SAND, border: `1px solid ${SAND}55` }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {tracked ? 'Getrackt' : busy ? 'Wird getrackt…' : 'So tracken'}
            </button>
          </article>;
        })}
        <p className="text-center text-[10.5px]" style={{ color: FAINT }}>Mengen sind eine grobe Schätzung · nach dem Tracken einzeln anpassbar</p>
      </div>}

      {!ideas && !loading && !error && <p className="text-[11.5px] leading-relaxed" style={{ color: FAINT }}>
        Der Coach kennt deine üblichen Kombinationen für {slotName} und was du die letzten Tage gegessen hast, und passt die Mengen an dein Restbudget an.
      </p>}
    </div>
  </ForgeSheet>;
}
