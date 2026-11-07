import { Check } from 'lucide-react';
import type { ForgeSession } from '../../api/api';
import { BORDER, DIM, SAND, TEXT, formatClock } from './shared';

interface Props {
  session: ForgeSession;
  onDone: () => void;
}

export default function CompletionSummary({ session, onDone }: Props) {
  const sets = session.exercises.flatMap((exercise) => exercise.sets);
  const completed = sets.filter((set) => set.completed).length;
  const volume = Math.round(session.exercises.flatMap((exercise) => exercise.sets)
    .filter((set) => set.completed && set.set_type === 'working')
    .reduce((sum, set) => sum + (set.actual_weight_kg ?? 0) * (set.actual_reps ?? 0), 0));

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

    <button type="button" onClick={onDone} className="btn-forge h-12 w-full text-[14px]">Zum Dashboard</button>
  </section>;
}
