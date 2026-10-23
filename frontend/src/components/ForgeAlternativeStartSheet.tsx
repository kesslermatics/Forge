import { useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, Dumbbell, ListPlus, Loader2, Sparkles, X } from 'lucide-react';
import { getForgeExercises, startForgeAiSession, startForgeCustomSession } from '../api/api';
import type { ForgeExercise, ForgePlan, ForgeSession } from '../api/api';
import ForgeSheet from './ForgeSheet';
import ExercisePickerSheet from './forge/ExercisePickerSheet';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.5)';
const BORDER = 'rgba(232,197,138,0.12)';

interface Props {
  plans: ForgePlan[];
  suggestedPlanId: string | null;
  startingPlan: boolean;
  onStartPlan: (plan: ForgePlan) => void;
  onSessionCreated: (session: ForgeSession) => void;
  onClose: () => void;
}

/** One-off start options: another routine, an empty session with picked exercises, or an AI-composed session. */
export default function ForgeAlternativeStartSheet({ plans, suggestedPlanId, startingPlan, onStartPlan, onSessionCreated, onClose }: Props) {
  const [mode, setMode] = useState<'menu' | 'pick'>('menu');
  const [library, setLibrary] = useState<ForgeExercise[] | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<'custom' | 'ai' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = startingPlan || busy !== null;

  const openPicker = () => {
    setMode('pick'); setError(null);
    if (!library) getForgeExercises().then(setLibrary).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Übungen konnten nicht geladen werden.'));
  };

  const startCustom = async (exerciseIds: string[]) => {
    if (!exerciseIds.length || locked) return;
    setBusy('custom'); setError(null);
    try { onSessionCreated(await startForgeCustomSession(exerciseIds)); }
    catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Session konnte nicht gestartet werden.');
      setMode('menu');
    }
    finally { setBusy(null); }
  };

  const startAi = async () => {
    const text = prompt.trim();
    if (text.length < 3 || locked) return;
    setBusy('ai'); setError(null);
    try { onSessionCreated(await startForgeAiSession(text)); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Die KI konnte gerade keine Session zusammenstellen.'); }
    finally { setBusy(null); }
  };

  const closeButton = <button type="button" onClick={onClose} disabled={busy !== null} className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40" aria-label="Auswahl schließen" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={17} /></button>;

  if (mode === 'pick') {
    if (!library) return <ForgeSheet label="Übungen laden" onClose={onClose}>
      <div className="flex justify-between"><button type="button" onClick={() => setMode('menu')} className="tap flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px]" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><ArrowLeft size={15} />Zurück</button>{closeButton}</div>
      {error ? <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>
        : <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: SAND }} /></div>}
    </ForgeSheet>;
    return <ExercisePickerSheet
      title="Leere Session starten"
      multiple
      exercises={library}
      busy={busy !== null}
      confirmLabel={(count) => (busy === 'custom' ? 'Session wird gestartet…' : count ? `Session mit ${count} ${count === 1 ? 'Übung' : 'Übungen'} starten` : 'Übungen auswählen')}
      onExerciseCreated={(exercise) => setLibrary((current) => [...(current ?? []), exercise])}
      onConfirm={(picked) => void startCustom(picked.map((exercise) => exercise.id))}
      onClose={() => { if (busy === null) setMode('menu'); }}
    />;
  }

  return <ForgeSheet label="Anderes Training" onClose={() => { if (busy === null) onClose(); }}>
    <div className="p-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Einmalige Auswahl</p>
          <h2 className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>Anderes Training</h2>
          <p className="mt-1 text-[11px]" style={{ color: DIM }}>Deine dauerhafte Routine bleibt unverändert.</p>
        </div>
        {closeButton}
      </div>

      {plans.length > 0 && <div className="mt-4 space-y-2">{plans.map((option) => <button key={option.id} type="button" onClick={() => onStartPlan(option)} disabled={locked} className="tap flex w-full items-center gap-3 rounded-2xl p-4 text-left disabled:opacity-55" style={{ border: `1px solid ${option.id === suggestedPlanId ? `${SAND}55` : BORDER}`, background: option.id === suggestedPlanId ? 'rgba(232,197,138,0.07)' : 'rgba(255,247,235,0.025)' }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{option.plan_type === 'course' ? <Clock3 size={18} /> : <Dumbbell size={18} />}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium" style={{ color: TEXT }}>{option.name}</span><span className="mt-0.5 block text-[10px]" style={{ color: DIM }}>{option.plan_type === 'course' ? `Kurs · ${option.default_duration_minutes} Min.` : `${option.exercises.length} Übungen`}{option.id === suggestedPlanId ? ' · vorgeschlagen' : ''}</span></span>
        <ChevronRight size={16} style={{ color: SAND }} />
      </button>)}</div>}

      <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em]" style={{ color: 'rgba(242,236,226,0.32)' }}><span className="h-px flex-1" style={{ background: BORDER }} />oder<span className="h-px flex-1" style={{ background: BORDER }} /></div>

      <button type="button" onClick={openPicker} disabled={locked} className="tap flex w-full items-center gap-3 rounded-2xl p-4 text-left disabled:opacity-55" style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,247,235,0.025)' }}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><ListPlus size={18} /></span>
        <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium" style={{ color: TEXT }}>Leere Session starten</span><span className="mt-0.5 block text-[11px]" style={{ color: DIM }}>Übungen selbst wählen, der Coach plant die Sätze</span></span>
        <ChevronRight size={16} style={{ color: SAND }} />
      </button>

      <div className="mt-3 rounded-2xl p-4" style={{ border: `1px solid ${SAND}33`, background: 'rgba(232,197,138,0.05)' }}>
        <label className="block">
          <span className="flex items-center gap-2 text-[14px] font-medium" style={{ color: TEXT }}><Sparkles size={16} style={{ color: SAND }} />Session von der KI</span>
          <span className="mt-0.5 block text-[11px]" style={{ color: DIM }}>Die KI wählt passende Übungen aus deiner Bibliothek.</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={locked}
            rows={3}
            maxLength={1000}
            placeholder="z. B. Rücken-Workout für 30 Minuten mit Latzug und Rudern"
            className="input-forge mt-3 min-h-[84px] resize-y text-[14px] leading-relaxed"
          />
        </label>
        <button type="button" onClick={() => void startAi()} disabled={prompt.trim().length < 3 || locked} className="btn-forge mt-3 flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-40">
          {busy === 'ai' ? <><Loader2 size={16} className="animate-spin" />KI stellt deine Session zusammen…</> : <><Sparkles size={16} />Session erstellen & starten</>}
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
    </div>
  </ForgeSheet>;
}
