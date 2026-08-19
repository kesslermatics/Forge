import { useEffect, useState } from 'react';
import { getAchievements } from '../api/api';
import type { Achievement } from '../api/api';
import { Loader2, Lock } from 'lucide-react';
import { useLanguage } from '../i18n';

const SAND = '#e8c58a';
const CARD_BORDER = 'rgba(232,197,138,0.11)';
const TEXT_DIM = 'rgba(242,236,226,0.45)';
const TEXT_MID = 'rgba(242,236,226,0.7)';

const CAT_COLORS: Record<string, string> = {
    training: '#60a5fa', strength: '#a78bfa', nutrition: '#fbbf24',
    consistency: '#34d399', body: '#f87171',
};
const CAT_LABELS: Record<string, string> = {
    training: 'Training', strength: 'Kraft', nutrition: 'Ernährung',
    consistency: 'Konstanz', body: 'Körper',
};

export default function AchievementsTab() {
    const { lang } = useLanguage();
    const [achievements, setAchievements] = useState<Achievement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [catFilter, setCatFilter] = useState<string | null>(null);
    const [showLocked, setShowLocked] = useState(true);

    useEffect(() => {
        getAchievements()
            .then(setAchievements)
            .catch((e: any) => setError(e.message || 'Fehler'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: SAND }} />
        </div>
    );
    if (error) return (
        <p className="text-center py-16 text-red-400 text-[13px]">{error}</p>
    );

    const unlocked = achievements.filter(a => a.unlocked).length;
    const total = achievements.length;
    const pct = total > 0 ? unlocked / total : 0;
    const categories = [...new Set(achievements.map(a => a.category))];

    const filtered = achievements
        .filter(a => !catFilter || a.category === catFilter)
        .filter(a => showLocked || a.unlocked)
        .sort((a, b) => {
            if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
            return (b.progress / b.target) - (a.progress / a.target);
        });

    const ringC = 2 * Math.PI * 22;

    return (
        <div className="space-y-5">
            {/* Header */}
            <header className="forge-anim flex items-start justify-between">
                <div>
                    <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>
                        Erfolge
                    </h1>
                    <p className="text-[13px] mt-1" style={{ color: TEXT_DIM }}>
                        {unlocked} von {total} freigeschaltet
                    </p>
                </div>
                {/* Progress ring */}
                <div className="relative w-14 h-14 shrink-0">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,247,235,0.07)" strokeWidth="4" />
                        <circle cx="28" cy="28" r="22" fill="none" stroke={SAND} strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={`${pct * ringC} ${ringC}`} />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold"
                        style={{ color: SAND }}>
                        {Math.round(pct * 100)}%
                    </span>
                </div>
            </header>

            {/* Filters */}
            <div className="forge-anim forge-d1 flex items-center gap-2 flex-wrap">
                <button onClick={() => setCatFilter(null)}
                    className="tap text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{
                        background: !catFilter ? `${SAND}18` : 'rgba(255,247,235,0.04)',
                        border: `1px solid ${!catFilter ? `${SAND}33` : CARD_BORDER}`,
                        color: !catFilter ? SAND : TEXT_DIM,
                    }}>
                    Alle
                </button>
                {categories.map(c => (
                    <button key={c} onClick={() => setCatFilter(c === catFilter ? null : c)}
                        className="tap text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                        style={{
                            background: catFilter === c ? `${CAT_COLORS[c] || SAND}18` : 'rgba(255,247,235,0.04)',
                            border: `1px solid ${catFilter === c ? `${CAT_COLORS[c] || SAND}33` : CARD_BORDER}`,
                            color: catFilter === c ? (CAT_COLORS[c] || SAND) : TEXT_DIM,
                        }}>
                        {CAT_LABELS[c] || c}
                    </button>
                ))}
                <button onClick={() => setShowLocked(s => !s)}
                    className="tap text-[11px] px-3 py-1.5 rounded-full cursor-pointer ml-auto"
                    style={{
                        background: !showLocked ? `${SAND}18` : 'rgba(255,247,235,0.04)',
                        border: `1px solid ${!showLocked ? `${SAND}33` : CARD_BORDER}`,
                        color: !showLocked ? SAND : TEXT_DIM,
                    }}>
                    {showLocked ? 'Gesperrte ausblenden' : 'Alle zeigen'}
                </button>
            </div>

            {/* Grid */}
            {filtered.length === 0
                ? <p className="text-center py-12 text-[13px]" style={{ color: TEXT_DIM }}>
                    Keine Einträge in dieser Kategorie.
                </p>
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 forge-anim forge-d2">
                    {filtered.map(a => (
                        <AchievementCard key={a.id} a={a} lang={lang} />
                    ))}
                </div>
            }
        </div>
    );
}

function AchievementCard({ a, lang }: { a: Achievement; lang: string }) {
    const accentColor = CAT_COLORS[a.category] || SAND;
    const progress = Math.min(a.progress / Math.max(a.target, 1), 1);

    return (
        <div className="rounded-[20px] p-4 transition-all"
            style={{
                background: a.unlocked ? `${accentColor}0d` : 'rgba(255,247,235,0.025)',
                border: `1px solid ${a.unlocked ? `${accentColor}2a` : CARD_BORDER}`,
                opacity: a.unlocked ? 1 : 0.55,
            }}>
            <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{
                        background: a.unlocked ? `${accentColor}18` : 'rgba(255,247,235,0.06)',
                        border: `1px solid ${a.unlocked ? `${accentColor}28` : 'rgba(255,247,235,0.08)'}`,
                    }}>
                    {a.unlocked ? a.icon : <Lock size={15} style={{ color: TEXT_DIM }} />}
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-semibold truncate"
                        style={{ color: a.unlocked ? '#f2ece0' : TEXT_MID }}>
                        {lang === 'de' ? a.name_de : a.name_en}
                    </h3>
                    <p className="text-[11px] leading-relaxed mt-0.5"
                        style={{ color: TEXT_DIM }}>
                        {lang === 'de' ? a.desc_de : a.desc_en}
                    </p>

                    {/* Progress bar (locked only) */}
                    {!a.unlocked && (
                        <div className="mt-2 space-y-1">
                            <div className="h-1.5 rounded-full overflow-hidden"
                                style={{ background: 'rgba(255,247,235,0.07)' }}>
                                <div className="h-full rounded-full"
                                    style={{ width: `${progress * 100}%`, background: accentColor, opacity: 0.6 }} />
                            </div>
                            <p className="text-[10px]" style={{ color: TEXT_DIM }}>
                                {a.progress} / {a.target}
                            </p>
                        </div>
                    )}

                    {/* Unlock date */}
                    {a.unlocked && a.unlocked_date && (
                        <p className="text-[10px] mt-1.5" style={{ color: TEXT_DIM }}>
                            {new Date(a.unlocked_date).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                            })}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
