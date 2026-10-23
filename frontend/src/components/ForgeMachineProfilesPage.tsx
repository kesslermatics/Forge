import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, Plus, Settings2 } from 'lucide-react';
import { getForgeExercises, getForgeMachineProfiles } from '../api/api';
import type { ForgeExercise, ForgeMachineProfile } from '../api/api';
import MachineProfileFormSheet from './forge/MachineProfileFormSheet';
import { formatKg, loadBasisLabel, loadingLabel } from './forge/labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';

const weightSummary = (weights: number[]) => {
  if (!weights.length) return 'Keine Gewichtsstufen';
  const sorted = [...weights].sort((a, b) => a - b);
  return `${sorted.length} Stufen · ${formatKg(sorted[0])}–${formatKg(sorted.at(-1)!)} kg`;
};

export default function ForgeMachineProfilesPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') || '/forge/exercises';
  const [profiles, setProfiles] = useState<ForgeMachineProfile[]>([]);
  const [exercises, setExercises] = useState<ForgeExercise[]>([]);
  const [editing, setEditing] = useState<ForgeMachineProfile | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getForgeMachineProfiles(), getForgeExercises()])
      .then(([loadedProfiles, loadedExercises]) => { setProfiles(loadedProfiles); setExercises(loadedExercises); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Geräteprofile konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  const names = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise.name])), [exercises]);

  const saved = (profile: ForgeMachineProfile) => {
    setProfiles((current) => [...current.filter((item) => item.id !== profile.id), profile].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(null);
    // Linked exercises may have changed; refresh their profile lists.
    getForgeExercises().then(setExercises).catch(() => undefined);
  };

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

  return <div className="space-y-4 forge-anim">
    <header className="flex items-center gap-3">
      <button type="button" onClick={() => navigate(returnTo)} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label="Zurück" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1"><h1 className="text-[24px] font-semibold tracking-tight" style={{ color: TEXT }}>Geräteprofile</h1><p className="text-[12px]" style={{ color: DIM }}>Damit der Coach die echten Stufen deiner Geräte kennt</p></div>
      <button type="button" onClick={() => setEditing('new')} className="tap flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold" style={{ color: '#16130f', background: SAND }}><Plus size={16} />Neu</button>
    </header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <section className="space-y-2">{profiles.map((profile) => {
      const linked = profile.exercise_ids.map((id) => names.get(id)).filter(Boolean);
      const incomplete = !profile.available_weights_kg.length || profile.loading_system === 'unknown' || profile.load_basis === 'unknown';
      return <button key={profile.id} type="button" onClick={() => setEditing(profile)} className="card-forge tap flex w-full items-start gap-3 p-4 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><Settings2 size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium" style={{ color: TEXT }}>{profile.name}</span>
          <span className="mt-0.5 block truncate text-[12px]" style={{ color: DIM }}>{[profile.model, loadingLabel(profile.loading_system), loadBasisLabel(profile.load_basis)].filter(Boolean).join(' · ')}</span>
          <span className="mt-1 block text-[12px] tabular-nums" style={{ color: SAND }}>{weightSummary(profile.available_weights_kg)}</span>
          <span className="mt-1 block truncate text-[11.5px]" style={{ color: DIM }}>{linked.length ? `Für ${linked.join(', ')}` : 'Noch keiner Übung zugeordnet'}</span>
          {incomplete && <span className="mt-2 inline-block rounded-full px-2.5 py-1 text-[10.5px]" style={{ color: '#f4c48a', background: 'rgba(244,180,106,0.1)' }}>Unvollständig – Stufen oder Ladeart ergänzen</span>}
        </span>
        <ChevronRight size={17} className="mt-3 shrink-0" style={{ color: 'rgba(242,236,226,0.3)' }} />
      </button>;
    })}</section>

    {!profiles.length && <button type="button" onClick={() => setEditing('new')} className="w-full rounded-2xl border border-dashed p-7 text-center" style={{ borderColor: `${SAND}55`, color: SAND }}><Plus size={20} className="mx-auto" /><span className="mt-2 block text-[13px]">Erstes Geräteprofil anlegen</span><span className="mt-1 block text-[11.5px]" style={{ color: DIM }}>z. B. deinen Latzug mit allen Gewichtsstufen</span></button>}
    <p className="px-1 text-[11.5px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.38)' }}>Ein Profil kann mehreren Übungen gehören, z. B. ein Kabelturm für Rudern, Latzug und Trizepsdrücken. <span style={{ color: BORDER }}>·</span></p>

    {editing && <MachineProfileFormSheet
      profile={editing === 'new' ? null : editing}
      exercises={exercises}
      onClose={() => setEditing(null)}
      onSaved={saved}
      onDeleted={(id) => { setProfiles((current) => current.filter((item) => item.id !== id)); setEditing(null); }}
    />}
  </div>;
}
