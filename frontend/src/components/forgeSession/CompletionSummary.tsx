import { Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { ForgeSession, ForgeSessionCompletionReview } from '../../api/api';
import { BORDER, DIM, MINT, SAND, TEXT, formatClock } from './shared';

const VERDICT: Record<ForgeSessionCompletionReview['verdict'], { label: string; color: string }> = {
  strong: { label: 'Starke Einheit', color: MINT },
  solid: { label: 'Solide Einheit', color: SAND },
  mixed: { label: 'Gemischte Einheit', color: '#f4b46a' },
  tough: { label: 'Zäher Tag', color: '#f87171' },
};

interface Props {
  session: ForgeSession;
  reviewing: boolean;
  reviewError: string | null;
  onRetry: () => void;
  onDone: () => void;
}

export default function CompletionSummary({ session, reviewing, reviewError, onRetry, onDone }: Props) {
  const sets = session.exercises.flatMap((exercise) => exercise.sets);
  const completed = sets.filter((set) => set.completed).length;
  const volume = Math.round(session.exercises.flatMap((exercise) => exercise.sets)
    .filter((set) => set.completed && set.set_type === 'working')
    .reduce((sum, set) => sum + (set.actual_weight_kg ?? 0) * (set.actual_reps ?? 0), 0));
  const review = session.completion_review;
  const verdict = review ? VERDICT[review.verdict] ?? VERDICT.solid : null;

  return <section className="forge-session-complete space-y-4">
    <div className="card-forge p-5 text-center" style={{ borderColor: `${SAND}44`, background: 'linear-gradient(160deg, rgba(232,197,138,0.12), rgba(232,197,138,0.03))' }}>
      <div className="forge-completion-mark forge-completion-bloom mx-auto"><Check size={24} /></div>
      <h2 className="mt-4 text-[22px] font-semibold tracking-tight" style={{ color: TEXT }}>Training abgeschlossen</h2>
      <p className="mt-1 text-[13px]" style={{ color: DIM }}>{session.name}</p>
      <dl className="mt-5 grid grid-cols-3 gap-2">
        {[
          ['Dauer', formatClock(session.started_at, session.completed_at ?? session.started_at, 0)],
          ['Sätze', `${completed}/${sets.length}`],
          ['Volumen', `${volume.toLocaleString('de-DE')} kg`],
        ].map(([label, value]) => <div key={label} className="rounded-2xl px-2 py-3" style={{ background: 'rgba(22,19,15,0.45)', border: `1px solid ${BORDER}` }}>
          <dt className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>{label}</dt>
          <dd className="mt-1 text-[16px] font-semibold tabular-nums" style={{ color: TEXT }}>{value}</dd>
        </div>)}
      </dl>
    </div>

    <div className="card-forge p-5" style={{ borderColor: `${SAND}33` }} aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="forge-coach-spark"><Sparkles size={15} /></span>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND }}>Coach-Fazit</p>
        {verdict && <span className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ color: verdict.color, background: 'rgba(255,247,235,0.05)', border: `1px solid ${verdict.color}55` }}>{verdict.label}</span>}
      </div>
      {review ? <div className="forge-coach-detail mt-3">
        <h3 className="text-[17px] font-semibold leading-snug" style={{ color: TEXT }}>{review.headline}</h3>
        <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.82)' }}>{review.review}</p>
      </div> : reviewing ? <div className="mt-4 space-y-2" aria-label="Fazit wird geschrieben">
        <div className="forge-skeleton h-4 w-2/3 rounded" />
        <div className="forge-skeleton h-3 w-full rounded" />
        <div className="forge-skeleton h-3 w-11/12 rounded" />
        <div className="forge-skeleton h-3 w-4/5 rounded" />
        <p className="flex items-center gap-2 pt-1 text-[11px]" style={{ color: DIM }}><Loader2 size={12} className="animate-spin" />Dein Coach schaut sich die Einheit an…</p>
      </div> : <div className="mt-3">
        <p className="text-[13px]" style={{ color: DIM }}>{reviewError ?? 'Noch kein Fazit vorhanden.'}</p>
        <button type="button" onClick={onRetry} className="tap mt-3 flex h-11 items-center gap-2 rounded-xl px-4 text-[13px] font-medium" style={{ color: SAND, border: `1px solid ${SAND}44` }}><RotateCcw size={15} />Fazit erstellen</button>
      </div>}
    </div>

    <button type="button" onClick={onDone} className="btn-forge h-12 w-full text-[14px]">Zum Dashboard</button>
  </section>;
}
