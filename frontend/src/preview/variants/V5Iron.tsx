import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import {
    mockUser, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, dateLabel } from '../helpers';

export default function V5Iron() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 300, 50, 4);

    return (
        <div className="min-h-full bg-black text-white font-sans px-5 pt-8 pb-24">
            {/* Masthead */}
            <header className="pv-anim border-b-2 border-white pb-4">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-white/45">
                    <span>{dateLabel()}</span>
                    <span>Ausgabe · Push</span>
                </div>
                <h1 className="text-[40px] font-black uppercase tracking-tighter leading-[0.9] mt-3">
                    Hallo,<br />{mockUser.firstName}
                </h1>
            </header>

            {/* Calories — editorial stat block */}
            <section className="pv-anim pv-d1 border-b border-white/20 py-5">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.25em] text-white/45 mb-1">Kalorien</div>
                        <div className="font-mono text-[40px] font-bold leading-none tracking-tight">
                            {Math.round(mockNutrition.totals.calories)}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-[14px] text-white/50">/ {mockNutrition.goals.calories}</div>
                        <div className="font-mono text-[13px] text-white mt-1">−{Math.round(caloriesRemaining)} übrig</div>
                    </div>
                </div>
                <div className="mt-3 h-[6px] w-full bg-white/15">
                    <div className="h-full bg-white pv-bar-anim" style={{ ['--pv-bar-w' as string]: `${Math.min(caloriesPct, 1) * 100}%` }} />
                </div>
            </section>

            {/* Macros — 3col ruled table */}
            <section className="pv-anim pv-d2 grid grid-cols-3 border-b border-white/20">
                {macros.map((m, i) => (
                    <div key={m.key} className={`py-4 ${i > 0 ? 'border-l border-white/20 pl-4' : 'pr-4'}`}>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">{m.label}</div>
                        <div className="font-mono text-[22px] font-bold mt-1.5 leading-none">{Math.round(m.current)}<span className="text-[11px] text-white/40">g</span></div>
                        <div className="font-mono text-[10px] text-white/35 mt-1">/ {m.goal}g</div>
                    </div>
                ))}
            </section>

            {/* Streak + weight ruled row */}
            <section className="pv-anim pv-d3 grid grid-cols-2 border-b border-white/20">
                <div className="py-4 pr-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Serie</div>
                    <div className="font-mono text-[22px] font-bold mt-1.5 leading-none">{mockStreaks.nutrition.current} <span className="text-[11px] text-white/40">Tage</span></div>
                    <div className="font-mono text-[10px] text-white/35 mt-1">Training {mockStreaks.training.current} Wo.</div>
                </div>
                <div className="py-4 pl-4 border-l border-white/20">
                    <div className="flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Gewicht</div>
                        <span className="font-mono text-[11px] text-white/60">{weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)}</span>
                    </div>
                    <div className="font-mono text-[22px] font-bold mt-1.5 leading-none">{weightCurrent.toFixed(1)}<span className="text-[11px] text-white/40">kg</span></div>
                    <svg viewBox="0 0 300 50" className="w-full h-5 mt-1">
                        <path d={spark.line} fill="none" stroke="white" strokeWidth="2" />
                    </svg>
                </div>
            </section>

            {/* HERO — headline feature */}
            <section className="pv-anim pv-d4 mt-6">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-white/45">Trainingsplan</span>
                    <button onClick={() => setOpen(o => !o)}
                        className="pv-tap w-8 h-8 border border-white flex items-center justify-center">
                        {open ? <Minus size={16} /> : <Plus size={16} />}
                    </button>
                </div>

                <div className="border-2 border-white p-5">
                    <div className="flex items-baseline justify-between">
                        <h2 className="text-[32px] font-black uppercase tracking-tight leading-none">{mockGamePlan.workout_title}</h2>
                        <span className="font-mono text-[13px] text-white/50">~{mockGamePlan.est_duration_min}′</span>
                    </div>
                    <p className="text-[12px] uppercase tracking-[0.15em] text-white/45 mt-2">{mockGamePlan.focus}</p>
                </div>

                {open && (
                    <div className="pv-anim-in">
                        {/* nutrition line */}
                        <div className="border-x-2 border-b border-white/40 border-l-2 border-r-2 bg-white/[0.04] px-5 py-3">
                            <span className="text-[10px] uppercase tracking-[0.2em] text-white/45">Fuel · </span>
                            <span className="text-[12.5px] text-white/70 leading-relaxed">{mockGamePlan.nutrition_context}</span>
                        </div>

                        {mockGamePlan.exercise_targets.map((ex, i) => {
                            const meta = progressionMeta[ex.progression_status];
                            return (
                                <div key={i} className="border-2 border-t-0 border-white px-5 py-4">
                                    <div className="flex items-start gap-3">
                                        <span className="font-mono text-[13px] text-white/35 mt-1">{String(i + 1).padStart(2, '0')}</span>
                                        <div className="flex-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <h3 className="text-[17px] font-bold uppercase tracking-tight leading-tight">{ex.name}</h3>
                                                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-1 border"
                                                    style={{ color: meta.color, borderColor: meta.color }}>{meta.short}</span>
                                            </div>
                                            <p className="text-[10px] uppercase tracking-[0.15em] text-white/35 mt-1">{ex.muscle} · zuletzt {ex.last_time}</p>

                                            {/* set table */}
                                            <div className="mt-3 border-t border-white/20">
                                                {ex.set_targets.map(s => (
                                                    <div key={s.set_number} className="flex items-center justify-between py-1.5 border-b border-white/10">
                                                        <span className="font-mono text-[11px] text-white/40">SATZ {s.set_number}</span>
                                                        <span className="font-mono text-[15px] font-bold">{s.weight_kg}<span className="text-[10px] text-white/40 font-normal">KG</span> × {s.reps}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <p className="text-[12px] text-white/50 leading-relaxed mt-3">{ex.reasoning}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        <div className="border-2 border-t-0 border-white bg-white text-black px-5 py-4">
                            <div className="text-[10px] uppercase tracking-[0.25em] text-black/50 mb-1">Fokus</div>
                            <p className="text-[13px] leading-relaxed font-medium">{mockGamePlan.general_advice}</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
