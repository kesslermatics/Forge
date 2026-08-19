import { useState } from 'react';
import { Flame, Zap, Dumbbell, ArrowRight, TrendingDown, Salad } from 'lucide-react';
import {
    mockUser, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, greeting } from '../helpers';

const ORANGE = '#ff6a3d';

export default function V3Pulse() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 200, 60, 4);

    return (
        <div className="min-h-full bg-[#0a0908] text-white font-sans px-4 pt-8 pb-24">
            {/* Header */}
            <header className="pv-anim flex items-end justify-between mb-5">
                <div>
                    <p className="text-[12px] text-white/40">{greeting()}</p>
                    <h1 className="text-[28px] font-extrabold tracking-tight leading-none mt-1">
                        {mockUser.firstName}
                    </h1>
                </div>
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
                    style={{ background: `${ORANGE}1f`, border: `1px solid ${ORANGE}44` }}>
                    <Zap size={13} style={{ color: ORANGE }} fill={ORANGE} />
                    <span className="text-[13px] font-bold" style={{ color: ORANGE }}>{mockStreaks.combined.current} Tage</span>
                </div>
            </header>

            {/* Bento grid */}
            <div className="grid grid-cols-2 gap-3">
                {/* Calories — big tile */}
                <div className="pv-anim pv-d1 col-span-2 rounded-3xl p-5 relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #1a1614, #0d0b0a)', border: '1px solid rgba(255,106,61,0.2)' }}>
                    <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full pointer-events-none"
                        style={{ background: `radial-gradient(circle, ${ORANGE}33, transparent 70%)` }} />
                    <div className="relative flex items-end justify-between">
                        <div>
                            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/45">
                                <Flame size={12} style={{ color: ORANGE }} /> Kalorien
                            </div>
                            <div className="mt-2 flex items-baseline gap-1">
                                <span className="text-[44px] font-extrabold leading-none tabular-nums">{Math.round(mockNutrition.totals.calories)}</span>
                                <span className="text-[15px] text-white/35 font-medium">/ {mockNutrition.goals.calories}</span>
                            </div>
                            <p className="text-[12px] text-white/45 mt-1">Noch {Math.round(caloriesRemaining)} kcal frei</p>
                        </div>
                    </div>
                    <div className="relative mt-4 h-2.5 rounded-full bg-white/8 overflow-hidden">
                        <div className="h-full rounded-full pv-bar-anim"
                            style={{ background: `linear-gradient(90deg, ${ORANGE}, #ffcc00)`, ['--pv-bar-w' as string]: `${Math.min(caloriesPct, 1) * 100}%` }} />
                    </div>
                </div>

                {/* Macro tiles */}
                {macros.map((m, i) => {
                    const pct = Math.round((m.current / m.goal) * 100);
                    return (
                        <div key={m.key} className={`pv-anim pv-d${2 + i} rounded-2xl p-4 bg-white/[0.03] border border-white/8`}>
                            <div className="text-[11px] text-white/45">{m.label}</div>
                            <div className="text-[24px] font-bold tabular-nums leading-none mt-1.5" style={{ color: m.accent }}>
                                {Math.round(m.current)}<span className="text-[12px] text-white/30 font-medium">g</span>
                            </div>
                            <div className="text-[10px] text-white/30 mt-1">{pct}% · Ziel {m.goal}g</div>
                        </div>
                    );
                })}

                {/* Weight tile */}
                <div className="pv-anim pv-d5 rounded-2xl p-4 bg-white/[0.03] border border-white/8 relative overflow-hidden">
                    <div className="flex items-center gap-1 text-[11px] text-white/45">
                        Gewicht <TrendingDown size={11} className="text-emerald-400" />
                    </div>
                    <div className="text-[24px] font-bold tabular-nums leading-none mt-1.5">
                        {weightCurrent.toFixed(1)}<span className="text-[12px] text-white/30 font-medium">kg</span>
                    </div>
                    <div className="text-[10px] text-emerald-400 mt-1">{weightDelta.toFixed(1)} kg</div>
                    <svg viewBox="0 0 200 60" className="absolute bottom-0 right-0 w-24 h-8 opacity-60">
                        <path d={spark.line} fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                </div>
            </div>

            {/* HERO */}
            <div className="pv-anim pv-d6 mt-6">
                <div className="flex items-center justify-between mb-3 px-1">
                    <span className="text-[13px] font-bold uppercase tracking-wider text-white/60">Heutiger Plan</span>
                    <span className="text-[11px] text-white/30">{mockGamePlan.exercise_targets.length} Übungen</span>
                </div>

                <button onClick={() => setOpen(o => !o)} className="pv-tap w-full text-left">
                    <div className="relative rounded-3xl p-6 overflow-hidden"
                        style={{ background: `linear-gradient(120deg, ${ORANGE}, #ff3d6a)` }}>
                        <div className="absolute inset-0 opacity-30 pv-shimmer"
                            style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%)' }} />
                        <div className="relative flex items-center justify-between">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">Los geht's</p>
                                <h2 className="text-[30px] font-extrabold leading-none mt-1.5">{mockGamePlan.workout_title}</h2>
                                <p className="text-[13px] text-white/85 mt-2">{mockGamePlan.focus}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0"
                                style={{ boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
                                <ArrowRight size={22} className={`text-black transition-transform ${open ? 'rotate-90' : ''}`} />
                            </div>
                        </div>
                    </div>
                </button>

                {open && (
                    <div className="mt-3 space-y-3 pv-anim-in">
                        <div className="rounded-2xl p-4 bg-white/[0.03] border border-white/8 flex gap-3">
                            <Salad size={16} style={{ color: ORANGE }} className="shrink-0 mt-0.5" />
                            <p className="text-[13px] text-white/70 leading-relaxed">{mockGamePlan.nutrition_context}</p>
                        </div>

                        {mockGamePlan.exercise_targets.map((ex, i) => {
                            const meta = progressionMeta[ex.progression_status];
                            return (
                                <div key={i} className="rounded-2xl p-4 bg-white/[0.03] border border-white/8">
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <div className="flex items-center gap-2">
                                            <Dumbbell size={15} className="text-white/40" />
                                            <div>
                                                <h3 className="text-[15px] font-bold leading-tight">{ex.name}</h3>
                                                <p className="text-[11px] text-white/35">{ex.muscle} · zuletzt {ex.last_time}</p>
                                            </div>
                                        </div>
                                        <span className="shrink-0 text-[10px] font-bold uppercase rounded-md px-2 py-1"
                                            style={{ color: meta.color, background: meta.bg }}>{meta.short}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        {ex.set_targets.map(s => (
                                            <div key={s.set_number} className="flex-1 rounded-xl p-2.5 text-center"
                                                style={{ background: 'rgba(255,255,255,0.05)' }}>
                                                <div className="text-[16px] font-extrabold tabular-nums leading-none" style={{ color: ORANGE }}>{s.weight_kg}</div>
                                                <div className="text-[10px] text-white/40 mt-1">{s.reps} reps</div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[12.5px] text-white/55 leading-relaxed mt-3">{ex.reasoning}</p>
                                </div>
                            );
                        })}

                        <div className="rounded-2xl p-4" style={{ background: `${ORANGE}12`, border: `1px solid ${ORANGE}33` }}>
                            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: ORANGE }}>
                                <Zap size={12} fill={ORANGE} /> Fokus heute
                            </div>
                            <p className="text-[13px] text-white/75 leading-relaxed">{mockGamePlan.general_advice}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
