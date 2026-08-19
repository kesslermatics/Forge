import { useState } from 'react';
import './preview.css';
import V1Forge from './variants/V1Forge';
import V2Apex from './variants/V2Apex';
import V3Pulse from './variants/V3Pulse';
import V4Cadence from './variants/V4Cadence';
import V5Iron from './variants/V5Iron';
import V6Momentum from './variants/V6Momentum';

type Variant = {
    id: string;
    name: string;
    tagline: string;
    accent: string;
    Comp: React.ComponentType;
};

const VARIANTS: Variant[] = [
    { id: 'forge', name: 'FORGE', tagline: 'Mono · maximal reduziert', accent: '#c6ff3d', Comp: V1Forge },
    { id: 'apex', name: 'APEX', tagline: 'Glas · Tiefe · sanft', accent: '#8b8bff', Comp: V2Apex },
    { id: 'pulse', name: 'PULSE', tagline: 'Energetisch · Bento', accent: '#ff6a3d', Comp: V3Pulse },
    { id: 'cadence', name: 'CADENCE', tagline: 'Ruhig · warm · lesbar', accent: '#e8c58a', Comp: V4Cadence },
    { id: 'iron', name: 'IRON', tagline: 'Editorial · Hochkontrast', accent: '#ffffff', Comp: V5Iron },
    { id: 'momentum', name: 'MOMENTUM', tagline: 'Aurora · fließend', accent: '#5eead4', Comp: V6Momentum },
];

export default function PreviewShowcase() {
    const [active, setActive] = useState(0);
    const V = VARIANTS[active];

    return (
        <div className="pv-root min-h-dvh w-full bg-[#050505] text-white flex flex-col">
            {/* ── Top control bar ─────────────────────────── */}
            <header className="sticky top-0 z-30 bg-[#050505]/85 backdrop-blur-xl border-b border-white/10">
                <div className="max-w-5xl mx-auto px-4 pt-3 pb-2">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold tracking-[0.2em] text-white/40 uppercase">
                                Design-Vorschau
                            </span>
                            <span className="text-xs text-white/25">·</span>
                            <span className="text-xs text-white/40">{active + 1} / {VARIANTS.length}</span>
                        </div>
                        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-white/35">
                            <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ background: V.accent, boxShadow: `0 0 10px ${V.accent}` }}
                            />
                            {V.tagline}
                        </div>
                    </div>

                    <div className="flex gap-2 overflow-x-auto pv-scroll -mx-1 px-1 pb-1">
                        {VARIANTS.map((v, i) => {
                            const on = i === active;
                            return (
                                <button
                                    key={v.id}
                                    onClick={() => setActive(i)}
                                    className="pv-tap shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-all"
                                    style={{
                                        borderColor: on ? v.accent : 'rgba(255,255,255,0.12)',
                                        background: on ? `${v.accent}1a` : 'transparent',
                                        color: on ? '#fff' : 'rgba(255,255,255,0.5)',
                                    }}
                                >
                                    <span className="tracking-wide">{v.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </header>

            {/* ── Stage ───────────────────────────────────── */}
            <main className="flex-1 w-full flex items-start justify-center px-0 sm:px-4 py-0 lg:py-8">
                {/* Phone frame on desktop, full-bleed on mobile */}
                <div className="pv-phone w-full sm:max-w-[400px] lg:max-w-[390px]">
                    {/* overflow-hidden on the FRAME only for the rounded border,
                        the inner scroll container handles touch scrolling */}
                    <div key={V.id} className="pv-screen relative w-full bg-black">
                        <div
                            className="pv-scroll-inner"
                            style={{
                                overflowY: 'auto',
                                overflowX: 'hidden',
                                WebkitOverflowScrolling: 'touch' as any,
                                height: '100%',
                                position: 'relative',
                            }}
                        >
                            <V.Comp />
                        </div>
                    </div>
                </div>
            </main>

            <style>{`
        /* Scrollbar hidden but functional */
        .pv-scroll-inner::-webkit-scrollbar { display: none; }
        .pv-scroll-inner { scrollbar-width: none; }

        /* Full-bleed on phones: header is ~104px */
        .pv-screen {
          height: calc(100dvh - 104px);
          overflow: hidden;
          border-radius: 0;
        }
        .pv-scroll-inner {
          height: calc(100dvh - 104px);
        }

        /* Device frame on desktop */
        @media (min-width: 1024px) {
          .pv-phone {
            border-radius: 44px;
            padding: 10px;
            background: linear-gradient(160deg, #2a2a2a, #0d0d0d);
            box-shadow: 0 40px 90px -20px rgba(0,0,0,0.9),
                        0 0 0 1px rgba(255,255,255,0.06) inset;
          }
          .pv-screen {
            border-radius: 34px;
            overflow: hidden;
            height: 812px;
          }
          .pv-scroll-inner {
            height: 812px;
          }
        }
      `}</style>
        </div>
    );
}
