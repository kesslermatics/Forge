import { useEffect, useState } from 'react';
import {
  CalendarCheck, Check, ClipboardCheck, Dumbbell, Flame, Scale, Sparkles, Target, Utensils,
} from 'lucide-react';
import { getCurrentMonthlyChallenges } from '../api/api';
import type { MonthlyChallenge, MonthlyChallengeCycle } from '../api/api';

const SAND = '#e8c58a';
const GREEN = '#34d399';
const DIM = 'rgba(242,236,226,0.45)';
const TEXT = '#f2ece0';
const ICONS = { CalendarCheck, ClipboardCheck, Dumbbell, Scale, Utensils, Flame, Target } as const;

function ChallengeIcon({ name, completed }: { name: string; completed: boolean }) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? Target;
  return <Icon size={16} style={{ color: completed ? GREEN : SAND }} />;
}

function formatValue(challenge: MonthlyChallenge, value: number) {
  if (challenge.unit === 'kg') return `${value.toFixed(1)} kg`;
  return `${Math.round(value)} ${challenge.unit}`;
}

function ChallengeRow({ challenge }: { challenge: MonthlyChallenge }) {
  const completed = challenge.status === 'completed';
  const accent = completed ? GREEN : SAND;
  return (
    <article className="rounded-2xl p-3.5" style={{
      background: completed ? 'rgba(52,211,153,0.09)' : 'rgba(255,247,235,0.035)',
      border: `1px solid ${completed ? 'rgba(52,211,153,0.34)' : 'rgba(232,197,138,0.13)'}`,
    }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: completed ? 'rgba(52,211,153,0.13)' : 'rgba(232,197,138,0.1)' }}>
          {completed ? <Check size={16} strokeWidth={3} style={{ color: GREEN }} /> : <ChallengeIcon name={challenge.icon} completed={false} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: accent }}>{completed ? 'Geschafft' : categoryLabel(challenge.category)}</p><h3 className="text-[13px] font-medium leading-snug mt-0.5" style={{ color: TEXT }}>{challenge.title}</h3></div>
            <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: accent }}>{Math.round(challenge.progress_percent)}%</span>
          </div>
          <div className="flex justify-between gap-3 mt-2 text-[11px] tabular-nums" style={{ color: DIM }}><span>{formatValue(challenge, challenge.current_value)}</span><span>Ziel {formatValue(challenge, challenge.target_value)}</span></div>
          <div className="h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: 'rgba(255,247,235,0.09)' }}><div className="h-full rounded-full" style={{ width: `${challenge.progress_percent}%`, background: accent, transition: 'width 0.8s cubic-bezier(0.22,1,0.36,1)' }} /></div>
        </div>
      </div>
    </article>
  );
}

function categoryLabel(category: MonthlyChallenge['category']) {
  return ({ consistency: 'Training', strength: 'Leistung', weight: 'Gewicht', nutrition: 'Ernährung', quality: 'Trainingsqualität' } as const)[category];
}

export default function MonthlyChallengesCard() {
  const [cycle, setCycle] = useState<MonthlyChallengeCycle | null>(null);

  useEffect(() => { getCurrentMonthlyChallenges().then(setCycle).catch(() => {}); }, []);
  if (!cycle || cycle.challenges.length === 0) return null;

  const month = new Date(`${cycle.month_start}T12:00:00`).toLocaleDateString('de-DE', { month: 'long' });
  const checkin = cycle.latest_checkin;
  return <section className="card-forge p-4 forge-anim forge-d2" style={{ borderColor: 'rgba(232,197,138,0.24)' }}>
    <div className="flex items-start justify-between gap-3 mb-3"><div className="flex gap-2.5"><div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,197,138,0.11)', border: '1px solid rgba(232,197,138,0.18)' }}><Target size={17} style={{ color: SAND }} /></div><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Monatsfokus · {month}</p><h2 className="text-[16px] font-semibold mt-0.5" style={{ color: TEXT }}>{cycle.completed_challenges}/{cycle.total_challenges} Challenges geschafft</h2></div></div><span className="rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums" style={{ color: cycle.completion_percent === 100 ? GREEN : SAND, background: cycle.completion_percent === 100 ? 'rgba(52,211,153,0.12)' : 'rgba(232,197,138,0.1)' }}>{Math.round(cycle.completion_percent)}%</span></div>
    <div className="space-y-2.5">{cycle.challenges.map((challenge) => <ChallengeRow key={challenge.id} challenge={challenge} />)}</div>
    {checkin && <aside className="mt-3 rounded-xl p-3" style={{ background: 'rgba(232,197,138,0.06)', border: '1px solid rgba(232,197,138,0.12)' }}><div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: SAND }}><Sparkles size={13} />{checkin.headline}</div><p className="text-[12px] leading-relaxed mt-1.5" style={{ color: 'rgba(242,236,226,0.72)' }}>{checkin.message}</p><p className="text-[11px] mt-2" style={{ color: DIM }}>{checkin.next_step}</p></aside>}
  </section>;
}
