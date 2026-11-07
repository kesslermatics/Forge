import { useCallback, useEffect, useRef, useState } from 'react';
import {
    AreaChart, Area, YAxis, XAxis, Tooltip,
    ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
    getWeightHistory,
    getTodayNutrition, getTrackDay, getConsistency, getActiveForgeSession, getForgeToday, startForgeSession, completeForgeCourse, deleteForgeSession,
} from '../api/api';
import type {
    UserInfo,
    WeightHistoryEntry, TodayNutrition, TrackDay, ConsistencyData, ForgeSession, ForgeToday,
} from '../api/api';
import {
    Loader2, Flame, Plus, ChevronRight,
    Dumbbell, Scale, Pencil,
} from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import ForgeAlternativeStartSheet from './ForgeAlternativeStartSheet';
import ForgePlanImagePreview from './ForgePlanImagePreview';
import WeightEntryCard from './WeightEntryCard';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

/* ── weight chart — Recharts ── */
function WeightChart({ entries }: { entries: WeightHistoryEntry[] }) {
    if (entries.length < 2) return null;

    // Daily weigh-ins swing with water and food; the line shows a centred 7-day trend
    // (±3 days by date, so gaps between weigh-ins are handled correctly).
    const DAY = 86_400_000;
    const times = entries.map(e => new Date(`${e.date}T12:00:00`).getTime());
    const trend = entries.map((_, index) => {
        const nearby = entries.filter((__, other) => Math.abs(times[other] - times[index]) <= 3 * DAY);
        return Math.round((nearby.reduce((sum, item) => sum + item.weight_kg, 0) / nearby.length) * 100) / 100;
    });

    // A minimum visible span keeps tiny fluctuations from filling the whole chart height.
    const MIN_SPAN_KG = 3;
    const rawMin = Math.min(...trend);
    const rawMax = Math.max(...trend);
    const centre = (rawMin + rawMax) / 2;
    const span = Math.max(rawMax - rawMin, MIN_SPAN_KG) * 1.2;
    const yMin = Math.floor((centre - span / 2) * 10) / 10;
    const yMax = Math.ceil((centre + span / 2) * 10) / 10;

    // 3 evenly-spaced ticks
    const mid = Math.round(((yMin + yMax) / 2) * 10) / 10;
    const yTicks = [yMin, mid, yMax];

    const data = entries.map((e, index) => ({
        date: e.date,
        kg: trend[index],
        actual: e.weight_kg,
    }));

    return (
        <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                    <linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SAND} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={SAND} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid
                    vertical={false}
                    stroke="rgba(242,236,226,0.06)"
                    strokeDasharray="0"
                />
                <XAxis dataKey="date" hide />
                <YAxis
                    domain={[yMin, yMax]}
                    ticks={yTicks}
                    tickFormatter={v => v.toFixed(1)}
                    tick={{ fontSize: 9, fill: 'rgba(242,236,226,0.35)', fontFamily: 'inherit' }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                />
                <Tooltip
                    contentStyle={{
                        background: 'rgba(30,24,18,0.92)',
                        border: `1px solid rgba(232,197,138,0.2)`,
                        borderRadius: 8,
                        fontSize: 11,
                        color: '#f2ece2',
                        padding: '4px 10px',
                    }}
                    itemStyle={{ color: SAND }}
                    labelStyle={{ color: 'rgba(242,236,226,0.45)', marginBottom: 2, fontSize: 10 }}
                    formatter={(v: number | undefined, _name: unknown, item: { payload?: { actual?: number } }) => v != null
                        ? `${v.toFixed(1)} kg Trend${item?.payload?.actual != null ? ` · gewogen ${item.payload.actual.toFixed(1)} kg` : ''}`
                        : ''}
                    labelFormatter={(label: unknown) => {
                        const s = String(label);
                        return new Date(`${s}T12:00:00`).toLocaleDateString('de-DE', {
                            day: 'numeric', month: 'short', year: 'numeric',
                        });
                    }}
                    cursor={{ stroke: 'rgba(232,197,138,0.3)', strokeWidth: 1 }}
                />
                <Area
                    type="basis"
                    dataKey="kg"
                    stroke={SAND}
                    strokeWidth={2.2}
                    fill="url(#wgrad)"
                    dot={false}
                    activeDot={{ r: 3.5, fill: SAND, strokeWidth: 0 }}
                    isAnimationActive={false}
                />
            </AreaChart>
        </ResponsiveContainer>
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

export default function Dashboard() {
    const { user } = useOutletContext<LayoutContext>();
    const navigate = useNavigate();

    const [weightHistory, setWeightHistory] = useState<WeightHistoryEntry[]>([]);
    const [weightLatest, setWeightLatest] = useState<WeightHistoryEntry | null>(null);
    const [todayNutrition, setTodayNutrition] = useState<TodayNutrition | null>(null);
    const [trackDay, setTrackDay] = useState<TrackDay | null>(null);
    const [consistency, setConsistency] = useState<ConsistencyData | null>(null);
    const [forgeToday, setForgeToday] = useState<ForgeToday | null>(null);
    const [alternativePickerOpen, setAlternativePickerOpen] = useState(false);
    const [activeForgeSession, setActiveForgeSession] = useState<ForgeSession | null>(null);
    const [forgeError, setForgeError] = useState<string | null>(null);
    const [startingSession, setStartingSession] = useState(false);
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

    // Weight chart range — persisted in localStorage
    const [weightStartDate, setWeightStartDate] = useState<string>(() => {
        const saved = localStorage.getItem('weightStartDate');
        if (saved) return saved;
        const d = new Date();
        d.setDate(d.getDate() - 90);
        return d.toISOString().slice(0, 10);
    });
    const weightInputRef = useRef<HTMLInputElement>(null);

    const updateWeightStartDate = (val: string) => {
        setWeightStartDate(val);
        localStorage.setItem('weightStartDate', val);
    };

    const refreshForgeDashboard = useCallback(() => {
        getForgeToday().then(setForgeToday).catch(() => { });
        getActiveForgeSession().then(setActiveForgeSession).catch(() => { });
    }, []);

    useEffect(() => {
        getWeightHistory(weightStartDate).then(d => { setWeightHistory(d.entries); setWeightLatest(d.latest); }).catch(() => { });
    }, [weightStartDate]);

    // A weight saved by the entry card appears in the chart right away, without a reload.
    const handleWeightSaved = useCallback((entry: WeightHistoryEntry) => {
        setWeightLatest(previous => (!previous || entry.date >= previous.date ? entry : previous));
        setWeightHistory(previous => {
            if (entry.date < weightStartDate) return previous;
            return [...previous.filter(item => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date));
        });
    }, [weightStartDate]);

    useEffect(() => {
        getTodayNutrition().then(setTodayNutrition).catch(() => { });
        getTrackDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
            .then(setTrackDay).catch(() => { });
        getConsistency().then(setConsistency).catch(() => { });
        refreshForgeDashboard();

        const berlinDay = () => new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        let observedDay = berlinDay();
        const refreshOnReturn = () => refreshForgeDashboard();
        const refreshOnVisible = () => { if (document.visibilityState === 'visible') refreshForgeDashboard(); };
        const dayCheck = window.setInterval(() => {
            const currentDay = berlinDay();
            if (currentDay !== observedDay) {
                observedDay = currentDay;
                refreshForgeDashboard();
            }
        }, 60_000);
        window.addEventListener('focus', refreshOnReturn);
        document.addEventListener('visibilitychange', refreshOnVisible);
        return () => {
            window.clearInterval(dayCheck);
            window.removeEventListener('focus', refreshOnReturn);
            document.removeEventListener('visibilitychange', refreshOnVisible);
        };
    }, [refreshForgeDashboard]);

    const hour = new Date().getHours();
    const greeting = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Servus' : 'Guten Abend';

    const nt = todayNutrition && !todayNutrition.error ? todayNutrition : null;
    const calPct = nt ? nt.totals.calories / (nt.goals.calories || 1) : 0;
    const weightValues = weightHistory.map(w => w.weight_kg);
    const weightCurrent = weightValues[weightValues.length - 1];
    const weightDelta = weightValues.length >= 2 ? weightCurrent - weightValues[0] : null;

    // Weekly average change: total delta / span in weeks
    const weightWeeklyAvg: number | null = (() => {
        if (weightHistory.length < 2) return null;
        const first = weightHistory[0];
        const last = weightHistory[weightHistory.length - 1];
        const daysDiff = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff < 7) return null;
        const weeks = daysDiff / 7;
        return (last.weight_kg - first.weight_kg) / weeks;
    })();
    const homeRoutine = forgeToday?.routine ?? null;
    const availableTrainingPlans = forgeToday?.program?.routines
        .map((routine) => routine.plan)
        .filter((plan, index, plans) => plans.findIndex((candidate) => candidate.id === plan.id) === index) ?? [];
    // Empty and AI-composed sessions are always possible, so the card is shown once today's data is loaded.
    const canStartForgeTraining = Boolean(forgeToday);

    const handleStartRoutine = async (routine: NonNullable<ForgeToday['routine']>) => {
        if (startingSession) return;
        setStartingSession(true); setForgeError(null);
        try {
            if (routine.plan_type === 'course') {
                await completeForgeCourse(routine.id, forgeToday?.program?.id);
                setForgeToday(await getForgeToday());
                setAlternativePickerOpen(false);
                return;
            }
            const session = await startForgeSession(routine.id, forgeToday?.program?.id);
            setActiveForgeSession(session.status === 'active' ? session : null);
            setAlternativePickerOpen(false);
            navigate(`/forge/session/${session.id}?prepare=1`);
        } catch (caught: unknown) {
            setForgeError(caught instanceof Error ? caught.message : routine.plan_type === 'course' ? 'Kurs konnte nicht als erledigt markiert werden.' : 'Session konnte nicht gestartet werden.');
        } finally { setStartingSession(false); }
    };

    const handleDiscardForgeSession = async () => {
        if (!activeForgeSession || startingSession) return;
        setStartingSession(true); setForgeError(null);
        try {
            await deleteForgeSession(activeForgeSession.id);
            setActiveForgeSession(null);
            refreshForgeDashboard();
        } catch (caught: unknown) {
            setForgeError(caught instanceof Error ? caught.message : 'Session konnte nicht verworfen werden.');
        } finally { setStartingSession(false); }
    };

    return (
        <div className="space-y-4">
            {/* ── Greeting ── */}
            <header className="forge-anim flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[13px]" style={{ color: TEXT_DIM }}>{greeting},</p>
                    <h1 className="truncate text-[28px] font-semibold tracking-tight leading-none mt-1" style={{ color: '#f2ece0' }}>
                        {user?.first_name || user?.username}
                    </h1>
                </div>
                {consistency && <ConsistencyDots data={consistency} />}
            </header>

            {activeForgeSession ? (() => {
                const completedSets = activeForgeSession.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.completed).length;
                const totalSets = activeForgeSession.exercises.flatMap((exercise) => exercise.sets).length;
                return <section className="card-forge p-5 forge-anim forge-d1" style={{ borderColor: `${SAND}44` }}>
                    <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Aktive Session</p><h2 className="text-[20px] font-semibold tracking-tight mt-1" style={{ color: '#f2ece0' }}>{activeForgeSession.name}</h2>{activeForgeSession.description && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.72)' }}>{activeForgeSession.description}</p>}<p className="text-[12px] mt-1" style={{ color: TEXT_DIM }}>{completedSets}/{totalSets} Sätze abgeschlossen · sicher gespeichert</p></div><Dumbbell size={22} style={{ color: SAND }} /></div>
                    <div className="grid grid-cols-2 gap-2 mt-4"><button onClick={() => navigate(`/forge/session/${activeForgeSession.id}`)} className="btn-forge flex items-center justify-center gap-2"><Dumbbell size={15} />Fortsetzen</button><button onClick={() => setDiscardDialogOpen(true)} disabled={startingSession} className="tap rounded-xl text-[12px] font-medium cursor-pointer disabled:opacity-50" style={{ color: TEXT_DIM, border: `1px solid ${CARD_BORDER}` }}>Verwerfen</button></div>
                </section>;
            })() : canStartForgeTraining && (
                <section className={`card-forge relative overflow-hidden forge-anim forge-d1 ${homeRoutine?.has_image ? 'flex gap-2 p-2' : 'p-5'}`} style={{ borderColor: `${SAND}2c` }}>
                    {homeRoutine?.has_image && <ForgePlanImagePreview plan={homeRoutine} className="mx-1 w-24 self-stretch rounded-xl sm:w-32" />}
                    <div className={homeRoutine?.has_image ? 'min-w-0 flex-1 py-3 pr-3 pl-0' : 'relative'}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{homeRoutine ? forgeToday?.mode === 'rotation' ? 'Als Nächstes' : 'Heute dran' : 'Ruhetag'}</p>
                                <h2 className="text-[20px] font-semibold tracking-tight mt-1" style={{ color: '#f2ece0' }}>{homeRoutine?.name ?? 'Heute ist kein Training geplant'}</h2>
                                {homeRoutine?.description?.trim() && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.72)' }}>{homeRoutine.description.trim()}</p>}
                                <p className="text-[12px] mt-1" style={{ color: TEXT_DIM }}>{homeRoutine ? homeRoutine.plan_type === 'course' ? `Kurs · ${homeRoutine.default_duration_minutes} Min. · ohne Tracking` : `${homeRoutine.exercises.length} Übungen · ${forgeToday?.mode === 'rotation' ? 'Rotation' : 'Wochenplan'}` : 'Du kannst trotzdem ein alternatives Training starten.'}</p>
                            </div>
                            <Dumbbell size={22} style={{ color: SAND }} />
                        </div>
                        {homeRoutine && <button onClick={() => void handleStartRoutine(homeRoutine)} disabled={startingSession} className="btn-forge mt-4 flex w-full min-w-0 items-center justify-center gap-2">{startingSession ? <Loader2 size={15} className="animate-spin" /> : <Dumbbell size={15} />}{homeRoutine.plan_type === 'course' ? 'Kurs als erledigt markieren' : 'Training starten'}</button>}
                        <button onClick={() => setAlternativePickerOpen(true)} disabled={startingSession} className="tap mt-2 w-full rounded-xl py-2.5 text-[11px] font-medium" style={{ color: TEXT_DIM, border: `1px solid ${CARD_BORDER}` }}>Alternatives Training starten</button>
                    </div>
                </section>
            )}
            {alternativePickerOpen && <ForgeAlternativeStartSheet plans={availableTrainingPlans} suggestedPlanId={homeRoutine?.id ?? null} startingPlan={startingSession} onStartPlan={(plan) => void handleStartRoutine(plan)} onSessionCreated={(session) => { setActiveForgeSession(session); setAlternativePickerOpen(false); navigate(`/forge/session/${session.id}?prepare=1`); }} onClose={() => setAlternativePickerOpen(false)} />}
            {forgeError && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{forgeError}</div>}
            <ConfirmDialog open={discardDialogOpen} busy={startingSession} destructive title="Aktive Session verwerfen?" description="Bereits eingetragene Sätze gehen verloren und können nicht wiederhergestellt werden." confirmLabel="Session verwerfen" onCancel={() => setDiscardDialogOpen(false)} onConfirm={() => { setDiscardDialogOpen(false); void handleDiscardForgeSession(); }} />


            <>
                {/* ── Food tracking entry point ── */}
                <button type="button" onClick={() => navigate('/nutrition/track')} className="card-forge tap forge-anim forge-d1 flex w-full items-center gap-3 p-3.5 text-left" style={{ borderColor: `${SAND}33` }}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ color: '#16130f', background: SAND }}><Plus size={20} /></span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold" style={{ color: '#f2ece0' }}>Essen tracken</span>
                        <span className="mt-0.5 block truncate text-[12px] tabular-nums" style={{ color: TEXT_DIM }}>
                            {trackDay && trackDay.entry_count > 0
                                ? `Heute ${Math.round(trackDay.totals.kcal).toLocaleString('de-DE')} kcal · ${Math.round(trackDay.totals.protein)} g Protein`
                                : 'Suche, Barcode oder zuletzt getrackt'}
                        </span>
                    </span>
                    <ChevronRight size={17} className="shrink-0" style={{ color: SAND }} />
                </button>

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

                {/* ── Gewicht eintragen ── */}
                <WeightEntryCard latest={weightLatest} onSaved={handleWeightSaved} />

                {/* ── Gewichtsverlauf ── */}
                {weightValues.length > 0 && (
                    <section className="forge-anim forge-d2">
                        <div className="card-forge p-3">

                            {/* ── Header row: icon + label | date input | delta ── */}
                            <div className="flex items-center justify-between text-[11px]" style={{ color: TEXT_DIM }}>
                                <div className="flex items-center gap-1.5">
                                    <Scale size={12} />
                                    <span>Gewicht</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Date picker — always visible */}
                                    <label className="flex items-center gap-1 rounded-md px-1.5 py-0.5 cursor-pointer"
                                        style={{ background: 'rgba(232,197,138,0.08)' }}>
                                        <Pencil size={9} style={{ color: TEXT_DIM }} />
                                        <span className="tabular-nums" style={{ color: TEXT_DIM }}>
                                            {new Date(`${weightStartDate}T12:00:00`).toLocaleDateString('de-DE', {
                                                day: 'numeric', month: 'short', year: '2-digit',
                                            })}
                                        </span>
                                        <input
                                            ref={weightInputRef}
                                            type="date"
                                            max={new Date().toISOString().slice(0, 10)}
                                            value={weightStartDate}
                                            onChange={e => { if (e.target.value) updateWeightStartDate(e.target.value); }}
                                            className="sr-only"
                                            style={{ colorScheme: 'dark' }}
                                        />
                                    </label>

                                    {/* Total delta */}
                                    {weightDelta !== null && (
                                        <span style={{ color: weightDelta < 0 ? '#34d399' : SAND }}>
                                            {weightDelta > 0 ? '+' : ''}{weightDelta.toFixed(1)} kg
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* ── Current weight ── */}
                            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1.5" style={{ color: '#f2ece0' }}>
                                {weightCurrent?.toFixed(1)}
                                <span className="text-[11px] font-normal ml-0.5" style={{ color: TEXT_DIM }}>kg</span>
                            </div>

                            {/* ── Chart ── */}
                            {weightHistory.length >= 4 && (
                                <div className="mt-2">
                                    <WeightChart entries={weightHistory} />
                                </div>
                            )}

                            {/* ── Weekly avg change ── */}
                            {weightWeeklyAvg !== null && (
                                <div className="mt-2 text-[10px] tabular-nums" style={{ color: '#4ade80' }}>
                                    Ø {weightWeeklyAvg > 0 ? '+' : ''}{(weightWeeklyAvg * 1000).toFixed(0)} g / Woche
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </>
        </div>
    );
}

/* ── 14-day consistency dots (header, right of the name) ── */
function ConsistencyDots({ data }: { data: ConsistencyData }) {
    const today = data.days[data.days.length - 1]?.date;
    const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    const rows = [
        { key: 'nutrition' as const, label: 'Ernährung', icon: <Flame size={9} />, done: 'getrackt', active: (day: ConsistencyData['days'][number]) => day.nutrition },
        { key: 'training' as const, label: 'Training', icon: <Dumbbell size={9} />, done: 'Training erledigt', active: (day: ConsistencyData['days'][number]) => day.training },
    ];
    const count = (active: (day: ConsistencyData['days'][number]) => boolean) => data.days.filter(active).length;
    const summary = `Letzte ${data.days.length} Tage: Ernährung an ${count(rows[0].active)} Tagen, Training an ${count(rows[1].active)} Tagen. `
        + `Ernährungs-Streak ${data.nutrition_streak_days} Tage, Trainings-Streak ${data.training_streak_weeks} Wochen.`;

    return <div role="img" aria-label={summary} className="flex shrink-0 flex-col gap-[5px]" title={`Letzte ${data.days.length} Tage`}>
        {rows.map((row) => <div key={row.key} className="flex items-center gap-1.5">
            <span style={{ color: TEXT_DIM }} aria-hidden="true">{row.icon}</span>
            <div className="flex gap-[3px]">{data.days.map((day, index) => {
                const active = row.active(day);
                const isToday = day.date === today;
                return <span key={`${row.key}-${day.date}`} title={`${dateLabel(day.date)}: ${active ? row.done : 'nicht erfasst'}`}
                    className="consistency-dot h-[7px] w-[7px] rounded-full"
                    style={{
                        animationDelay: `${index * 30 + (row.key === 'training' ? 80 : 0)}ms`,
                        background: active ? '#4ade80' : 'rgba(242,236,226,0.1)',
                        boxShadow: active ? '0 0 6px rgba(74,222,128,0.4)' : isToday ? `0 0 0 1px ${SAND}99` : 'none',
                    }} />;
            })}</div>
        </div>)}
    </div>;
}

// end of file
