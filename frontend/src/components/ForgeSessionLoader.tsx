import { Dumbbell, Sparkles } from 'lucide-react';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.54)';

const STEPS = ['Historie einordnen', 'Übungsziele prüfen', 'Coaching zusammenstellen'];

export default function ForgeSessionLoader({ preparing }: { preparing: boolean }) {
  return <main className="card-forge forge-loader" role="status" aria-live="polite" aria-label={preparing ? 'Forge erstellt dein Coaching' : 'Forge lädt deine Session'} style={{ borderColor: `${SAND}2c` }}>
    <div className="forge-loader-mark"><Dumbbell size={22} /></div>
    <p className="forge-loader-tag"><Sparkles size={12} />Forge Coach</p>
    <h1 className="mt-2 text-[20px] font-semibold tracking-tight" style={{ color: TEXT }}>{preparing ? 'Deine Session wird vorbereitet' : 'Session wird geladen'}</h1>
    <p className="mt-2 max-w-72 text-[12.5px] leading-relaxed" style={{ color: DIM }}>{preparing ? 'Forge verbindet deine echten Ergebnisse mit den heutigen Satz-Zielen.' : 'Dein Trainings-Snapshot wird sicher geladen.'}</p>
    <div className="forge-loader-track" aria-hidden="true"><span /></div>
    {preparing && <ul className="forge-loader-steps" aria-hidden="true">{STEPS.map((step, index) => <li key={step} style={{ animationDelay: `${index * 0.9}s` }}>{step}</li>)}</ul>}
  </main>;
}
