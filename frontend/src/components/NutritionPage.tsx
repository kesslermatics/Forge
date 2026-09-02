import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
    getTodayNutrition, getNutritionHistory, getFoodStatistics, getNutritionAnalysis,
} from '../api/api';
import type { UserInfo, TodayNutrition, NutritionHistoryData, FoodStatisticsData, NutritionAnalysis, FoodItem } from '../api/api';
import { Loader2, Sparkles, ChevronDown, ChevronUp, Flame, TrendingUp, UtensilsCrossed, Beef } from 'lucide-react';
import { useLanguage } from '../i18n';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar,
} from 'recharts';

type LayoutContext = { user: UserInfo | null };

const SAND = '#e8c58a';
const CARD_BG = 'rgba(255,247,235,0.035)';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';
const CHART_STYLE = { backgroundColor: '#1c180d', border: '1px solid rgba(232,197,138,0.15)', borderRadius: 12 };
const AXIS_STYLE = { stroke: TEXT_DIM, fontSize: 11 };

const MEAL_COLORS: Record<string, string> = {
    breakfast: '#f97316', lunch: '#34d399', dinner: '#60a5fa', snack: '#a78bfa',
};
const MEAL_LABELS: Record<string, string> = {
    breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snacks',
};

export default function NutritionPage() {
    useOutletContext<LayoutContext>();
    const { lang } = useLanguage();

    const [todayNutrition, setTodayNutrition] = useState<TodayNutrition | null>(null);
    const [history, setHistory] = useState<NutritionHistoryData | null>(null);
    const [stats, setStats] = useState<FoodStatisticsData | null>(null);
    const [analysis, setAnalysis] = useState<NutritionAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

    const [loadingToday, setLoadingToday] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);

    const [historyDays, setHistoryDays] = useState(7);
    const [statsDays, setStatsDays] = useState(30);
    const [expandedMeals, setExpandedMeals] = useState<Record<string, boolean>>({});

    useEffect(() => {
        getTodayNutrition().then(setTodayNutrition).catch(() => { }).finally(() => setLoadingToday(false));
    }, []);

    useEffect(() => {
        setLoadingHistory(true);
        getNutritionHistory(historyDays).then(setHistory).catch(() => { }).finally(() => setLoadingHistory(false));
    }, [historyDays]);

    useEffect(() => {
        setLoadingStats(true);
        getFoodStatistics(statsDays).then(setStats).catch(() => { }).finally(() => setLoadingStats(false));
    }, [statsDays]);

    const chartData = history?.days?.map(d => ({
        date: new Date(d.date).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', day: 'numeric' }),
        calories: d.totals.calories,
        protein: d.totals.protein,
        carbs: d.totals.carbs,
        fat: d.totals.fat,
        calorieGoal: d.goals.calories,
    })) || [];

    const toggleMeal = (meal: string) => setExpandedMeals(p => ({ ...p, [meal]: !p[meal] }));

    return (
        <div className="space-y-5">
            <header className="forge-anim">
                <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>Ernährung</h1>
                <p className="text-[13px] mt-1" style={{ color: TEXT_DIM }}>Deine Makros im Überblick</p>
            </header>

            {/* ── Kalorien-Trend ── */}
            <ForgeCard title="Kalorien" icon={<Flame size={15} style={{ color: SAND }} />}
                right={<PeriodTabs value={historyDays} onChange={setHistoryDays} />}>
                {loadingHistory
                    ? <Spinner />
                    : chartData.length > 0
                        ? <ResponsiveContainer width="100%" height={180}>
                            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,247,235,0.06)" />
                                <XAxis dataKey="date" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={CHART_STYLE} labelStyle={{ color: '#f2ece0' }}
                                    formatter={(v) => [`${Math.round(Number(v))} kcal`, '']} />
                                <Line type="monotone" dataKey="calories" name="Kalorien"
                                    stroke={SAND} strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="calorieGoal" name="Ziel"
                                    stroke={TEXT_DIM} strokeWidth={1} strokeDasharray="4 4" dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                        : <Empty />
                }
            </ForgeCard>

            {/* ── Makro-Trend ── */}
            <ForgeCard title="Makros" icon={<TrendingUp size={15} style={{ color: SAND }} />}>
                {loadingHistory
                    ? <Spinner />
                    : chartData.length > 0
                        ? <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,247,235,0.06)" />
                                <XAxis dataKey="date" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                                <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={CHART_STYLE} labelStyle={{ color: '#f2ece0' }}
                                    formatter={(v) => [`${Math.round(Number(v))}g`, '']} />
                                <Line type="monotone" dataKey="protein" name="Protein" stroke="#f87171" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="carbs" name="Carbs" stroke="#fbbf24" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="fat" name="Fett" stroke="#34d399" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                        : <Empty />
                }
            </ForgeCard>

            {/* ── Heutige Mahlzeiten ── */}
            <ForgeCard title="Heute gegessen" icon={<UtensilsCrossed size={15} style={{ color: SAND }} />}>
                {loadingToday ? <Spinner /> : todayNutrition?.food_items
                    ? <div className="space-y-1.5">
                        {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(key => {
                            const items: FoodItem[] = todayNutrition.food_items?.[key] || [];
                            if (!items.length) return null;
                            const meal = todayNutrition.meals[key];
                            const open = expandedMeals[key];
                            return (
                                <div key={key} className="rounded-2xl overflow-hidden"
                                    style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${CARD_BORDER}` }}>
                                    <button onClick={() => toggleMeal(key)}
                                        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer tap">
                                        <div className="flex items-center gap-2.5">
                                            <span className="w-2.5 h-2.5 rounded-full shrink-0"
                                                style={{ background: MEAL_COLORS[key] }} />
                                            <span className="text-[13px] font-medium" style={{ color: '#f2ece0' }}>
                                                {MEAL_LABELS[key]}
                                            </span>
                                            <span className="text-[11px]" style={{ color: TEXT_DIM }}>
                                                {items.length} Artikel
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[12px] tabular-nums" style={{ color: SAND }}>
                                                {Math.round(meal?.calories || 0)} kcal
                                            </span>
                                            <span className="text-[11px]" style={{ color: TEXT_DIM }}>
                                                P {Math.round(meal?.protein || 0)}g
                                            </span>
                                            {open ? <ChevronUp size={14} style={{ color: TEXT_DIM }} />
                                                : <ChevronDown size={14} style={{ color: TEXT_DIM }} />}
                                        </div>
                                    </button>
                                    {open && (
                                        <div className="px-4 pb-3 space-y-1.5"
                                            style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
                                            {items.map((item, i) => (
                                                <div key={i} className="flex items-center justify-between py-1.5 text-[12px]">
                                                    <div>
                                                        <span style={{ color: '#f2ece0' }}>{item.name}</span>
                                                        {item.brand && <span style={{ color: TEXT_DIM }}> · {item.brand}</span>}
                                                        <span style={{ color: TEXT_DIM }}> · {item.amount}g</span>
                                                    </div>
                                                    <div className="flex gap-3 shrink-0" style={{ color: TEXT_DIM }}>
                                                        <span style={{ color: SAND }}>{Math.round(item.calories)} kcal</span>
                                                        <span>P {item.protein}g</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    : <Empty text="Keine Daten" />
                }
            </ForgeCard>

            {/* ── Top Lebensmittel ── */}
            {(stats || loadingStats) && (
                <ForgeCard title="Top Lebensmittel" icon={<Beef size={15} style={{ color: SAND }} />}
                    right={<PeriodTabs value={statsDays} onChange={setStatsDays} options={[7, 14, 30]} />}>
                    {loadingStats ? <Spinner /> : stats?.top_protein && stats.top_protein.length > 0
                        ? <>
                            <p className="text-[11px] uppercase tracking-[0.15em] mb-2" style={{ color: TEXT_DIM }}>
                                Top Protein-Quellen
                            </p>
                            <ResponsiveContainer width="100%" height={140}>
                                <BarChart
                                    data={stats.top_protein.slice(0, 6).map(f => ({ name: f.name.slice(0, 14), value: f.protein_g }))}
                                    layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,247,235,0.06)" horizontal={false} />
                                    <XAxis type="number" tick={AXIS_STYLE} axisLine={false} tickLine={false} />
                                    <YAxis type="category" dataKey="name" tick={{ ...AXIS_STYLE, fontSize: 10 }} width={90} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={CHART_STYLE} formatter={(v) => [`${Math.round(Number(v))}g`, 'Protein']} />
                                    <Bar dataKey="value" fill={SAND} radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </>
                        : <Empty />
                    }
                </ForgeCard>
            )}

            {/* ── KI-Analyse ── */}
            <ForgeCard title="Coach-Analyse" icon={<Sparkles size={15} style={{ color: SAND }} />}>
                {analysis
                    ? <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: TEXT_MID }}>
                        {analysis.analysis}
                    </p>
                    : loadingAnalysis
                        ? <Spinner />
                        : <div className="text-center py-4 space-y-3">
                            <p className="text-[13px]" style={{ color: TEXT_DIM }}>
                                Lass den Coach deine Ernährung analysieren.
                            </p>
                            {analysisError && <p role="alert" className="text-[13px]" style={{ color: '#fca5a5' }}>
                                {analysisError}
                            </p>}
                            <button onClick={async () => {
                                setLoadingAnalysis(true);
                                setAnalysisError(null);
                                try {
                                    setAnalysis(await getNutritionAnalysis());
                                } catch (error) {
                                    setAnalysisError(error instanceof Error
                                        ? error.message
                                        : 'Die Analyse konnte nicht geladen werden.');
                                } finally {
                                    setLoadingAnalysis(false);
                                }
                            }}
                                className="btn-forge text-sm px-5 py-2 mx-auto">
                                Analyse starten
                            </button>
                        </div>
                }
            </ForgeCard>
        </div>
    );
}

/* ── Shared sub-components ── */
function ForgeCard({ title, icon, right, children }: {
    title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="forge-anim rounded-[24px] p-5"
            style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-[14px] font-medium" style={{ color: '#f2ece0' }}>{title}</span>
                </div>
                {right}
            </div>
            {children}
        </div>
    );
}

function PeriodTabs({ value, onChange, options = [7, 14, 30] }: {
    value: number; onChange: (v: number) => void; options?: number[];
}) {
    return (
        <div className="flex gap-1">
            {options.map(d => (
                <button key={d} onClick={() => onChange(d)}
                    className="tap text-[11px] px-2.5 py-1 rounded-lg cursor-pointer transition-all"
                    style={{
                        background: value === d ? `${SAND}18` : 'transparent',
                        color: value === d ? SAND : TEXT_DIM,
                        border: `1px solid ${value === d ? `${SAND}33` : 'transparent'}`,
                    }}>
                    {d}T
                </button>
            ))}
        </div>
    );
}

function Spinner() {
    return (
        <div className="h-24 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: SAND }} />
        </div>
    );
}
function Empty({ text = 'Keine Daten' }: { text?: string }) {
    return <p className="text-center py-8 text-[13px]" style={{ color: TEXT_DIM }}>{text}</p>;
}
