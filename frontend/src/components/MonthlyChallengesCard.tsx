import { useEffect, useState } from 'react';
import { CalendarCheck, Check, ClipboardCheck, Dumbbell, Scale, Sparkles, Target, Utensils } from 'lucide-react';
import { getCurrentMonthlyChallenges } from '../api/api';
import type { MonthlyChallenge, MonthlyChallengeCycle } from '../api/api';

const SAND = '#e8c58a';
const GREEN = '#34d399';
const DIM = 'rgba(242,236,226,0.45)';
const TEXT = '#f2ece0';
const ICONS = { CalendarCheck, ClipboardCheck, Dumbbell, Scale, Utensils, Target } as const;

function categoryLabel(category: MonthlyChallenge['category']) { return ({ consistency: 'Training', strength: 'Kraft', weight: 'Gewicht', nutrition: 'Ernährung', quality: 'Qualität' } as const)[category]; }
function ChallengeIcon({ name, color }: { name: string; color: string }) { const Icon = ICONS[name as keyof typeof ICONS] ?? Target; return <Icon size={15} style={{ color }} />; }
function value(challenge: MonthlyChallenge, number: number) { return challenge.unit === 'kg' ? `${number.toFixed(1)} kg` : `${Math.round(number)} ${challenge.unit}`; }

function CompactChallenge({ challenge }: { challenge: MonthlyChallenge }) {
  const complete = challenge.status === 'completed'; const accent = complete ? GREEN : SAND;
  return <article className={`rounded-2xl px-3 py-3 ${challenge.slot === 5 ? 'col-span-2' : ''}`} style={{ background: complete ? 'rgba(52,211,153,0.09)' : 'rgba(255,247,235,0.035)', border: `1px solid ${complete ? 'rgba(52,211,153,0.34)' : 'rgba(232,197,138,0.12)'}` }}><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex items-center gap-2"><div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center" style={{ background: complete ? 'rgba(52,211,153,0.14)' : 'rgba(232,197,138,0.10)' }}>{complete ? <Check size={15} strokeWidth={3} style={{ color: GREEN }} /> : <ChallengeIcon name={challenge.icon} color={accent} />}</div><div className="min-w-0"><p className="text-[9px] uppercase tracking-[0.13em]" style={{ color: accent }}>{complete ? 'Geschafft' : categoryLabel(challenge.category)}</p><p className="text-[11px] font-medium leading-snug mt-0.5 line-clamp-2" style={{ color: TEXT }}>{challenge.title}</p></div></div><span className="text-[11px] shrink-0 font-semibold tabular-nums" style={{ color: accent }}>{Math.round(challenge.progress_percent)}%</span></div><div className="flex items-center justify-between gap-2 mt-2 text-[10px] tabular-nums" style={{ color: DIM }}><span>{value(challenge, challenge.current_value)}</span><span>{value(challenge, challenge.target_value)}</span></div><div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: 'rgba(255,247,235,0.08)' }}><div className="h-full rounded-full" style={{ width: `${challenge.progress_percent}%`, background: accent, transition: 'width 0.8s cubic-bezier(0.22,1,0.36,1)' }} /></div></article>;
}

export default function MonthlyChallengesCard() {
  const [cycle, setCycle] = useState<MonthlyChallengeCycle | null>(null);
  useEffect(() => { getCurrentMonthlyChallenges().then(setCycle).catch(() => { }); }, []);
  if (!cycle || cycle.challenges.length === 0) return null;
  const month = new Date(`${cycle.month_start}T12:00:00`).toLocaleDateString('de-DE', { month: 'long' });
  const checkin = cycle.today_checkin ?? cycle.latest_checkin;
  const checkinDate = cycle.today_checkin_date ?? cycle.latest_checkin_date;
  const isToday = Boolean(cycle.today_checkin);
  return <section className="card-forge p-3.5 forge-anim forge-d2" style={{ borderColor: 'rgba(232,197,138,0.22)' }}><div className="flex items-center justify-between gap-3 mb-3"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(232,197,138,0.1)' }}><Target size={16} style={{ color: SAND }} /></div><div><p className="text-[9px] uppercase tracking-[0.15em]" style={{ color: SAND }}>Monatsfokus · {month}</p><p className="text-[13px] font-semibold mt-0.5" style={{ color: TEXT }}>{cycle.completed_challenges}/{cycle.total_challenges} geschafft</p></div></div><span className="rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums" style={{ color: cycle.completion_percent === 100 ? GREEN : SAND, background: cycle.completion_percent === 100 ? 'rgba(52,211,153,0.12)' : 'rgba(232,197,138,0.1)' }}>{Math.round(cycle.completion_percent)}%</span></div><div className="grid grid-cols-2 gap-2">{cycle.challenges.map((challenge) => <CompactChallenge key={challenge.id} challenge={challenge} />)}</div><aside className="mt-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(232,197,138,0.055)', border: '1px solid rgba(232,197,138,0.11)' }}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: SAND }}><Sparkles size={12} />Daily Check-in</span><span className="text-[10px]" style={{ color: DIM }}>{isToday ? 'Heute' : checkinDate ? `Stand ${new Date(`${checkinDate}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}` : 'In Einstellungen erstellen'}</span></div>{checkin ? <><p className="text-[12px] font-medium mt-1.5" style={{ color: TEXT }}>{checkin.headline}</p><p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'rgba(242,236,226,0.68)' }}>{checkin.message}</p></> : <p className="text-[11px] mt-1.5" style={{ color: DIM }}>Erstelle den ersten Daily Check-in unter Einstellungen → Monats-Challenges.</p>}</aside></section>;
}
