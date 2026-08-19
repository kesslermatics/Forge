import { useState } from 'react';
import { Flame, Dumbbell, Clock, ChevronDown, Sparkles, Utensils } from 'lucide-react';
import {
    mockUser, mockWeather, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, ringMath, greeting, dateLabel } from '../helpers';

export default function V2Apex() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const ring = ringMath(46, caloriesPct);
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 300, 70, 6);

    return (
        <div className="relative min-h-full text-white font-sans px-4 pt-8 pb-24 overflow-hidden"
            style={{ background: 'radial-gradient(130% 90% at 50% -10%, #191a2e 0%, #0b0c14 55%, #08080d 100%)' }}>
            {/* soft glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full pointer-events-none"
                style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.28), transparent 70%)', filter: 'blur(30px)' }} />

            {/* Header */}
            <header className="relative pv-anim flex items-center justify-between">
                <div>
                    <p className="text-[13px] text-indigo-200/50">{greeting()}</p>
                    <h1 className="text-[26px] font-semibold tracking-tight mt-0.5">{mockUser.firstName}</h1>
                </div>
                <div className="text-right text-[12px] text-white/45">
                    <div>{mockWeather.emoji} {mockWeather.temperature_c}°C</div>
                    <div className="mt-0.5">{dateLabel()}</div>
                </div>
            </header>

            {/* Nutrition glass card */}
            <section className="relative pv-anim pv-d1 mt-6">
                <GlassCard>
                    <div className="flex items-center gap-5">
                        <div className="relative shrink-0" style={{ width: 108, height: 108 }}>
                            <svg width="108" height="108" className="-rotate-90">
                                <defs>
                                    <linearGradient id="apexRing" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0%" stopColor="#818cf8" />
                                        <stop offset="100%" stopColor="#c084fc" />
                                    </linearGradient>
                                </defs>
                                <circle cx="54" cy="54" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
                                <circle cx="54" cy="54" r="46" fill="none" stroke="url(#apexRing)" strokeWidth="7" strokeLinecap="round"
                                    strokeDasharray={ring.c} className="pv-ring-anim"
                                    style={{ ['--pv-ring-start' as string]: `${ring.c}`, ['--pv-ring-end' as string]: `${ring.offset}` }} />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <Flame size={14} className="text-indigo-300 mb-0.5" />
                                <span className="text-[22px] font-semibold leading-none tabular-nums">{Math.round(mockNutrition.totals.calories)}</span>
                                <span className="text-[10px] text-white/40 mt-0.5">kcal</span>
                            </div>
                        </div>
                        <div className="flex-1 space-y-2.5">
                            <p className="text-[13px] text-white/60 leading-snug mb-1">
                                <span className="text-white font-semibold">{Math.round(caloriesRemaining)}</span> kcal übrig
                            </p>
                            {macros.map(m => {
                                const pct = Math.min(m.current / m.goal, 1);
                                return (
                                    <div key={m.key}>
                                        <div className="flex justify-between text-[11px] mb-1">
                                            <span className="text-white/50">{m.label}</span>
                                            <span className="text-white/70 tabular-nums">{Math.round(m.current)}/{m.goal}{m.unit}</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                            <div className="h-full rounded-full pv-bar-anim"
                                                style={{ background: m.accent, ['--pv-bar-w' as string]: `${pct * 100}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </GlassCard>
            </section>

            {/* Streaks trio */}
            <section className="relative pv-anim pv-d2 mt-4 grid grid-cols-3 gap-3">
                <StreakChip label="Training" value={mockStreaks.training.current} unit="Wo" c="#818cf8" />
                <StreakChip label="Ernährung" value={mockStreaks.nutrition.current} unit="Tg" c="#c084fc" />
                <StreakChip label="Combo" value={mockStreaks.combined.current} unit="Tg" c="#5eead4" />
            </section>

            {/* Weight glass */}
            <section className="relative pv-anim pv-d3 mt-4">
                <GlassCard>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] text-white/50">Gewicht</span>
                        <div className="text-right">
                            <span className="text-[20px] font-semibold tabular-nums">{weightCurrent.toFixed(1)}</span>
                            <span className="text-[12px] text-white/40 ml-1">kg</span>
                            <span className={`ml-2 text-[12px] ${weightDelta < 0 ? 'text-teal-300' : 'text-white/40'}`}>
                                {weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)}
                            </span>
                        </div>
                    </div>
                    <svg viewBox="0 0 300 70" className="w-full h-12">
                        <defs>
                            <linearGradient id="apexArea" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="rgba(129,140,248,0.35)" />
                                <stop offset="100%" stopColor="rgba(129,140,248,0)" />
                            </linearGradient>
                        </defs>
                        <path d={spark.area} fill="url(#apexArea)" />
                        <path d={spark.line} fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </GlassCard>
            </section>

            {/* HERO */}
            <section className="relative pv-anim pv-d4 mt-6">
                <div className="flex items-center gap-2 mb-3 px-1">
                    <Sparkles size={14} className="text-indigo-300" />
                    <span className="text-[13px] font-medium text-white/70">Dein Trainingsplan für heute</span>
                </div>
                <button onClick={() => setOpen(o => !o)} className="pv-tap w-full text-left">
                    <div className="relative rounded-[28px] p-6 overflow-hidden"
                        style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 20px 50px -12px rgba(124,58,237,0.5)' }}>
                        <div className="absolute inset-0 opacity-40"
                            style={{ background: 'radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,0.35), transparent 55%)' }} />
                        <div className="relative">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] uppercase tracking-widest text-white/70">Push · Oberkörper</span>
                                <span className="rounded-full bg-white/20 backdrop-blur px-2.5 py-1 text-[11px] font-medium flex items-center gap-1">
                                    <Clock size={11} /> {mockGamePlan.est_duration_min} min
                                </span>
                            </div>
                            <h2 className="text-[28px] font-bold mt-2 leading-none">{mockGamePlan.workout_title}</h2>
                            <p className="text-[13px] text-white/80 mt-2">{mockGamePlan.focus}</p>
                            <div className="flex items-center gap-1.5 mt-5 text-[13px] font-medium text-white">
                                {open ? 'Zuklappen' : 'Kompletten Plan ansehen'}
                                <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                            </div>
                        </div>
                    </div>
                </button>

                {open && (
                    <div className="mt-3 space-y-3 pv-anim-in">
                        <GlassCard>
                            <div className="flex gap-3">
                                <Utensils size={16} className="text-indigo-300 shrink-0 mt-0.5" />
                                <p className="text-[13px] text-white/70 leading-relaxed">{mockGamePlan.nutrition_context}</p>
                            </div>
                        </GlassCard>

                        {mockGamePlan.exercise_targets.map((ex, i) => {
                            const meta = progressionMeta[ex.progression_status];
                            return (
                                <GlassCard key={i}>
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center shrink-0">
                                                <Dumbbell size={15} className="text-indigo-200" />
                                            </div>
                                            <div>
                                                <h3 className="text-[15px] font-semibold leading-tight">{ex.name}</h3>
                                                <p className="text-[11px] text-white/40">{ex.muscle} · zuletzt {ex.last_time}</p>
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1"
                                            style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        {ex.set_targets.map(s => (
                                            <div key={s.set_number} className="rounded-xl bg-white/[0.06] border border-white/8 p-2 text-center">
                                                <div className="text-[9px] text-white/35">S{s.set_number}</div>
                                                <div className="text-[14px] font-semibold tabular-nums">{s.weight_kg}</div>
                                                <div className="text-[10px] text-white/45">×{s.reps}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[12.5px] text-white/55 leading-relaxed mt-3">{ex.reasoning}</p>
                                </GlassCard>
                            );
                        })}

                        <div className="rounded-2xl p-4 border border-indigo-400/25"
                            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.1))' }}>
                            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-indigo-300 mb-1.5">
                                <Sparkles size={12} /> Coach-Fokus
                            </div>
                            <p className="text-[13px] text-white/75 leading-relaxed">{mockGamePlan.general_advice}</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function GlassCard({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-3xl p-4 border border-white/10"
            style={{ background: 'rgba(255,255,255,0.045)', backdropFilter: 'blur(16px)', boxShadow: '0 8px 30px -12px rgba(0,0,0,0.6)' }}>
            {children}
        </div>
    );
}

function StreakChip({ label, value, unit, c }: { label: string; value: number; unit: string; c: string }) {
    return (
        <div className="rounded-2xl p-3 border border-white/10 text-center"
            style={{ background: 'rgba(255,255,255,0.045)', backdropFilter: 'blur(16px)' }}>
            <div className="text-[22px] font-bold tabular-nums leading-none" style={{ color: c }}>{value}</div>
            <div className="text-[10px] text-white/40 mt-1">{label}</div>
            <div className="text-[9px] text-white/25">{unit}</div>
        </div>
    );
}
