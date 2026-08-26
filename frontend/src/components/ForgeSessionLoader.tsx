import { Dumbbell, Sparkles } from 'lucide-react';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.54)';

export default function ForgeSessionLoader({ preparing }: { preparing: boolean }) {
  return <main className="forge-session-loader" role="status" aria-live="polite" aria-label={preparing ? 'Forge erstellt dein Coaching' : 'Forge lädt deine Session'}>
    <div className="forge-loader-orbit forge-loader-orbit-outer" />
    <div className="forge-loader-orbit forge-loader-orbit-inner" />
    <div className="forge-loader-core"><Dumbbell size={27} /></div>
    <div className="relative z-10 max-w-70 text-center">
      <div className="mx-auto mb-4 flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: SAND, background: 'rgba(232,197,138,0.10)', border: '1px solid rgba(232,197,138,0.20)' }}><Sparkles size={12} />Forge Coach</div>
      <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: TEXT }}>{preparing ? 'Deine Session wird vorbereitet' : 'Session wird geladen'}</h1>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: DIM }}>{preparing ? 'Forge verbindet deine echten Ergebnisse mit den heutigen Satz-Zielen.' : 'Dein Trainings-Snapshot wird sicher geladen.'}</p>
      {preparing && <div className="forge-loader-steps mt-7 text-left text-[11px]" style={{ color: DIM }}><span>Historie einordnen</span><span>Übungsziele prüfen</span><span>Coaching zusammenstellen</span></div>}
    </div>
  </main>;
}
