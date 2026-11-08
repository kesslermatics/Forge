import { useCallback, useEffect, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
    getWeightHistory,
    getTrackDay, getConsistency, getActiveForgeSession, getForgeToday, startForgeSession, completeForgeCourse, deleteForgeSession,
} from '../api/api';
import type {
    UserInfo,
    WeightHistoryData, WeightHistoryEntry, WeightMeasurement, TrackDay, ConsistencyData, ForgeSession, ForgeToday,
} from '../api/api';
import {
    Loader2, Flame, Plus,
    Dumbbell, Scale, Target, UserRound,
} from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import ForgeAlternativeStartSheet from './ForgeAlternativeStartSheet';
import ForgePlanImagePreview from './ForgePlanImagePreview';
import WeightEntryCard from './WeightEntryCard';
import WeightJourney from './WeightJourney';
import DayNoteCard from './DayNoteCard';
import { MacroPills } from './track/shared';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';

type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

/* ── macro bar ── */
function MacroBar({ label, current, goal, color, limit = false, decimals = 0 }: { label: string; current: number; goal: number; color: string; limit?: boolean; decimals?: number }) {
    const pct = goal > 0 ? Math.min(current / goal, 1) : 0;
    const over = limit && current > goal;
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px]" style={{ color: TEXT_DIM }}>{label}</span>
                <span className="text-[11px] tabular-nums" style={{ color: TEXT_MID }}>
                    <span style={{ color: over ? '#fbbf24' : undefined }}>{current.toFixed(decimals)}</span><span style={{ color: TEXT_DIM }}>{limit ? ' von max. ' : '/'}{goal}g</span>
                </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.08)' }}>
                <div className="h-full rounded-full" style={{
                    width: `${pct * 100}%`,
                    background: over ? '#fbbf24' : color,
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
    const [weightLatest, setWeightLatest] = useState<WeightMeasurement | null>(null);
    const [weightToday, setWeightToday] = useState<WeightMeasurement[]>([]);
    const [trackDay, setTrackDay] = useState<TrackDay | null>(null);
    const [trackFailed, setTrackFailed] = useState(false);
    const [consistency, setConsistency] = useState<ConsistencyData | null>(null);
    const [forgeToday, setForgeToday] = useState<ForgeToday | null>(null);
    const [alternativePickerOpen, setAlternativePickerOpen] = useState(false);
    const [activeForgeSession, setActiveForgeSession] = useState<ForgeSession | null>(null);
    const [forgeError, setForgeError] = useState<string | null>(null);
    const [startingSession, setStartingSession] = useState(false);
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

    // The chart starts at the start date of the weight goal in the profile (last 90 days without one).
    const [weightGoal, setWeightGoal] = useState<WeightHistoryData['goal'] | null>(null);

    const refreshForgeDashboard = useCallback(() => {
        getForgeToday().then(setForgeToday).catch(() => { });
        getActiveForgeSession().then(setActiveForgeSession).catch(() => { });
    }, []);

    const loadWeights = useCallback(() => {
        getWeightHistory().then(d => { setWeightHistory(d.entries); setWeightLatest(d.latest); setWeightToday(d.today); setWeightGoal(d.goal); }).catch(() => { });
    }, []);

    useEffect(() => { loadWeights(); }, [loadWeights]);

    // A weighing saved by the entry card shows up right away; the chart and the day's list are reloaded.
    const handleWeightSaved = useCallback((entry: WeightMeasurement) => {
        setWeightLatest(previous => (!previous || entry.date >= previous.date ? entry : previous));
        loadWeights();
    }, [loadWeights]);

    useEffect(() => {
        getTrackDay(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))
            .then(setTrackDay).catch(() => setTrackFailed(true));
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

    const goals = trackDay?.goals ?? null;
    const calPct = trackDay && goals ? trackDay.totals.kcal / (goals.kcal || 1) : 0;
    const kcalLeft = trackDay && goals ? Math.round(goals.kcal - trackDay.totals.kcal) : 0;
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
            <header className="forge-anim flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-[13px]" style={{ color: TEXT_DIM }}>{greeting},</p>
                    <h1 className="truncate text-[28px] font-semibold tracking-tight leading-none mt-1" style={{ color: '#f2ece0' }}>
                        {user?.first_name || user?.username}
                    </h1>
                </div>
                {consistency && <ConsistencyDots data={consistency} />}
                <button type="button" onClick={() => navigate('/settings')} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.10)', border: '1px solid rgba(232,197,138,0.18)' }} aria-label="Profil und Einstellungen öffnen"><UserRound size={19} /></button>
            </header>

            {activeForgeSession ? (() => {
                const completedSets = activeForgeSession.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.completed).length;
                const totalSets = activeForgeSession.exercises.flatMap((exercise) => exercise.sets).length;
                return <section className="card-forge p-5 forge-anim forge-d1" style={{ borderColor: `${SAND}44` }}>
                    <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Aktive Session</p><h2 className="text-[20px] font-semibold tracking-tight mt-1" style={{ color: '#f2ece0' }}>{activeForgeSession.name}</h2>{activeForgeSession.description && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.72)' }}>{activeForgeSession.description}</p>}<p className="text-[12px] mt-1" style={{ color: TEXT_DIM }}>{completedSets}/{totalSets} Sätze abgeschlossen · sicher gespeichert</p></div><Dumbbell size={22} style={{ color: SAND }} /></div>
                    <div className="grid grid-cols-2 gap-2 mt-4"><button onClick={() => navigate(`/forge/session/${activeForgeSession.id}`)} className="btn-forge flex items-center justify-center gap-2"><Dumbbell size={15} />Fortsetzen</button><button onClick={() => setDiscardDialogOpen(true)} disabled={startingSession} className="tap rounded-xl text-[12px] font-medium cursor-pointer disabled:opacity-50" style={{ color: TEXT_DIM, border: `1px solid ${CARD_BORDER}` }}>Verwerfen</button></div>
                </section>;
            })() : canStartForgeTraining && (
                <section className={`card-forge relative overflow-hidden forge-anim forge-d1 ${homeRoutine?.has_image ? 'flex gap-2 p-1.5' : 'p-5'}`} style={{ borderColor: `${SAND}2c` }}>
                    {homeRoutine?.has_image && <ForgePlanImagePreview plan={homeRoutine} className="mx-1 w-20 self-stretch rounded-xl sm:w-28" />}
                    <div className={homeRoutine?.has_image ? 'min-w-0 flex-1 py-2 pr-3 pl-0' : 'relative'}>
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>{homeRoutine ? forgeToday?.mode === 'rotation' ? 'Als Nächstes' : 'Heute dran' : 'Ruhetag'}</p>
                                <h2 className="text-[20px] font-semibold tracking-tight mt-1" style={{ color: '#f2ece0' }}>{homeRoutine?.name ?? 'Heute ist kein Training geplant'}</h2>
                                {homeRoutine?.description?.trim() && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.72)' }}>{homeRoutine.description.trim()}</p>}
                                <p className="text-[12px] mt-1" style={{ color: TEXT_DIM }}>{homeRoutine ? homeRoutine.plan_type === 'course' ? `Kurs · ${homeRoutine.default_duration_minutes} Min. · ohne Tracking` : `${homeRoutine.exercises.length} Übungen · ${forgeToday?.mode === 'rotation' ? 'Rotation' : 'Wochenplan'}` : 'Du kannst trotzdem ein alternatives Training starten.'}</p>
                            </div>
                            <Dumbbell size={22} style={{ color: SAND }} />
                        </div>
                        {homeRoutine && <button onClick={() => void handleStartRoutine(homeRoutine)} disabled={startingSession} className="btn-forge mt-3 flex w-full min-w-0 items-center justify-center gap-2">{startingSession ? <Loader2 size={15} className="animate-spin" /> : <Dumbbell size={15} />}{homeRoutine.plan_type === 'course' ? 'Kurs als erledigt markieren' : 'Training starten'}</button>}
                        <button onClick={() => setAlternativePickerOpen(true)} disabled={startingSession} className="tap mt-1.5 w-full rounded-xl py-2 text-[11px] font-medium" style={{ color: TEXT_DIM, border: `1px solid ${CARD_BORDER}` }}>Alternatives Training starten</button>
                    </div>
                </section>
            )}
            {alternativePickerOpen && <ForgeAlternativeStartSheet plans={availableTrainingPlans} suggestedPlanId={homeRoutine?.id ?? null} startingPlan={startingSession} onStartPlan={(plan) => void handleStartRoutine(plan)} onSessionCreated={(session) => { setActiveForgeSession(session); setAlternativePickerOpen(false); navigate(`/forge/session/${session.id}?prepare=1`); }} onClose={() => setAlternativePickerOpen(false)} />}
            {forgeError && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{forgeError}</div>}
            <ConfirmDialog open={discardDialogOpen} busy={startingSession} destructive title="Aktive Session verwerfen?" description="Bereits eingetragene Sätze gehen verloren und können nicht wiederhergestellt werden." confirmLabel="Session verwerfen" onCancel={() => setDiscardDialogOpen(false)} onConfirm={() => { setDiscardDialogOpen(false); void handleDiscardForgeSession(); }} />


            <>
                {/* ── Ernährung heute (eigenes Tracking) ── */}
                {trackDay ? (
                    <section className="card-forge p-5 forge-anim forge-d1" aria-label="Ernährung heute">
                        <div className="flex items-center justify-between mb-4">
                            <button type="button" onClick={() => navigate('/settings#ziele')} className="tap flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px]" style={{ color: goals ? TEXT_DIM : SAND, background: 'rgba(232,197,138,0.08)' }}>
                                {goals ? <><Target size={11} />{kcalLeft >= 0 ? `${kcalLeft.toLocaleString('de-DE')} kcal übrig` : `${(-kcalLeft).toLocaleString('de-DE')} kcal drüber`}</> : <><Target size={11} />Ziele festlegen</>}
                            </button>
                            <button type="button" onClick={() => navigate('/nutrition/track')} className="tap flex h-9 items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-[12px] font-semibold" style={{ color: '#16130f', background: SAND }}>
                                <Plus size={15} />Tracken
                            </button>
                        </div>

                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-[42px] font-light leading-none tabular-nums" style={{ color: '#f2ece0' }}>
                                {Math.round(trackDay.totals.kcal).toLocaleString('de-DE')}
                            </span>
                            <span className="text-[15px]" style={{ color: TEXT_DIM }}>
                                {goals ? `/ ${goals.kcal.toLocaleString('de-DE')} kcal` : 'kcal'}
                            </span>
                        </div>

                        {goals ? <>
                            <div className="h-1.5 rounded-full overflow-hidden mb-5" style={{ background: 'rgba(255,247,235,0.08)' }}>
                                <div className="h-full rounded-full" style={{
                                    width: `${Math.min(calPct, 1) * 100}%`,
                                    background: calPct > 1.05 ? '#fbbf24' : SAND,
                                    transition: 'width 1s cubic-bezier(0.22,1,0.36,1)',
                                }} />
                            </div>
                            <div className="space-y-3">
                                <MacroBar label="Protein" current={trackDay.totals.protein} goal={goals.protein} color="#f87171" />
                                <MacroBar label="Carbs" current={trackDay.totals.carbs} goal={goals.carbs} color="#fbbf24" />
                                <MacroBar label="Fett" current={trackDay.totals.fat} goal={goals.fat} color="#34d399" />
                                {goals.sugar != null && <MacroBar label="Zucker" current={trackDay.totals.sugar} goal={goals.sugar} color="#c084fc" limit />}
                                {goals.salt != null && <MacroBar label="Salz" current={trackDay.totals.salt} goal={goals.salt} color="#60a5fa" limit decimals={1} />}
                                {goals.fiber != null && <MacroBar label="Ballaststoffe" current={trackDay.totals.fiber ?? 0} goal={goals.fiber} color="#b5d56a" />}
                            </div>
                        </> : <div className="mt-4"><MacroPills totals={trackDay.totals} /></div>}
                    </section>
                ) : !trackFailed && (
                    <div className="forge-skeleton h-[212px] rounded-3xl" aria-hidden="true" />
                )}
                {/* ── Gewicht eintragen ── */}
                <WeightEntryCard latest={weightLatest} today={weightToday} onSaved={handleWeightSaved} onDeleted={loadWeights} />

                {/* ── Tagesnotiz ── */}
                <DayNoteCard />

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
                                    {weightGoal?.target_kg != null && (
                                        <button type="button" onClick={() => navigate('/settings#ziele')} className="tap tabular-nums rounded-md px-1.5 py-0.5"
                                            style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}>
                                            Ziel {weightGoal.target_kg.toFixed(1)} kg{weightGoal.target_date ? ` · ${new Date(`${weightGoal.target_date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' })}` : ''}
                                        </button>
                                    )}

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
                            <div className="mt-3">
                                <WeightJourney entries={weightHistory} goal={weightGoal} />
                            </div>

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
