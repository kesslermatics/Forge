import { useEffect, useState, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
    getTodayBriefing, regenerateBriefing, getWorkoutList, getWorkoutTips,
    getWeather, saveTrainingPlan, sendChatMessage, getWeightHistory,
    getTodayNutrition, getStreaks,
} from '../api/api';
import type {
    UserInfo, Briefing, WorkoutTips, WeatherData,
    ChatMessage, WeightHistoryEntry, TodayNutrition, StreaksData,
} from '../api/api';
import {
    RefreshCw, Loader2, Flame,
    Dumbbell, ChevronRight, ChevronDown, ChevronUp,
    Send, MessageSquare, Scale, Check, Edit3,
    ListChecks,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLanguage } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

/* ── sparkline ── */
function Spark({ values, color = SAND, h = 36 }: { values: number[]; color?: string; h?: number }) {
    if (values.length < 2) return null;
    const W = 300; const PAD = 4;
    const min = Math.min(...values); const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => ({
        x: PAD + (i / (values.length - 1)) * (W - PAD * 2),
        y: PAD + (h - PAD * 2) - ((v - min) / range) * (h - PAD * 2),
    }));
    let line = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const cx = pts[i].x + (pts[i + 1].x - pts[i].x) * 0.4;
        line += ` C ${cx} ${pts[i].y}, ${pts[i + 1].x - (pts[i + 1].x - pts[i].x) * 0.4} ${pts[i + 1].y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    const area = `${line} L ${pts[pts.length - 1].x} ${h - PAD} L ${pts[0].x} ${h - PAD} Z`;
    return (
        <svg viewBox={`0 0 ${W} ${h}`} className="w-full" style={{ height: h }}>
            <defs>
                <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill="url(#spk)" />
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

/* ── macro bar ── */
function MacroBar({ label, current, goal, color }: { label: string; current: number; goal: number; color: string }) {
    const pct = goal > 0 ? Math.min(current / goal, 1) : 0;
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px]" style={{ color: TEXT_DIM }}>{label}</span>
                <span className="text-[11px] tabular-nums" style={{ color: TEXT_MID }}>
                    {Math.round(current)}<span style={{ color: TEXT_DIM }}>/{goal}g</span>
                </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.08)' }}>
                <div className="h-full rounded-full" style={{
                    width: `${pct * 100}%`,
                    background: color,
                    transition: 'width 0.9s cubic-bezier(0.22,1,0.36,1)',
                }} />
            </div>
        </div>
    );
}

/* ── progression badge ── */
const PROG_META: Record<string, { label: string; color: string; bg: string }> = {
    INCREASE_WEIGHT: { label: '↑ Hochgehen', color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    KEEP_PROGRESSING: { label: '→ Reps +', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
    STAGNATED: { label: '⚠ Halten', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    REGRESSED: { label: '↓ Deload', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
    FIRST_SESSION: { label: '★ Neu', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};

export default function Dashboard() {
    const { user } = useOutletContext<LayoutContext>();
    const { lang } = useLanguage();

    const [briefing, setBriefing] = useState<Briefing | null>(null);
    const [loading, setLoading] = useState(true);
    const [regenerating, setRegenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null);

    const [workoutTips, setWorkoutTips] = useState<WorkoutTips | null>(null);
    const [tipsLoading, setTipsLoading] = useState(false);
    const [tipsError, setTipsError] = useState<string | null>(null);

    const [trainingPlan, setTrainingPlan] = useState<string[]>(user?.training_plan || []);
    const [editingPlan, setEditingPlan] = useState(false);
    const [planDraft, setPlanDraft] = useState<string[]>([]);
    const [planSaving, setPlanSaving] = useState(false);
    const [allWorkoutNames, setAllWorkoutNames] = useState<string[]>([]);

    const [chatOpen, setChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const [weightHistory, setWeightHistory] = useState<WeightHistoryEntry[]>([]);
    const [todayNutrition, setTodayNutrition] = useState<TodayNutrition | null>(null);
    const [streaks, setStreaks] = useState<StreaksData | null>(null);

    /* load briefing + secondary data */
    useEffect(() => {
        let resolved = false;
        const load = (loc: typeof location) => {
            if (resolved) return;
            resolved = true;
            if (loc) {
                setLocation(loc);
                getWeather(loc.lat, loc.lon).then(setWeather).catch(() => { });
            }
            getTodayBriefing(loc?.lat, loc?.lon)
                .then(setBriefing)
                .catch((e: any) => setError(e.message || 'Fehler beim Laden'))
                .finally(() => setLoading(false));
        };
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                p => load({ lat: p.coords.latitude, lon: p.coords.longitude }),
                () => load(null),
                { timeout: 5000, enableHighAccuracy: false },
            );
            setTimeout(() => load(null), 6000);
        } else { load(null); }
    }, []); // eslint-disable-line

    useEffect(() => {
        getWeightHistory(90).then(d => setWeightHistory(d.entries)).catch(() => { });
        getTodayNutrition().then(setTodayNutrition).catch(() => { });
        getStreaks().then(setStreaks).catch(() => { });
    }, []);

    useEffect(() => {
        if (user?.training_plan) setTrainingPlan(user.training_plan);
    }, [user?.training_plan]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, chatLoading]);

    const handleRegenerate = async () => {
        setRegenerating(true); setError(null);
        try { setBriefing(await regenerateBriefing(location?.lat, location?.lon)); }
        catch (e: any) { setError(e.message); }
        finally { setRegenerating(false); }
    };

    const handleSelectWorkout = useCallback(async (name: string, force = false) => {
        setTipsLoading(true); setTipsError(null);
        if (!force) setWorkoutTips(null);
        try { setWorkoutTips(await getWorkoutTips(name, force)); }
        catch (e: any) { setTipsError(e.message); }
        finally { setTipsLoading(false); }
    }, []);

    const handleEditPlan = async () => {
        setPlanDraft([...trainingPlan]);
        setEditingPlan(true);
        if (allWorkoutNames.length === 0) {
            try {
                const list = await getWorkoutList();
                setAllWorkoutNames([...new Set(list.map(w => w.title))]);
            } catch { }
        }
    };

    const handleSavePlan = async () => {
        setPlanSaving(true);
        try {
            const res = await saveTrainingPlan(planDraft);
            setTrainingPlan(res.training_plan);
            setEditingPlan(false);
        } catch { }
        setPlanSaving(false);
    };

    const handleChatSend = async () => {
        const msg = chatInput.trim();
        if (!msg || chatLoading) return;
        setChatInput('');
        const userMsg: ChatMessage = { role: 'user', content: msg };
        setChatMessages(prev => [...prev, userMsg]);
        setChatLoading(true);
        try {
            const res = await sendChatMessage(msg, [...chatMessages, userMsg].slice(-20));
            setChatMessages(prev => [...prev, { role: 'assistant', content: res.response }]);
        } catch {
            setChatMessages(prev => [...prev, { role: 'assistant', content: 'Etwas ist schiefgelaufen — probier es nochmal.' }]);
        }
        setChatLoading(false);
    };

    const dateStr = new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', {
        weekday: 'long', day: 'numeric', month: 'long',
    });
    const hour = new Date().getHours();
    const greeting = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Servus' : 'Guten Abend';

    const nt = todayNutrition && !todayNutrition.error ? todayNutrition : null;
    const calPct = nt ? nt.totals.calories / (nt.goals.calories || 1) : 0;
    const weightValues = weightHistory.map(w => w.weight_kg);
    const weightCurrent = weightValues[weightValues.length - 1];
    const weightDelta = weightValues.length >= 2 ? weightCurrent - weightValues[0] : null;

    return (
        <div className="space-y-4">
            {/* ── Greeting ── */}
            <header className="forge-anim">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-[13px]" style={{ color: TEXT_DIM }}>{greeting},</p>
                        <h1 className="text-[28px] font-semibold tracking-tight leading-none mt-1" style={{ color: '#f2ece0' }}>
                            {user?.first_name || user?.username}
                        </h1>
                        <p className="text-[12px] mt-2" style={{ color: TEXT_DIM }}>
                            {dateStr}{weather?.temperature_c != null && ` · ${weather.emoji} ${Math.round(weather.temperature_c)}°`}
                        </p>
                    </div>
                    {briefing && (
                        <button onClick={handleRegenerate} disabled={regenerating}
                            className="tap mt-1 text-[11px] flex items-center gap-1.5 cursor-pointer"
                            style={{ color: TEXT_DIM }}>
                            <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
                        </button>
                    )}
                </div>
            </header>

            {/* ── Loading ── */}
            {loading && (
                <div className="card-forge p-12 text-center space-y-3 forge-anim">
                    <Loader2 className="w-7 h-7 animate-spin mx-auto" style={{ color: SAND }} />
                    <p className="text-[13px]" style={{ color: TEXT_DIM }}>Daten werden analysiert…</p>
                </div>
            )}

            {/* ── Error ── */}
            {error && !loading && (
                <div className="card-forge p-6 text-center space-y-3">
                    <p className="text-[13px] text-red-400">{error}</p>
                    <button onClick={() => { setLoading(true); setError(null); getTodayBriefing(location?.lat, location?.lon).then(setBriefing).catch((e: any) => setError(e.message)).finally(() => setLoading(false)); }}
                        className="btn-forge text-sm px-5 py-2 mx-auto">Nochmal</button>
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* ── Kalorien-Hero + Makros ── */}
                    {nt && (
                        <section className="card-forge p-5 forge-anim forge-d1">
                            {/* Header row */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2 text-[12px]" style={{ color: TEXT_DIM }}>
                                    <Flame size={13} style={{ color: SAND }} />
                                    Ernährung heute
                                </div>
                                <span className="text-[12px]" style={{ color: TEXT_DIM }}>
                                    {Math.max(0, Math.round(nt.goals.calories - nt.totals.calories))} kcal übrig
                                </span>
                            </div>

                            {/* Big calorie number */}
                            <div className="flex items-baseline gap-2 mb-2">
                                <span className="text-[42px] font-light leading-none tabular-nums" style={{ color: '#f2ece0' }}>
                                    {Math.round(nt.totals.calories)}
                                </span>
                                <span className="text-[15px]" style={{ color: TEXT_DIM }}>
                                    / {nt.goals.calories} kcal
                                </span>
                            </div>

                            {/* Wide progress bar */}
                            <div className="h-1.5 rounded-full overflow-hidden mb-5" style={{ background: 'rgba(255,247,235,0.08)' }}>
                                <div className="h-full rounded-full" style={{
                                    width: `${Math.min(calPct, 1) * 100}%`,
                                    background: SAND,
                                    transition: 'width 1s cubic-bezier(0.22,1,0.36,1)',
                                }} />
                            </div>

                            {/* Macro rows */}
                            <div className="space-y-3">
                                <MacroBar label="Protein" current={nt.totals.protein} goal={nt.goals.protein} color="#f87171" />
                                <MacroBar label="Carbs" current={nt.totals.carbs} goal={nt.goals.carbs} color="#fbbf24" />
                                <MacroBar label="Fett" current={nt.totals.fat} goal={nt.goals.fat} color="#34d399" />
                            </div>
                        </section>
                    )}

                    {/* ── Streaks + Gewicht ── */}
                    {(streaks || weightValues.length > 0) && (
                        <section className="grid grid-cols-3 gap-3 forge-anim forge-d2">
                            {streaks && (
                                <>
                                    <StreakTile
                                        label="Training"
                                        icon={<Dumbbell size={13} />}
                                        value={streaks.training.current_streak}
                                        unit="Wo."
                                    />
                                    <StreakTile
                                        label="Ernährung"
                                        icon={<Flame size={13} />}
                                        value={streaks.nutrition.current_streak}
                                        unit="Tg."
                                    />
                                </>
                            )}
                            {weightValues.length > 0 && (
                                <div className="card-forge p-3 col-span-1" style={{ gridColumn: streaks ? undefined : '1 / -1' }}>
                                    <div className="flex items-center justify-between text-[11px]" style={{ color: TEXT_DIM }}>
                                        <div className="flex items-center gap-1"><Scale size={12} /> Gewicht</div>
                                        {weightDelta !== null && (
                                            <span style={{ color: weightDelta < 0 ? '#34d399' : SAND }}>
                                                {weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[20px] font-semibold tabular-nums leading-none mt-1.5"
                                        style={{ color: '#f2ece0' }}>
                                        {weightCurrent?.toFixed(1)}
                                        <span className="text-[11px] font-normal ml-0.5" style={{ color: TEXT_DIM }}>kg</span>
                                    </div>
                                    {weightValues.length >= 4 && <Spark values={weightValues.slice(-12)} h={28} />}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Trainingsplan / Workout-Plan Hero ── */}
                    <section className="forge-anim forge-d3">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: TEXT_DIM }}>
                                Nächstes Training
                            </p>
                            {!editingPlan && (
                                <button onClick={handleEditPlan}
                                    className="tap flex items-center gap-1 text-[11px] cursor-pointer"
                                    style={{ color: TEXT_DIM }}>
                                    <Edit3 size={11} />
                                    {trainingPlan.length > 0 ? 'Plan bearbeiten' : 'Plan wählen'}
                                </button>
                            )}
                        </div>

                        {/* Plan editing */}
                        {editingPlan && (
                            <div className="card-forge p-4 space-y-3 mb-3">
                                <p className="text-[12px]" style={{ color: TEXT_DIM }}>Workouts auswählen</p>
                                <div className="flex flex-wrap gap-2">
                                    {allWorkoutNames.length === 0
                                        ? <span className="text-[12px]" style={{ color: TEXT_DIM }}>Lade…</span>
                                        : allWorkoutNames.map(n => (
                                            <button key={n} onClick={() => setPlanDraft(prev =>
                                                prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])}
                                                className="tap text-[12px] px-3 py-1.5 rounded-xl border transition-all cursor-pointer"
                                                style={{
                                                    background: planDraft.includes(n) ? `${SAND}18` : 'rgba(255,247,235,0.04)',
                                                    borderColor: planDraft.includes(n) ? `${SAND}44` : 'rgba(255,247,235,0.1)',
                                                    color: planDraft.includes(n) ? SAND : TEXT_MID,
                                                }}>
                                                {planDraft.includes(n) && <Check size={10} className="inline mr-1" />}{n}
                                            </button>
                                        ))
                                    }
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setEditingPlan(false)}
                                        className="text-[12px] cursor-pointer px-3 py-1.5" style={{ color: TEXT_DIM }}>
                                        Abbrechen
                                    </button>
                                    <button onClick={handleSavePlan} disabled={planSaving}
                                        className="tap text-[12px] px-4 py-1.5 rounded-xl cursor-pointer"
                                        style={{ background: `${SAND}18`, border: `1px solid ${SAND}44`, color: SAND }}>
                                        {planSaving ? 'Speichern…' : 'Speichern'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* No plan yet */}
                        {!editingPlan && trainingPlan.length === 0 && !workoutTips && (
                            <button onClick={handleEditPlan}
                                className="tap w-full card-forge p-6 text-center space-y-2 cursor-pointer">
                                <ListChecks size={24} className="mx-auto" style={{ color: TEXT_DIM }} />
                                <p className="text-[13px]" style={{ color: TEXT_DIM }}>
                                    Kein Trainingsplan gesetzt — tippe um Workouts auszuwählen.
                                </p>
                            </button>
                        )}

                        {/* Workout picker tiles */}
                        {!editingPlan && trainingPlan.length > 0 && !workoutTips && !tipsLoading && (
                            <div className="space-y-2">
                                {trainingPlan.map(name => (
                                    <button key={name} onClick={() => handleSelectWorkout(name)}
                                        className="tap w-full card-forge p-4 flex items-center justify-between cursor-pointer group">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                                                style={{ background: `${SAND}12`, border: `1px solid ${SAND}28` }}>
                                                <Dumbbell size={16} style={{ color: SAND }} />
                                            </div>
                                            <span className="text-[15px] font-medium" style={{ color: '#f2ece0' }}>{name}</span>
                                        </div>
                                        <ChevronRight size={16} style={{ color: TEXT_DIM }} />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Loading tips */}
                        {tipsLoading && (
                            <div className="card-forge p-8 text-center space-y-2">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: SAND }} />
                                <p className="text-[12px]" style={{ color: TEXT_DIM }}>Plan wird generiert…</p>
                            </div>
                        )}

                        {/* Tips error */}
                        {tipsError && !tipsLoading && (
                            <div className="card-forge p-5 text-center space-y-2">
                                <p className="text-[13px] text-red-400">{tipsError}</p>
                                <button onClick={() => { setWorkoutTips(null); setTipsError(null); }}
                                    className="text-[12px] cursor-pointer" style={{ color: TEXT_DIM }}>
                                    Zurück
                                </button>
                            </div>
                        )}

                        {/* ── Workout Plan Content ── */}
                        {workoutTips && !tipsLoading && (
                            <WorkoutPlanDisplay
                                tips={workoutTips}
                                onBack={() => { setWorkoutTips(null); setTipsError(null); }}
                                onRegenerate={() => handleSelectWorkout(workoutTips.workout_title, true)}
                                regenerating={tipsLoading}
                            />
                        )}
                    </section>

                    {/* ── Weather note from briefing ── */}
                    {briefing?.briefing_data?.weather_note && (
                        <div className="card-forge px-4 py-3 flex items-center gap-3 forge-anim forge-d4">
                            <span className="text-xl shrink-0">{weather?.emoji || '🌤️'}</span>
                            <p className="text-[13px] leading-relaxed" style={{ color: TEXT_MID }}>
                                {briefing.briefing_data.weather_note}
                            </p>
                        </div>
                    )}

                    {/* ── Coach Chat ── */}
                    <section className="card-forge overflow-hidden forge-anim forge-d5">
                        <button onClick={() => setChatOpen(o => !o)}
                            className="tap w-full flex items-center justify-between p-4 cursor-pointer">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                                    style={{ background: `${SAND}12`, border: `1px solid ${SAND}28` }}>
                                    <MessageSquare size={16} style={{ color: SAND }} />
                                </div>
                                <div className="text-left">
                                    <p className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>Forge Coach</p>
                                    <p className="text-[11px]" style={{ color: TEXT_DIM }}>
                                        Frag nach Training, Ernährung, Fortschritt
                                    </p>
                                </div>
                            </div>
                            {chatOpen
                                ? <ChevronUp size={16} style={{ color: TEXT_DIM }} />
                                : <ChevronDown size={16} style={{ color: TEXT_DIM }} />
                            }
                        </button>

                        {chatOpen && (
                            <div style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                                {/* Messages */}
                                <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: '55vh' }}>
                                    {chatMessages.length === 0 && (
                                        <p className="text-center text-[12px] py-6 italic" style={{ color: TEXT_DIM }}>
                                            Kein Smalltalk — stell mir eine echte Frage. 💪
                                        </p>
                                    )}
                                    {chatMessages.map((m, i) => (
                                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed"
                                                style={m.role === 'user'
                                                    ? { background: `${SAND}18`, border: `1px solid ${SAND}30`, color: '#f2ece0', borderBottomRightRadius: 6 }
                                                    : { background: 'rgba(255,247,235,0.05)', border: '1px solid rgba(255,247,235,0.08)', color: '#e8dcc8', borderBottomLeftRadius: 6 }
                                                }>
                                                {m.role === 'user'
                                                    ? <div className="whitespace-pre-wrap">{m.content}</div>
                                                    : <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_strong]:text-[#e8c58a] [&_ul]:my-1 [&_li]:my-0.5">
                                                        <ReactMarkdown>{m.content}</ReactMarkdown>
                                                    </div>
                                                }
                                            </div>
                                        </div>
                                    ))}
                                    {chatLoading && (
                                        <div className="flex justify-start">
                                            <div className="rounded-2xl px-4 py-2.5 flex items-center gap-2 text-[12px]"
                                                style={{ background: 'rgba(255,247,235,0.05)', border: '1px solid rgba(255,247,235,0.08)', color: TEXT_DIM }}>
                                                <Loader2 size={12} className="animate-spin" />
                                                Denkt nach…
                                            </div>
                                        </div>
                                    )}
                                    <div ref={chatEndRef} />
                                </div>

                                {/* Input */}
                                <div className="p-3" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                                    <form onSubmit={e => { e.preventDefault(); handleChatSend(); }} className="flex gap-2">
                                        <input
                                            type="text"
                                            value={chatInput}
                                            onChange={e => setChatInput(e.target.value)}
                                            placeholder="Frag den Coach…"
                                            disabled={chatLoading}
                                            className="flex-1 text-[13px] rounded-xl px-4 py-2.5 outline-none"
                                            style={{
                                                background: 'rgba(255,247,235,0.05)',
                                                border: '1px solid rgba(255,247,235,0.1)',
                                                color: '#f2ece0',
                                            }}
                                            onFocus={e => (e.currentTarget.style.borderColor = `${SAND}44`)}
                                            onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,247,235,0.1)')}
                                        />
                                        <button type="submit" disabled={chatLoading || !chatInput.trim()}
                                            className="tap rounded-xl px-3 cursor-pointer"
                                            style={{
                                                background: `${SAND}18`,
                                                border: `1px solid ${SAND}30`,
                                                color: chatInput.trim() ? SAND : TEXT_DIM,
                                            }}>
                                            <Send size={15} />
                                        </button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════
   WORKOUT PLAN DISPLAY
   ═══════════════════════════════════════════════════ */
function WorkoutPlanDisplay({ tips, onBack, onRegenerate, regenerating }: {
    tips: WorkoutTips;
    onBack: () => void;
    onRegenerate: () => void;
    regenerating: boolean;
}) {
    return (
        <div className="space-y-3">
            {/* Header card */}
            <div className="card-forge p-5" style={{ borderColor: `${SAND}22` }}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <button onClick={onBack}
                            className="tap text-[11px] flex items-center gap-1 mb-2 cursor-pointer"
                            style={{ color: TEXT_DIM }}>
                            ← Zurück
                        </button>
                        <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>
                            {tips.workout_title}
                        </h2>
                    </div>
                    <button onClick={onRegenerate} disabled={regenerating}
                        className="tap flex items-center gap-1 text-[11px] cursor-pointer mt-1"
                        style={{ color: TEXT_DIM }}>
                        <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
                        Neu
                    </button>
                </div>
                {tips.nutrition_context && (
                    <p className="text-[13px] leading-relaxed mt-3 pt-3"
                        style={{ color: TEXT_MID, borderTop: `1px solid ${CARD_BORDER}` }}>
                        {tips.nutrition_context}
                    </p>
                )}
            </div>

            {/* Exercises */}
            {tips.exercise_targets?.map((ex, i) => {
                const meta = PROG_META[ex.progression_status || ''] ?? PROG_META.KEEP_PROGRESSING;
                return (
                    <div key={i} className="card-forge p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <h3 className="text-[15px] font-semibold leading-tight" style={{ color: '#f2ece0' }}>
                                {ex.name}
                            </h3>
                            <span className="shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1"
                                style={{ color: meta.color, background: meta.bg }}>
                                {meta.label}
                            </span>
                        </div>

                        {/* Set table */}
                        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,247,235,0.07)' }}>
                            {ex.set_targets?.map((s, j) => (
                                <div key={j}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '56px 1fr 1fr',
                                        alignItems: 'center',
                                        padding: '10px 16px',
                                        background: j % 2 ? 'transparent' : 'rgba(255,247,235,0.025)',
                                    }}>
                                    {/* Satz */}
                                    <span style={{ color: TEXT_DIM, fontSize: 12 }}>
                                        Satz {s.set_number}
                                    </span>
                                    {/* Gewicht × Reps — hard centred */}
                                    <span style={{ color: '#f2ece0', fontSize: 15, fontWeight: 600, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                        {s.weight_kg > 0 ? `${s.weight_kg} kg` : 'BW'}
                                        <span style={{ color: TEXT_DIM, fontWeight: 400, fontSize: 13 }}> × {s.reps}</span>
                                    </span>
                                    {/* Note — right aligned, wraps */}
                                    <span style={{ color: TEXT_DIM, fontSize: 11, textAlign: 'right', lineHeight: 1.3 }}>
                                        {s.note || ''}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Reasoning */}
                        {ex.reasoning && (
                            <p className="text-[12.5px] leading-relaxed italic" style={{ color: TEXT_DIM }}>
                                {ex.reasoning}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ── Streak tile ── */
function StreakTile({ label, icon, value, unit }: {
    label: string; icon: React.ReactNode; value: number; unit: string;
}) {
    return (
        <div className="card-forge p-3">
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: TEXT_DIM }}>
                {icon} {label}
            </div>
            <div className="text-[22px] font-semibold tabular-nums leading-none mt-1.5" style={{ color: '#f2ece0' }}>
                {value}
                <span className="text-[11px] font-normal ml-1" style={{ color: TEXT_DIM }}>{unit}</span>
            </div>
        </div>
    );
}

// end of file
