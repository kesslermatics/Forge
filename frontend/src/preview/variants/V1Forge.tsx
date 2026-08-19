import { useState } from 'react';
import { Flame, ChevronRight, ArrowUpRight, Minus, TrendingUp } from 'lucide-react';
import {
    mockUser, mockWeather, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, ringMath, greeting, dateLabel } from '../helpers';

const LIME = '#c6ff3d';

export default function V1Forge() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const ring = ringMath(52, caloriesPct);
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 120, 40, 4);

    return (
        <div className="min-h-full bg-[#050505] text-white font-sans px-5 pt-8 pb-24">
            {/* Header */}
            <header className="pv-anim">
                <p className="text-[13px] text-white/40">{greeting()},</p>
                <h1 className="text-[34px] leading-none font-semibold tracking-tight mt-1">
                    {mockUser.firstName}<span style={{ color: LIME }}>.</span>
                </h1>
                <div className="flex items-center gap-2 mt-3 text-[12px] text-white/35">
                    <span>{dateLabel()}</span>
                    <span className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{mockWeather.emoji} {mockWeather.temperature_c}°</span>
                </div>
            </header>

            {/* Calories hero */}
            <section className="pv-anim pv-d1 mt-9 flex items-center gap-6">
                <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
                    <svg width="128" height="128" className="-rotate-90">
                        <circle cx="64" cy="64" r="52" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
                        <circle
                            cx="64" cy="64" r="52" fill="none" stroke={LIME} strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={ring.c}
                            className="pv-ring-anim"
                            style={{ ['--pv-ring-start' as string]: `${ring.c}`, ['--pv-ring-end' as string]: `${ring.offset}` }}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[26px] font-semibold leading-none tracking-tight">
                            {Math.round(mockNutrition.totals.calories)}
                        </span>
                        <span className="text-[10px] text-white/35 mt-1">/ {mockNutrition.goals.calories}</span>
                    </div>
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-1.5 text-white/40 text-[11px] uppercase tracking-widest">
                        <Flame size={12} /> Kalorien
                    </div>
                    <p className="text-[15px] mt-1.5 text-white/70 leading-snug">
                        Noch <span className="text-white font-semibold">{Math.round(caloriesRemaining)}</span> kcal übrig heute.
                    </p>
                    <div className="mt-4 space-y-2.5">
                        {macros.map(m => {
                            const pct = Math.min(m.current / m.goal, 1);
                            return (
                                <div key={m.key}>
                                    <div className="flex justify-between text-[11px] mb-1">
                                        <span className="text-white/45">{m.label}</span>
                                        <span className="text-white/70 tabular-nums">{Math.round(m.current)}<span className="text-white/30">/{m.goal}{m.unit}</span></span>
                                    </div>
                                    <div className="h-[3px] rounded-full bg-white/8 overflow-hidden">
                                        <div className="h-full rounded-full pv-bar-anim" style={{ background: LIME, ['--pv-bar-w' as string]: `${pct * 100}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Streaks + weight — hairline row */}
            <section className="pv-anim pv-d2 mt-9 grid grid-cols-3 gap-0 border-y border-white/8 py-5">
                <Stat value={mockStreaks.training.current} label="Training" suffix="Wochen" />
                <Stat value={mockStreaks.nutrition.current} label="Ernährung" suffix="Tage" divider />
                <div className="pl-5">
                    <div className="flex items-center gap-1 text-[11px] text-white/40">
                        Gewicht {weightDelta < 0 ? <TrendingUp size={11} className="rotate-180" style={{ color: LIME }} /> : <Minus size={11} />}
                    </div>
                    <div className="text-[22px] font-semibold leading-none mt-1.5 tabular-nums">{weightCurrent.toFixed(1)}</div>
                    <svg width="120" height="30" className="mt-1 -ml-1 w-full">
                        <path d={spark.line} fill="none" stroke={LIME} strokeWidth="1.5" opacity="0.8" />
                    </svg>
                </div>
            </section>

            {/* HERO — Game plan */}
            <section className="pv-anim pv-d3 mt-8">
                <p className="text-[11px] uppercase tracking-widest text-white/35 mb-3">Heute dran</p>

                <button onClick={() => setOpen(o => !o)} className="pv-tap w-full text-left">
                    <div className="relative rounded-3xl p-6 overflow-hidden" style={{ background: LIME }}>
                        <div className="relative z-10">
                            <p className="text-[12px] font-medium text-black/55 uppercase tracking-wider">Dein Plan</p>
                            <h2 className="text-[30px] font-bold text-black leading-none mt-2 tracking-tight">{mockGamePlan.workout_title}</h2>
                            <p className="text-[13px] text-black/60 mt-2">{mockGamePlan.focus}</p>
                            <div className="flex items-center gap-3 mt-5 text-[12px] text-black/70">
                                <span className="rounded-full bg-black/10 px-3 py-1 font-medium">{mockGamePlan.exercise_targets.length} Übungen</span>
                                <span className="rounded-full bg-black/10 px-3 py-1 font-medium">~{mockGamePlan.est_duration_min} min</span>
                            </div>
                        </div>
                        <div className="absolute right-5 bottom-5 z-10 flex items-center gap-1 text-black font-semibold text-[13px]">
                            {open ? 'Schließen' : 'Plan öffnen'} <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                        </div>
                        <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-black/5" />
                    </div>
                </button>

                {open && (
                    <div className="mt-4 space-y-3 pv-anim-in">
                        {/* nutrition context */}
                        <div className="rounded-2xl bg-white/[0.04] border border-white/8 p-4">
                            <p className="text-[11px] uppercase tracking-widest text-white/35 mb-1.5">Vor dem Training</p>
                            <p className="text-[13px] text-white/70 leading-relaxed">{mockGamePlan.nutrition_context}</p>
                        </div>

                        {mockGamePlan.exercise_targets.map((ex, i) => {
                            const meta = progressionMeta[ex.progression_status];
                            return (
                                <div key={i} className="border-b border-white/8 pb-4 last:border-0">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="text-[16px] font-semibold text-white leading-tight">{ex.name}</h3>
                                            <p className="text-[11px] text-white/35 mt-0.5">{ex.muscle} · zuletzt {ex.last_time}</p>
                                        </div>
                                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1"
                                            style={{ color: meta.color, background: meta.bg }}>
                                            {meta.short}
                                        </span>
                                    </div>
                                    {/* set targets */}
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {ex.set_targets.map(s => (
                                            <div key={s.set_number} className="rounded-xl bg-white/[0.05] px-3 py-2 min-w-[64px]">
                                                <div className="text-[9px] text-white/30 uppercase tracking-wide">Satz {s.set_number}</div>
                                                <div className="text-[15px] font-semibold tabular-nums leading-tight mt-0.5">
                                                    {s.weight_kg}<span className="text-[10px] text-white/40 font-normal">kg</span>
                                                </div>
                                                <div className="text-[11px] text-white/45">{s.reps} Wdh.</div>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[12.5px] text-white/50 leading-relaxed mt-3">{ex.reasoning}</p>
                                </div>
                            );
                        })}

                        {/* general advice */}
                        <div className="rounded-2xl p-4" style={{ background: `${LIME}12`, border: `1px solid ${LIME}30` }}>
                            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest mb-1.5" style={{ color: LIME }}>
                                <ArrowUpRight size={13} /> Fokus
                            </div>
                            <p className="text-[13px] text-white/75 leading-relaxed">{mockGamePlan.general_advice}</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function Stat({ value, label, suffix, divider }: { value: number; label: string; suffix: string; divider?: boolean }) {
    return (
        <div className={divider ? 'pl-5 border-l border-white/8' : ''}>
            <div className="text-[11px] text-white/40">{label}</div>
            <div className="text-[22px] font-semibold leading-none mt-1.5 tabular-nums">{value}</div>
            <div className="text-[10px] text-white/30 mt-1">{suffix}</div>
        </div>
    );
}
