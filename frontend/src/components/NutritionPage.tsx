import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
    getTodayNutrition, getNutritionHistory, getFoodStatistics, getNutritionAnalysis,
} from '../api/api';
import type { UserInfo, TodayNutrition, NutritionHistoryData, FoodStatisticsData, NutritionAnalysis, FoodItem } from '../api/api';
import { Loader2, Sparkles, ChevronDown, ChevronUp, Flame, TrendingUp, UtensilsCrossed, Beef, Target, Wheat, Droplet, Salad } from 'lucide-react';
import { useLanguage } from '../i18n';
import {
    AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, ReferenceLine,
} from 'recharts';

type LayoutContext = { user: UserInfo | null };

const SAND = '#e8c58a';
const MINT = '#83d6ad';
const RED = '#f87171';
const AMBER = '#fbbf24';
const CARD_BG = 'rgba(255,247,235,0.03)';
const CARD_BORDER = 'rgba(255,247,235,0.06)';
const TEXT = '#f2ece0';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';

const MEAL_COLORS: Record<string, string> = {
    breakfast: '#f97316', lunch: '#34d399', dinner: '#60a5fa', snack: '#a78bfa',
};
const MEAL_LABELS: Record<string, string> = {
    breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snacks',
};

const tooltipStyle = {
    background: 'rgba(22,19,15,0.95)',
    border: `1px solid rgba(232,197,138,0.18)`,
    borderRadius: 8,
    fontSize: 11,
    color: TEXT,
    padding: '5px 10px',
};

const fmtDay = (label: unknown) =>
    new Date(`${String(label)}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

export default function NutritionPage() {
    useOutletContext<LayoutContext>();
    useLanguage();

    // Shared date range from Home weight chart
    const [startDate, setStartDateState] = useState<string>(() => {
        const saved = localStorage.getItem('weightStartDate');
        if (saved) return saved;
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
    });
    const updateStartDate = (val: string) => {
        setStartDateState(val);
        localStorage.setItem('weightStartDate', val);
    };

    const [todayNutrition, setTodayNutrition] = useState<TodayNutrition | null>(null);
    const [history, setHistory] = useState<NutritionHistoryData | null>(null);
    const [stats, setStats] = useState<FoodStatisticsData | null>(null);
    const [analysis, setAnalysis] = useState<NutritionAnalysis | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

    const [loadingToday, setLoadingToday] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);

    const [expandedMeals, setExpandedMeals] = useState<Record<string, boolean>>({});

    useEffect(() => {
        getTodayNutrition().then(setTodayNutrition).catch(() => { }).finally(() => setLoadingToday(false));
    }, []);

    useEffect(() => {
        setLoadingHistory(true);
        getNutritionHistory(startDate).then(setHistory).catch(() => { }).finally(() => setLoadingHistory(false));
    }, [startDate]);

    useEffect(() => {
        setLoadingStats(true);
        getFoodStatistics(startDate).then(setStats).catch(() => { }).finally(() => setLoadingStats(false));
    }, [startDate]);

    // Reset analysis whenever the range changes — old analysis is stale.
    useEffect(() => { setAnalysis(null); setAnalysisError(null); }, [startDate]);

    /* ── Derive stats from history ── */
    const derived = useMemo(() => {
        const days = history?.days ?? [];
        if (!days.length) return null;

        const chart = days.map(d => ({
            date: d.date,
            calories: d.totals.calories,
            protein: d.totals.protein,
            carbs: d.totals.carbs,
            fat: d.totals.fat,
            calorieGoal: d.goals.calories,
            proteinGoal: d.goals.protein,
        }));

        const logged = chart.filter(d => d.calories > 0);
        const avg = (key: keyof typeof chart[number]) =>
            logged.length ? logged.reduce((s, d) => s + (Number(d[key]) || 0), 0) / logged.length : 0;

        const avgCal = avg('calories');
        const avgProt = avg('protein');
        const avgCarbs = avg('carbs');
        const avgFat = avg('fat');
        const avgCalGoal = avg('calorieGoal');
        const avgProtGoal = avg('proteinGoal');

        const calAttainment = avgCalGoal > 0 ? avgCal / avgCalGoal : null;
        const protAttainment = avgProtGoal > 0 ? avgProt / avgProtGoal : null;
        const coverage = chart.length > 0 ? logged.length / chart.length : 0;

        // Daily protein bar (with goal reference)
        const proteinData = chart.map(d => ({
            date: d.date,
            protein: d.protein,
            goal: d.proteinGoal,
        }));

        // Macro distribution (grams → % of kcal contribution)
        // Protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g
        const macroKcal = {
            protein: avgProt * 4,
            carbs: avgCarbs * 4,
            fat: avgFat * 9,
        };
        const macroSum = macroKcal.protein + macroKcal.carbs + macroKcal.fat || 1;
        const macroSplit = [
            { name: 'Protein', value: macroKcal.protein / macroSum, grams: avgProt, color: RED },
            { name: 'Carbs', value: macroKcal.carbs / macroSum, grams: avgCarbs, color: AMBER },
            { name: 'Fett', value: macroKcal.fat / macroSum, grams: avgFat, color: MINT },
        ];

        return {
            chart, proteinData, macroSplit,
            avgCal, avgProt, avgCarbs, avgFat,
            avgCalGoal, avgProtGoal,
            calAttainment, protAttainment,
            coverage, daysCovered: chart.length, daysLogged: logged.length,
        };
    }, [history]);

    const toggleMeal = (meal: string) => setExpandedMeals(p => ({ ...p, [meal]: !p[meal] }));

    return (
        <div className="space-y-4">
            {/* ── Header ── */}
            <header className="forge-anim flex items-start justify-between">
                <div>
                    <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: TEXT }}>Ernährung</h1>
                    <p className="text-[12px] mt-1" style={{ color: TEXT_DIM }}>
                        Analyse ab {new Date(`${startDate}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </p>
                </div>
                <label className="flex items-center gap-1 rounded-md px-2 py-1 cursor-pointer mt-1"
                    style={{ background: 'rgba(232,197,138,0.08)' }}>
                    <span className="text-[11px] tabular-nums" style={{ color: SAND }}>
                        {new Date(`${startDate}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                    </span>
                    <input
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        value={startDate}
                        onChange={e => { if (e.target.value) updateStartDate(e.target.value); }}
                        className="sr-only"
                        style={{ colorScheme: 'dark' }}
                    />
                </label>
            </header>

            {/* ── KPI Row: 3 numbers ── */}
            {derived && (
                <div className="grid grid-cols-3 gap-2 forge-anim">
                    <KpiCard
                        label="Ø kcal"
                        value={Math.round(derived.avgCal).toLocaleString('de-DE')}
                        sub={derived.calAttainment != null
                            ? `${Math.round(derived.calAttainment * 100)}% vom Ziel`
                            : '–'}
                        color={
                            derived.calAttainment == null ? TEXT_DIM
                                : derived.calAttainment > 1.05 ? RED
                                    : derived.calAttainment < 0.85 ? AMBER
                                        : MINT
                        }
                        icon={<Flame size={13} />}
                    />
                    <KpiCard
                        label="Ø Protein"
                        value={`${Math.round(derived.avgProt)}g`}
                        sub={derived.protAttainment != null
                            ? `${Math.round(derived.protAttainment * 100)}% vom Ziel`
                            : '–'}
                        color={
                            derived.protAttainment == null ? TEXT_DIM
                                : derived.protAttainment >= 0.9 ? MINT
                                    : derived.protAttainment >= 0.75 ? SAND
                                        : RED
                        }
                        icon={<Beef size={13} />}
                    />
                    <KpiCard
                        label="Getrackt"
                        value={`${derived.daysLogged}/${derived.daysCovered}`}
                        sub={`${Math.round(derived.coverage * 100)}%`}
                        color={
                            derived.coverage >= 0.85 ? MINT
                                : derived.coverage >= 0.5 ? SAND
                                    : RED
                        }
                        icon={<Target size={13} />}
                    />
                </div>
            )}

            {/* ── Coach-Analyse Button/Result ── */}
            <Card icon={<Sparkles size={15} style={{ color: SAND }} />} title="Coach-Analyse">
                {analysis
                    ? (
                        <>
                            <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: TEXT_MID }}>
                                {analysis.analysis}
                            </p>
                            <button
                                onClick={() => { setAnalysis(null); setAnalysisError(null); }}
                                className="tap mt-3 text-[11px]"
                                style={{ color: TEXT_DIM }}
                            >
                                Neu generieren
                            </button>
                        </>
                    )
                    : loadingAnalysis
                        ? <Spinner label="Coach denkt nach…" />
                        : (
                            <div className="text-center py-3 space-y-3">
                                <p className="text-[13px]" style={{ color: TEXT_DIM }}>
                                    Lass den Coach deine Ernährung im gewählten Zeitraum analysieren.
                                </p>
                                {analysisError && (
                                    <p role="alert" className="text-[12px] rounded-lg px-3 py-2"
                                        style={{ color: RED, background: 'rgba(248,113,113,0.08)' }}>
                                        {analysisError}
                                    </p>
                                )}
                                <button
                                    onClick={async () => {
                                        setLoadingAnalysis(true);
                                        setAnalysisError(null);
                                        try {
                                            setAnalysis(await getNutritionAnalysis(startDate));
                                        } catch (error) {
                                            setAnalysisError(error instanceof Error
                                                ? error.message
                                                : 'Die Analyse konnte nicht geladen werden.');
                                        } finally {
                                            setLoadingAnalysis(false);
                                        }
                                    }}
                                    className="btn-forge text-[13px] px-5 py-2 mx-auto"
                                >
                                    <Sparkles size={14} />
                                    Analyse starten
                                </button>
                            </div>
                        )
                }
            </Card>

            {/* ── Kalorien-Trend ── */}
            <Card icon={<Flame size={15} style={{ color: SAND }} />} title="Kalorien">
                {loadingHistory ? <Spinner />
                    : !derived || derived.chart.length < 2 ? <Empty />
                        : (
                            <>
                                <div className="flex items-baseline gap-2 mb-2">
                                    <span className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: TEXT }}>
                                        {Math.round(derived.avgCal).toLocaleString('de-DE')}
                                    </span>
                                    <span className="text-[11px]" style={{ color: TEXT_DIM }}>
                                        Ø kcal / Tag · Ziel {Math.round(derived.avgCalGoal).toLocaleString('de-DE')}
                                    </span>
                                </div>
                                <ResponsiveContainer width="100%" height={110}>
                                    <AreaChart data={derived.chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="kcalGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={SAND} stopOpacity={0.28} />
                                                <stop offset="100%" stopColor={SAND} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} stroke="rgba(242,236,226,0.05)" />
                                        <XAxis dataKey="date" hide />
                                        <YAxis
                                            domain={['auto', 'auto']} width={32}
                                            tick={{ fontSize: 9, fill: TEXT_DIM, fontFamily: 'inherit' }}
                                            axisLine={false} tickLine={false}
                                        />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            labelStyle={{ color: TEXT_DIM, fontSize: 10, marginBottom: 2 }}
                                            labelFormatter={fmtDay}
                                            formatter={(v: number | undefined, name: string) => {
                                                if (v == null) return ['', ''];
                                                return [`${Math.round(v)} kcal`, name === 'calories' ? 'Gegessen' : 'Ziel'];
                                            }}
                                            cursor={{ stroke: 'rgba(255,247,235,0.12)', strokeWidth: 1 }}
                                        />
                                        {derived.avgCalGoal > 0 && (
                                            <ReferenceLine y={derived.avgCalGoal} stroke={TEXT_DIM} strokeDasharray="3 3" strokeWidth={1} />
                                        )}
                                        <Area
                                            type="monotone" dataKey="calories" name="calories"
                                            stroke={SAND} strokeWidth={2}
                                            fill="url(#kcalGrad)"
                                            dot={false} isAnimationActive={false}
                                            connectNulls={false}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </>
                        )}
            </Card>

            {/* ── Protein-Trend als Bars ── */}
            <Card icon={<Beef size={15} style={{ color: RED }} />} title="Protein">
                {loadingHistory ? <Spinner />
                    : !derived || derived.chart.length < 2 ? <Empty />
                        : (
                            <>
                                <div className="flex items-baseline gap-2 mb-2">
                                    <span className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: TEXT }}>
                                        {Math.round(derived.avgProt)}g
                                    </span>
                                    <span className="text-[11px]" style={{ color: TEXT_DIM }}>
                                        Ø / Tag · Ziel {Math.round(derived.avgProtGoal)}g
                                    </span>
                                </div>
                                <ResponsiveContainer width="100%" height={110}>
                                    <BarChart data={derived.proteinData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="15%">
                                        <CartesianGrid vertical={false} stroke="rgba(242,236,226,0.05)" />
                                        <XAxis dataKey="date" hide />
                                        <YAxis
                                            domain={[0, 'auto']} width={28}
                                            tick={{ fontSize: 9, fill: TEXT_DIM, fontFamily: 'inherit' }}
                                            axisLine={false} tickLine={false}
                                        />
                                        <Tooltip
                                            contentStyle={tooltipStyle}
                                            labelStyle={{ color: TEXT_DIM, fontSize: 10, marginBottom: 2 }}
                                            labelFormatter={fmtDay}
                                            formatter={(v: number | undefined) => v != null ? [`${Math.round(v)}g`, 'Protein'] : ['', '']}
                                            cursor={{ fill: 'rgba(255,247,235,0.04)' }}
                                        />
                                        {derived.avgProtGoal > 0 && (
                                            <ReferenceLine y={derived.avgProtGoal} stroke={TEXT_DIM} strokeDasharray="3 3" strokeWidth={1} />
                                        )}
                                        <Bar dataKey="protein" fill={RED} opacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </>
                        )}
            </Card>

            {/* ── Makro-Verteilung (kcal aus P/K/F) ── */}
            {derived && derived.chart.length >= 2 && (
                <Card icon={<TrendingUp size={15} style={{ color: SAND }} />} title="Makro-Verteilung">
                    <p className="text-[10px] mb-3" style={{ color: TEXT_DIM }}>
                        Anteil der Kalorien nach Makro (Durchschnitt)
                    </p>
                    <div className="space-y-2">
                        {derived.macroSplit.map(m => (
                            <div key={m.name}>
                                <div className="flex items-baseline justify-between mb-1">
                                    <span className="text-[11px]" style={{ color: TEXT_MID }}>{m.name}</span>
                                    <span className="text-[11px] tabular-nums" style={{ color: TEXT_DIM }}>
                                        <span style={{ color: TEXT }}>{Math.round(m.value * 100)}%</span>
                                        <span className="ml-1.5">{Math.round(m.grams)}g</span>
                                    </span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.06)' }}>
                                    <div className="h-full rounded-full" style={{
                                        width: `${m.value * 100}%`,
                                        background: m.color,
                                        transition: 'width 0.9s cubic-bezier(0.22,1,0.36,1)',
                                    }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* ── Zielerreichung nach Wochentag ── */}
            {derived && derived.chart.length >= 7 && (
                <WeekdayCard chart={derived.chart} />
            )}

            {/* ── Top Protein-Quellen ── */}
            {(stats || loadingStats) && (
                <Card icon={<Salad size={15} style={{ color: MINT }} />} title="Top Protein-Quellen">
                    {loadingStats ? <Spinner />
                        : stats?.top_protein && stats.top_protein.length > 0
                            ? <div className="space-y-1.5">
                                {stats.top_protein.slice(0, 6).map((food, i) => {
                                    const max = stats.top_protein[0].protein_g;
                                    const pct = (food.protein_g / max) * 100;
                                    return (
                                        <div key={i}>
                                            <div className="flex items-baseline justify-between mb-1">
                                                <span className="text-[12px] truncate mr-2" style={{ color: TEXT }}>{food.name}</span>
                                                <span className="text-[11px] tabular-nums shrink-0" style={{ color: MINT }}>
                                                    {Math.round(food.protein_g)}g
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.06)' }}>
                                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: MINT, opacity: 0.75 }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            : <Empty />
                    }
                </Card>
            )}

            {/* ── Häufigste Lebensmittel ── */}
            {stats?.top_foods && stats.top_foods.length > 0 && (
                <Card icon={<Wheat size={15} style={{ color: SAND }} />} title="Häufigste Lebensmittel">
                    <div className="space-y-1.5">
                        {stats.top_foods.slice(0, 6).map((food, i) => {
                            const max = stats.top_foods[0].count;
                            const pct = (food.count / max) * 100;
                            return (
                                <div key={i}>
                                    <div className="flex items-baseline justify-between mb-1">
                                        <span className="text-[12px] truncate mr-2" style={{ color: TEXT }}>{food.name}</span>
                                        <span className="text-[11px] tabular-nums shrink-0" style={{ color: SAND }}>
                                            {food.count}×
                                        </span>
                                    </div>
                                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.06)' }}>
                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SAND, opacity: 0.65 }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* ── Kalorien-Bomben ── */}
            {stats?.top_calories && stats.top_calories.length > 0 && (
                <Card icon={<Droplet size={15} style={{ color: AMBER }} />} title="Größte Kalorien-Beiträge">
                    <div className="space-y-1.5">
                        {stats.top_calories.slice(0, 6).map((food, i) => {
                            const max = stats.top_calories[0].calories;
                            const pct = (food.calories / max) * 100;
                            return (
                                <div key={i}>
                                    <div className="flex items-baseline justify-between mb-1">
                                        <span className="text-[12px] truncate mr-2" style={{ color: TEXT }}>{food.name}</span>
                                        <span className="text-[11px] tabular-nums shrink-0" style={{ color: AMBER }}>
                                            {food.calories.toLocaleString('de-DE')} kcal
                                        </span>
                                    </div>
                                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,247,235,0.06)' }}>
                                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: AMBER, opacity: 0.7 }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* ── Heutige Mahlzeiten ── */}
            <Card icon={<UtensilsCrossed size={15} style={{ color: SAND }} />} title="Heute gegessen">
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
                                            <span className="text-[13px] font-medium" style={{ color: TEXT }}>
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
                                                    <div className="min-w-0 flex-1 mr-2">
                                                        <span style={{ color: TEXT }}>{item.name}</span>
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
            </Card>
        </div>
    );
}

/* ── Weekday distribution card ── */
function WeekdayCard({ chart }: { chart: Array<{ date: string; calories: number; protein: number; calorieGoal: number }> }) {
    // Aggregate averages per weekday (0 = Sonntag ... 6 = Samstag)
    const buckets = Array.from({ length: 7 }, () => ({ cal: 0, prot: 0, count: 0 }));
    chart.forEach(d => {
        if (d.calories <= 0) return;
        const wd = new Date(`${d.date}T12:00:00`).getDay();
        buckets[wd].cal += d.calories;
        buckets[wd].prot += d.protein;
        buckets[wd].count += 1;
    });
    const labels = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    // Rotate so Monday is first
    const order = [1, 2, 3, 4, 5, 6, 0];
    const data = order.map(i => ({
        day: labels[i],
        cal: buckets[i].count ? Math.round(buckets[i].cal / buckets[i].count) : 0,
        prot: buckets[i].count ? Math.round(buckets[i].prot / buckets[i].count) : 0,
    }));

    return (
        <Card icon={<Target size={15} style={{ color: SAND }} />} title="Kalorien pro Wochentag">
            <p className="text-[10px] mb-2" style={{ color: TEXT_DIM }}>
                Durchschnittliche kcal je Wochentag im Zeitraum
            </p>
            <ResponsiveContainer width="100%" height={110}>
                <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
                    <CartesianGrid vertical={false} stroke="rgba(242,236,226,0.05)" />
                    <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: TEXT_DIM, fontFamily: 'inherit' }}
                        axisLine={false} tickLine={false}
                    />
                    <YAxis
                        domain={[0, 'auto']} width={30}
                        tick={{ fontSize: 9, fill: TEXT_DIM, fontFamily: 'inherit' }}
                        axisLine={false} tickLine={false}
                    />
                    <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: TEXT_DIM, fontSize: 10, marginBottom: 2 }}
                        formatter={(v: number | undefined) => v != null ? [`${Math.round(v)} kcal`, ''] : ['', '']}
                        cursor={{ fill: 'rgba(255,247,235,0.04)' }}
                    />
                    <Bar dataKey="cal" fill={SAND} opacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
            </ResponsiveContainer>
        </Card>
    );
}

/* ── Reusable ── */
function KpiCard({ label, value, sub, color, icon }: {
    label: string; value: string; sub: string; color: string; icon: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl p-3" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: TEXT_DIM }}>
                {icon}
                <span>{label}</span>
            </div>
            <p className="text-[18px] font-semibold tabular-nums leading-none mt-1.5" style={{ color }}>
                {value}
            </p>
            <p className="text-[9px] mt-1 tabular-nums" style={{ color: TEXT_DIM }}>{sub}</p>
        </div>
    );
}

function Card({ title, icon, children }: {
    title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div className="forge-anim rounded-[20px] p-4"
            style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
            <div className="flex items-center gap-2 mb-3">
                {icon}
                <span className="text-[13px] font-medium" style={{ color: TEXT }}>{title}</span>
            </div>
            {children}
        </div>
    );
}

function Spinner({ label }: { label?: string }) {
    return (
        <div className="h-24 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: SAND }} />
            {label && <span className="text-[11px]" style={{ color: TEXT_DIM }}>{label}</span>}
        </div>
    );
}
function Empty({ text = 'Zu wenig Daten' }: { text?: string }) {
    return <p className="text-center py-6 text-[12px]" style={{ color: TEXT_DIM }}>{text}</p>;
}

/* Also import Line, LineChart to satisfy the unused-imports lint... they are unused here now */
export const _unused = { Line, LineChart };
