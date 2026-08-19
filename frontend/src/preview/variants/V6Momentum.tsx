import { useState } from 'react';
import { Flame, ChevronUp, Waves, Dumbbell, Activity } from 'lucide-react';
import {
    mockUser, mockWeather, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, ringMath, greeting } from '../helpers';

const TEAL = '#5eead4';

export default function V6Momentum() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const ring = ringMath(40, caloriesPct);
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 300, 60, 6);

    return (
        <div className="relative min-h-full text-white font-sans overflow-hidden" style={{ background: '#04070a' }}>
            {/* Aurora background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="pv-aurora-blob" style={{ width: 300, height: 300, top: -60, left: -40, background: '#0e7490' }} />
                <div className="pv-aurora-blob" style={{ width: 260, height: 260, top: 120, right: -60, background: '#5b21b6', animationDelay: '-6s' }} />
                <div className="pv-aurora-blob" style={{ width: 240, height: 240, bottom: 40, left: -30, background: '#0f766e', animationDelay: '-12s' }} />
            </div>

            <div className="relative px-4 pt-9 pb-24">
                {/* Header */}
                <header className="pv-anim flex items-center justify-between">
                    <div>
                        <p className="text-[13px] text-white/50">{greeting()}</p>
                        <h1 className="text-[27px] font-semibold tracking-tight">{mockUser.firstName}</h1>
                    </div>
                    <div className="rounded-full px-3 py-1.5 text-[12px] flex items-center gap-1.5"
                        style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {mockWeather.emoji} {mockWeather.temperature_c}°
                    </div>
                </header>

                {/* Nutrition floating glass */}
                <section className="pv-anim pv-d1 mt-6">
                    <Floating>
                        <div className="flex items-center gap-5">
                            <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
                                <svg width="96" height="96" className="-rotate-90">
                                    <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
                                    <circle cx="48" cy="48" r="40" fill="none" stroke={TEAL} strokeWidth="6" strokeLinecap="round"
                                        strokeDasharray={ring.c} className="pv-ring-anim"
                                        style={{ filter: `drop-shadow(0 0 6px ${TEAL})`, ['--pv-ring-start' as string]: `${ring.c}`, ['--pv-ring-end' as string]: `${ring.offset}` }} />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <Flame size={13} style={{ color: TEAL }} />
                                    <span className="text-[19px] font-semibold tabular-nums leading-none mt-0.5">{Math.round(mockNutrition.totals.calories)}</span>
                                </div>
                            </div>
                            <div className="flex-1 space-y-2">
                                <p className="text-[12px] text-white/60"><span className="text-white font-semibold">{Math.round(caloriesRemaining)}</span> kcal übrig</p>
                                {macros.map(m => {
                                    const pct = Math.min(m.current / m.goal, 1);
                                    return (
                                        <div key={m.key} className="flex items-center gap-2">
                                            <span className="text-[10px] text-white/45 w-12">{m.label}</span>
                                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                <div className="h-full rounded-full pv-bar-anim" style={{ background: m.accent, ['--pv-bar-w' as string]: `${pct * 100}%` }} />
                                            </div>
                                            <span className="text-[10px] tabular-nums text-white/55 w-8 text-right">{Math.round(pct * 100)}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </Floating>
                </section>

                {/* Metric pills */}
                <section className="pv-anim pv-d2 mt-4 grid grid-cols-3 gap-3">
                    <Floating tight>
                        <Activity size={14} style={{ color: TEAL }} />
                        <div className="text-[20px] font-bold tabular-nums leading-none mt-2">{mockStreaks.combined.current}</div>
                        <div className="text-[10px] text-white/45 mt-1">Tage Serie</div>
                    </Floating>
                    <Floating tight>
                        <Dumbbell size={14} className="text-indigo-300" />
                        <div className="text-[20px] font-bold tabular-nums leading-none mt-2">{mockStreaks.training.current}</div>
                        <div className="text-[10px] text-white/45 mt-1">Wo. Training</div>
                    </Floating>
                    <Floating tight>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-white/45">Gewicht</span>
                            <span className="text-[10px]" style={{ color: TEAL }}>{weightDelta.toFixed(1)}</span>
                        </div>
                        <div className="text-[18px] font-bold tabular-nums leading-none mt-1">{weightCurrent.toFixed(1)}</div>
                        <svg viewBox="0 0 300 60" className="w-full h-4 mt-1">
                            <path d={spark.line} fill="none" stroke={TEAL} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                        </svg>
                    </Floating>
                </section>

                {/* HERO */}
                <section className="pv-anim pv-d3 mt-6">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <Waves size={14} style={{ color: TEAL }} />
                        <span className="text-[13px] text-white/70 font-medium">Bereit für dein nächstes Training</span>
                    </div>

                    <button onClick={() => setOpen(o => !o)} className="pv-tap w-full text-left">
                        <div className="relative rounded-[30px] p-6 overflow-hidden"
                            style={{ background: 'linear-gradient(135deg, rgba(94,234,212,0.9), rgba(45,212,191,0.75))', boxShadow: '0 20px 55px -14px rgba(45,212,191,0.5)' }}>
                            <div className="absolute inset-0 opacity-50"
                                style={{ background: 'radial-gradient(110% 90% at 90% 10%, rgba(255,255,255,0.45), transparent 55%)' }} />
                            <div className="relative text-[#04211d]">
                                <p className="text-[11px] font-semibold uppercase tracking-widest opacity-70">{mockGamePlan.focus}</p>
                                <h2 className="text-[30px] font-bold leading-none mt-2">{mockGamePlan.workout_title}</h2>
                                <div className="flex items-center gap-2 mt-4 text-[12px] font-medium">
                                    <span className="rounded-full bg-black/10 px-3 py-1">{mockGamePlan.exercise_targets.length} Übungen</span>
                                    <span className="rounded-full bg-black/10 px-3 py-1">~{mockGamePlan.est_duration_min} min</span>
                                </div>
                            </div>
                            <div className="absolute right-6 bottom-6 text-[#04211d] flex items-center gap-1 font-semibold text-[13px]">
                                {open ? 'Schließen' : 'Öffnen'} <ChevronUp size={16} className={`transition-transform ${open ? '' : 'rotate-180'}`} />
                            </div>
                        </div>
                    </button>

                    {open && (
                        <div className="mt-3 space-y-3 pv-sheet">
                            <Floating>
                                <p className="text-[11px] uppercase tracking-widest mb-1.5" style={{ color: TEAL }}>Vor dem Training</p>
                                <p className="text-[13px] text-white/70 leading-relaxed">{mockGamePlan.nutrition_context}</p>
                            </Floating>

                            {mockGamePlan.exercise_targets.map((ex, i) => {
                                const meta = progressionMeta[ex.progression_status];
                                return (
                                    <Floating key={i}>
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            <div>
                                                <h3 className="text-[15px] font-semibold leading-tight">{ex.name}</h3>
                                                <p className="text-[11px] text-white/40 mt-0.5">{ex.muscle} · zuletzt {ex.last_time}</p>
                                            </div>
                                            <span className="shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1"
                                                style={{ color: meta.color, background: meta.bg }}>{meta.short}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            {ex.set_targets.map(s => (
                                                <div key={s.set_number} className="flex-1 rounded-2xl p-2.5 text-center"
                                                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <div className="text-[9px] text-white/35">Satz {s.set_number}</div>
                                                    <div className="text-[15px] font-bold tabular-nums mt-0.5">{s.weight_kg}</div>
                                                    <div className="text-[10px] text-white/45">{s.reps} Wdh.</div>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[12.5px] text-white/55 leading-relaxed mt-3">{ex.reasoning}</p>
                                    </Floating>
                                );
                            })}

                            <div className="rounded-3xl p-4" style={{ background: `${TEAL}14`, border: `1px solid ${TEAL}33` }}>
                                <p className="text-[11px] uppercase tracking-widest mb-1.5" style={{ color: TEAL }}>Coach-Fokus</p>
                                <p className="text-[13px] text-white/75 leading-relaxed">{mockGamePlan.general_advice}</p>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

function Floating({ children, tight }: { children: React.ReactNode; tight?: boolean }) {
    return (
        <div className={`rounded-3xl ${tight ? 'p-3' : 'p-4'}`}
            style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 40px -16px rgba(0,0,0,0.6)' }}>
            {children}
        </div>
    );
}
