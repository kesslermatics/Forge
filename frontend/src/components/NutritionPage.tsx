import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus, Sparkles, UtensilsCrossed } from 'lucide-react';

const SAND = '#e8c58a';
const TEXT_DIM = 'rgba(242,236,226,0.45)';

/** Placeholder until the nutrition overview is rebuilt on top of the native food tracking. */
export default function NutritionPage() {
    const navigate = useNavigate();
    return <div className="space-y-5">
        <header className="forge-anim flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,197,138,0.12)', color: SAND }}><UtensilsCrossed size={21} /></div>
            <div>
                <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>Ernährung</h1>
                <p className="text-[13px] mt-1" style={{ color: TEXT_DIM }}>Auswertungen und Trends</p>
            </div>
        </header>

        <section className="card-forge forge-anim forge-d1 flex flex-col items-center px-6 py-10 text-center" aria-label="Coming soon">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'rgba(232,197,138,0.1)', color: SAND }}><Sparkles size={24} /></span>
            <h2 className="mt-4 text-[20px] font-semibold tracking-tight" style={{ color: '#f2ece0' }}>Coming soon</h2>
            <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed" style={{ color: TEXT_DIM }}>
                Hier entsteht die neue Ernährungsübersicht. Tracken kannst du schon jetzt.
            </p>
        </section>

        <button type="button" onClick={() => navigate('/nutrition/track')} className="card-forge tap forge-anim forge-d2 flex w-full items-center gap-3 p-3.5 text-left" style={{ borderColor: `${SAND}33` }}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ color: '#16130f', background: SAND }}><Plus size={20} /></span>
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold" style={{ color: '#f2ece0' }}>Essen tracken</span>
                <span className="mt-0.5 block truncate text-[12px]" style={{ color: TEXT_DIM }}>Suche, Barcode oder zuletzt getrackt</span>
            </span>
            <ChevronRight size={17} className="shrink-0" style={{ color: SAND }} />
        </button>
    </div>;
}
