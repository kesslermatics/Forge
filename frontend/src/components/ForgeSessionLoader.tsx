import { useEffect, useState } from 'react';
import { Check, Dumbbell, Loader2, Sparkles } from 'lucide-react';
import { COACHING_STEPS } from './forgeSession/coachingProgress';
import type { CoachingProgress } from './forgeSession/coachingProgress';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.54)';
const FAINT = 'rgba(242,236,226,0.3)';

const STEPS = ['Historie einordnen', 'Übungsziele prüfen', 'Coaching zusammenstellen'];

const seconds = (from: number | undefined, now: number) => (from ? Math.max(0, Math.round((now - from) / 1000)) : 0);

function AiDetail({ progress, now }: { progress: CoachingProgress; now: number }) {
  const ai = progress.ai;
  const step = progress.steps.ai;
  if (step.status !== 'active') return null;
  const retry = progress.retries > 0 ? ` · Versuch ${progress.retries + 1}` : '';
  if (!ai || ai.phase === 'thinking') {
    return <p className="mt-0.5 text-[11.5px] tabular-nums" style={{ color: DIM }}>denkt nach · {seconds(step.startedAt, now)} s{retry}</p>;
  }
  const total = ai.totalExercises + ai.totalSets;
  const done = ai.doneExercises + ai.doneSets;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return <div className="mt-1.5">
    <p className="text-[11.5px] tabular-nums" style={{ color: DIM }}>
      schreibt · {ai.doneExercises}/{ai.totalExercises} Übungen · {ai.doneSets}/{ai.totalSets} Sätze{retry}
    </p>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,247,235,0.08)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Fortschritt der KI">
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: SAND, transition: 'width 0.35s ease-out' }} />
    </div>
  </div>;
}

export default function ForgeSessionLoader({ preparing, progress }: { preparing: boolean; progress?: CoachingProgress | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!preparing || !progress) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [preparing, progress]);

  if (preparing && progress) {
    return <main className="card-forge forge-loader" role="status" aria-live="polite" aria-label="Forge erstellt dein Coaching" style={{ borderColor: `${SAND}2c` }}>
      <div className="forge-loader-spinner" aria-hidden="true"><span /><Dumbbell size={22} /></div>
      <p className="forge-loader-tag"><Sparkles size={12} />Forge Coach</p>
      <h1 className="mt-2 text-[20px] font-semibold tracking-tight" style={{ color: TEXT }}>Deine Session wird vorbereitet</h1>
      <p className="mt-1 text-[12px] tabular-nums" style={{ color: DIM }}>{seconds(progress.startedAt, now)} s</p>
      <ol className="mt-5 w-full max-w-xs space-y-3 text-left">
        {COACHING_STEPS.map((step) => {
          const state = progress.steps[step.id];
          return <li key={step.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{
              background: state.status === 'done' ? SAND : 'transparent',
              border: state.status === 'done' ? 'none' : `1.5px solid ${state.status === 'active' ? SAND : 'rgba(255,247,235,0.18)'}`,
              color: '#16130f',
            }}>
              {state.status === 'done' ? <Check size={12} strokeWidth={3} /> : state.status === 'active' ? <Loader2 size={11} className="animate-spin" style={{ color: SAND }} /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium" style={{ color: state.status === 'pending' ? FAINT : TEXT }}>{step.label}</p>
              {state.status === 'done' && state.detail && <p className="mt-0.5 text-[11.5px]" style={{ color: DIM }}>{state.detail}</p>}
              {step.id === 'ai' && <AiDetail progress={progress} now={now} />}
            </div>
          </li>;
        })}
      </ol>
    </main>;
  }

  return <main className="card-forge forge-loader" role="status" aria-live="polite" aria-label={preparing ? 'Forge erstellt dein Coaching' : 'Forge lädt deine Session'} style={{ borderColor: `${SAND}2c` }}>
    <div className="forge-loader-spinner" aria-hidden="true"><span /><Dumbbell size={22} /></div>
    <p className="forge-loader-tag"><Sparkles size={12} />Forge Coach</p>
    <h1 className="mt-2 text-[20px] font-semibold tracking-tight" style={{ color: TEXT }}>{preparing ? 'Deine Session wird vorbereitet' : 'Session wird geladen'}</h1>
    <p className="mt-2 max-w-72 text-[12.5px] leading-relaxed" style={{ color: DIM }}>{preparing ? 'Forge verbindet deine echten Ergebnisse mit den heutigen Satz-Zielen.' : 'Dein Trainings-Snapshot wird sicher geladen.'}</p>
    {preparing && <ul className="forge-loader-steps" aria-hidden="true">{STEPS.map((step, index) => <li key={step} style={{ animationDelay: `${index * 0.9}s` }}>{step}</li>)}</ul>}
  </main>;
}
