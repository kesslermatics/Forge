import { useState } from 'react';
import { Flame, ChevronDown, Leaf, Moon } from 'lucide-react';
import {
    mockUser, mockWeather, mockNutrition, mockStreaks, mockWeight,
    mockGamePlan, progressionMeta, nutritionMacros, caloriesRemaining, caloriesPct,
    weightDelta, weightCurrent,
} from '../mockData';
import { sparkPath, greeting, dateLabel } from '../helpers';

const SAND = '#e8c58a';
const CARD = 'rgba(255,247,235,0.035)';

export default function V4Cadence() {
    const [open, setOpen] = useState(true);
    const macros = nutritionMacros();
    const spark = sparkPath(mockWeight.map(w => w.weight_kg), 300, 64, 6);

    return (
        <div className="min-h-full text-[#f2ece2] font-sans px-5 pt-10 pb-24"
            style={{ background: 'linear-gradient(180deg, #16130f 0%, #100e0b 100%)' }}>
            {/* Header */}
            <header className="pv-anim">
                <div className="flex items-center gap-2 text-[12px] text-[#f2ece2]/40">
                    <Moon size={12} /> {dateLabel()} · {mockWeather.emoji} {mockWeather.temperature_c}°
                </div>
                <h1 className="text-[30px] font-medium tracking-tight mt-3 leading-tight">
                    {greeting()}, {mockUser.firstName}.
                </h1>
                <p className="text-[15px] text-[#f2ece2]/45 mt-1.5 leading-relaxed">
                    Ruhig und stark durch den Tag. Hier ist dein Überblick.
                </p>
            </header>

            {/* Nutrition — calm card */}
            <section className="pv-anim pv-d1 mt-8 rounded-[28px] p-6" style={{ background: CARD, border: '1px solid rgba(232,197,138,0.12)' }}>
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2 text-[13px] text-[#f2ece2]/55">
                        <Flame size={14} style={{ color: SAND }} /> Ernährung heute
                    </div>
                    <span className="text-[12px] text-[#f2ece2]/40">{Math.round(caloriesRemaining)} kcal übrig</span>
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-[38px] font-light leading-none tabular-nums">{Math.round(mockNutrition.totals.calories)}</span>
                    <span className="text-[14px] text-[#f2ece2]/35">/ {mockNutrition.goals.calories} kcal</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ background: 'rgba(242,236,226,0.08)' }}>
                    <div className="h-full rounded-full pv-bar-anim" style={{ background: SAND, ['--pv-bar-w' as string]: `${Math.min(caloriesPct, 1) * 100}%` }} />
                </div>

                <div className="mt-6 space-y-4">
                    {macros.map(m => {
                        const pct = Math.min(m.current / m.goal, 1);
                        return (
                            <div key={m.key} className="flex items-center gap-4">
                                <span className="text-[13px] text-[#f2ece2]/55 w-16">{m.label}</span>
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(242,236,226,0.08)' }}>
                                    <div className="h-full rounded-full pv-bar-anim" style={{ background: m.accent, opacity: 0.85, ['--pv-bar-w' as string]: `${pct * 100}%` }} />
                                </div>
                                <span className="text-[13px] tabular-nums text-[#f2ece2]/70 w-20 text-right">{Math.round(m.current)}<span className="text-[#f2ece2]/30">/{m.goal}g</span></span>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Streaks + weight — soft row */}
            <section className="pv-anim pv-d2 mt-4 grid grid-cols-2 gap-4">
                <div className="rounded-[24px] p-5" style={{ background: CARD, border: '1px solid rgba(232,197,138,0.1)' }}>
                    <div className="text-[12px] text-[#f2ece2]/45">Konstanz</div>
                    <div className="flex items-baseline gap-1 mt-2">
                        <span className="text-[30px] font-light tabular-nums leading-none">{mockStreaks.nutrition.current}</span>
                        <span className="text-[12px] text-[#f2ece2]/40">Tage</span>
                    </div>
                    <div className="text-[11px] text-[#f2ece2]/35 mt-2">Training: {mockStreaks.training.current} Wochen</div>
                </div>
                <div className="rounded-[24px] p-5" style={{ background: CARD, border: '1px solid rgba(232,197,138,0.1)' }}>
                    <div className="text-[12px] text-[#f2ece2]/45">Gewicht</div>
                    <div className="flex items-baseline gap-1 mt-2">
                        <span className="text-[30px] font-light tabular-nums leading-none">{weightCurrent.toFixed(1)}</span>
                        <span className="text-[12px] text-[#f2ece2]/40">kg</span>
                    </div>
                    <svg viewBox="0 0 300 64" className="w-full h-6 mt-1">
                        <path d={spark.line} fill="none" stroke={SAND} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
                    </svg>
                    <div className="text-[11px] text-[#f2ece2]/35">{weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)} kg · 12 Tage</div>
                </div>
            </section>

            {/* HERO */}
            <section className="pv-anim pv-d3 mt-8">
                <p className="text-[13px] text-[#f2ece2]/45 mb-3 px-1">Dein Plan fürs nächste Training</p>

                <button onClick={() => setOpen(o => !o)} className="pv-tap w-full text-left">
                    <div className="rounded-[28px] p-7 relative overflow-hidden"
                        style={{ background: 'linear-gradient(150deg, #2a2116, #1c160f)', border: '1px solid rgba(232,197,138,0.22)' }}>
                        <div className="absolute right-0 top-0 w-32 h-32 rounded-full"
                            style={{ background: `radial-gradient(circle, ${SAND}22, transparent 70%)` }} />
                        <div className="relative">
                            <span className="text-[12px] uppercase tracking-widest" style={{ color: SAND }}>{mockGamePlan.focus}</span>
                            <h2 className="text-[30px] font-medium mt-2 leading-tight">{mockGamePlan.workout_title}</h2>
                            <p className="text-[14px] text-[#f2ece2]/55 mt-3 leading-relaxed">
                                {mockGamePlan.exercise_targets.length} Übungen · ~{mockGamePlan.est_duration_min} Minuten. Alle Zielgewichte sind auf deinen letzten Fortschritt abgestimmt.
                            </p>
                            <div className="flex items-center gap-1.5 mt-5 text-[14px] font-medium" style={{ color: SAND }}>
                                {open ? 'Weniger anzeigen' : 'Plan lesen'}
                                <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                            </div>
                        </div>
                    </div>
                </button>

                {open && (
                    <div className="mt-4 space-y-5 pv-anim-in">
                        <div className="rounded-[22px] p-5 flex gap-3" style={{ background: CARD, border: '1px solid rgba(232,197,138,0.1)' }}>
                            <Leaf size={16} style={{ color: SAND }} className="shrink-0 mt-0.5" />
                            <p className="text-[13.5px] text-[#f2ece2]/65 leading-relaxed">{mockGamePlan.nutrition_context}</p>
                        </div>

                        {mockGamePlan.exercise_targets.map((ex, i) => {
                            const meta = progressionMeta[ex.progression_status];
                            return (
                                <div key={i}>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <h3 className="text-[17px] font-medium leading-tight">{ex.name}</h3>
                                        <span className="shrink-0 text-[11px]" style={{ color: meta.color }}>{meta.label}</span>
                                    </div>
                                    <p className="text-[12px] text-[#f2ece2]/40 mt-1">{ex.muscle} · zuletzt {ex.last_time}</p>

                                    <div className="mt-3 rounded-[18px] overflow-hidden" style={{ border: '1px solid rgba(242,236,226,0.08)' }}>
                                        {ex.set_targets.map((s, j) => (
                                            <div key={s.set_number}
                                                className="flex items-center justify-between px-4 py-2.5"
                                                style={{ background: j % 2 ? 'transparent' : 'rgba(255,247,235,0.02)' }}>
                                                <span className="text-[12px] text-[#f2ece2]/40">Satz {s.set_number}</span>
                                                <span className="text-[14px] tabular-nums">
                                                    <span className="font-medium">{s.weight_kg} kg</span>
                                                    <span className="text-[#f2ece2]/40"> × {s.reps}</span>
                                                </span>
                                                <span className="text-[11px] text-[#f2ece2]/35 w-28 text-right truncate">{s.note || '—'}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[13px] text-[#f2ece2]/50 leading-relaxed mt-3">{ex.reasoning}</p>
                                </div>
                            );
                        })}

                        <div className="rounded-[22px] p-5" style={{ background: `${SAND}10`, border: `1px solid ${SAND}28` }}>
                            <p className="text-[12px] uppercase tracking-widest mb-2" style={{ color: SAND }}>Zum Schluss</p>
                            <p className="text-[13.5px] text-[#f2ece2]/70 leading-relaxed">{mockGamePlan.general_advice}</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
