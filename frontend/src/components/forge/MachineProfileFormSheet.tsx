import { useMemo, useState } from 'react';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { createForgeMachineProfile, deleteForgeMachineProfile, updateForgeMachineProfile } from '../../api/api';
import type { ForgeExercise, ForgeLoadBasis, ForgeLoadingSystem, ForgeMachineProfile } from '../../api/api';
import ForgeSheet from '../ForgeSheet';
import ConfirmDialog from '../ConfirmDialog';
import { LOAD_BASES, LOADING_SYSTEMS, formatKg, machineCapable } from './labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';

const parseNumber = (raw: string) => {
  const value = Number(raw.trim().replace(/\s*kg$/i, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= 1000 ? Math.round(value * 1000) / 1000 : null;
};

const merge = (current: number[], extra: number[]) => [...new Set([...current, ...extra])].sort((a, b) => a - b).slice(0, 100);

interface Props {
  profile?: ForgeMachineProfile | null;
  /** Library exercises; machine/cable ones can be linked right here. Omit to leave links untouched. */
  exercises?: ForgeExercise[];
  initialExerciseIds?: string[];
  onSaved: (profile: ForgeMachineProfile) => void;
  onDeleted?: (profileId: string) => void;
  onClose: () => void;
}

/** Create or edit a machine profile: stack weights as chips (with a range generator) and linked exercises. */
export default function MachineProfileFormSheet({ profile, exercises, initialExerciseIds = [], onSaved, onDeleted, onClose }: Props) {
  const [name, setName] = useState(profile?.name ?? '');
  const [model, setModel] = useState(profile?.model ?? '');
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [loadingSystem, setLoadingSystem] = useState<ForgeLoadingSystem>(profile?.loading_system ?? 'selectorized');
  const [loadBasis, setLoadBasis] = useState<ForgeLoadBasis>(profile?.load_basis ?? 'displayed_total');
  const [weights, setWeights] = useState<number[]>(profile?.available_weights_kg ?? []);
  const [linked, setLinked] = useState<string[]>(profile?.exercise_ids ?? initialExerciseIds);
  const [single, setSingle] = useState('');
  const [range, setRange] = useState({ from: '', to: '', step: '' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkable = useMemo(() => (exercises ?? []).filter((exercise) => machineCapable(exercise.equipment)), [exercises]);

  const addSingle = () => {
    const values = single.split(/[;\s]+/).map(parseNumber).filter((value): value is number => value != null);
    if (!values.length) { setError('Gib ein Gewicht größer 0 ein, z. B. 12,5.'); return; }
    setWeights((current) => merge(current, values)); setSingle(''); setError(null);
  };

  const addRange = () => {
    const from = parseNumber(range.from); const to = parseNumber(range.to); const step = parseNumber(range.step);
    if (from == null || to == null || step == null || to < from) { setError('Bereich prüfen: von ≤ bis und Schritt größer 0.'); return; }
    const values: number[] = [];
    for (let value = from; value <= to + 1e-9 && values.length < 100; value += step) values.push(Math.round(value * 1000) / 1000);
    setWeights((current) => merge(current, values)); setRange({ from: '', to: '', step: '' }); setError(null);
  };

  const save = async () => {
    if (!name.trim()) { setError('Gib dem Gerät einen Namen.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        name: name.trim(), model: model.trim() || null, notes: notes.trim() || null,
        loading_system: loadingSystem, load_basis: loadBasis, available_weights_kg: weights,
        ...(exercises ? { exercise_ids: linked } : {}),
      };
      onSaved(profile ? await updateForgeMachineProfile(profile.id, payload) : await createForgeMachineProfile(payload));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Geräteprofil konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!profile) return;
    setSaving(true);
    try { await deleteForgeMachineProfile(profile.id); onDeleted?.(profile.id); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Geräteprofil konnte nicht entfernt werden.'); }
    finally { setSaving(false); setConfirmDelete(false); }
  };

  const label = 'mb-2 block text-[11px] font-medium uppercase tracking-wider';

  return <ForgeSheet label={profile ? 'Geräteprofil bearbeiten' : 'Neues Geräteprofil'} onClose={onClose} fullscreen>
    <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: BORDER }}>
      <div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Geräteprofil</p><h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>{profile ? profile.name : 'Neues Gerät'}</h2></div>
      <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
    </header>

    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
      <div className="space-y-3">
        <label className="block"><span className={label} style={{ color: DIM }}>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} className="input-forge h-12 w-full text-[15px]" placeholder="z. B. Latzug Life Fitness" /></label>
        <label className="block"><span className={label} style={{ color: DIM }}>Hersteller / Modell (optional)</span><input value={model} onChange={(event) => setModel(event.target.value)} maxLength={100} className="input-forge h-12 w-full text-[15px]" placeholder="z. B. Life Fitness Signature" /></label>
      </div>

      <section>
        <span className={label} style={{ color: DIM }}>Wie wird das Gewicht eingestellt?</span>
        <div className="grid grid-cols-2 gap-2">{LOADING_SYSTEMS.map((item) => {
          const selected = item.value === loadingSystem;
          return <button key={item.value} type="button" onClick={() => setLoadingSystem(item.value)} aria-pressed={selected} className="tap rounded-2xl p-3 text-left" style={{ background: selected ? 'rgba(232,197,138,0.1)' : 'rgba(255,247,235,0.03)', border: `1px solid ${selected ? `${SAND}77` : BORDER}` }}>
            <span className="block text-[13px] font-medium" style={{ color: selected ? SAND : TEXT }}>{item.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: DIM }}>{item.hint}</span>
          </button>;
        })}</div>
      </section>

      <section>
        <span className={label} style={{ color: DIM }}>Angezeigtes Gewicht gilt als</span>
        <div className="grid grid-cols-3 gap-2">{LOAD_BASES.map((item) => {
          const selected = item.value === loadBasis;
          return <button key={item.value} type="button" onClick={() => setLoadBasis(item.value)} aria-pressed={selected} className="tap rounded-xl px-2 py-3 text-[12.5px] font-medium" style={{ color: selected ? '#16130f' : TEXT, background: selected ? SAND : 'rgba(255,247,235,0.04)', border: `1px solid ${selected ? SAND : BORDER}` }}>{item.label}</button>;
        })}</div>
        <p className="mt-2 text-[11px]" style={{ color: DIM }}>{LOAD_BASES.find((item) => item.value === loadBasis)?.hint}</p>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: DIM }}>Gewichtsstufen · {weights.length}</span>{weights.length > 0 && <button type="button" onClick={() => setWeights([])} className="tap text-[12px]" style={{ color: DIM }}>Alle entfernen</button>}</div>
        <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: DIM }}>Der Coach schlägt am Gerät nur Gewichte vor, die hier stehen. Ohne Stufen nutzt er 2,5-kg-Schritte.</p>
        {weights.length > 0 ? <div className="flex flex-wrap gap-1.5">{weights.map((value) => <button key={value} type="button" onClick={() => setWeights((current) => current.filter((item) => item !== value))} aria-label={`${formatKg(value)} kg entfernen`} className="tap flex h-9 items-center gap-1 rounded-full pl-3 pr-2 text-[13px] font-medium tabular-nums" style={{ color: TEXT, background: 'rgba(232,197,138,0.1)', border: `1px solid ${SAND}33` }}>{formatKg(value)}<X size={13} style={{ color: DIM }} /></button>)}</div>
          : <p className="rounded-xl p-3 text-center text-[12px]" style={{ color: DIM, border: `1px dashed ${BORDER}` }}>Noch keine Stufen</p>}
        <div className="mt-3 flex gap-2">
          <input value={single} onChange={(event) => setSingle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSingle(); } }} inputMode="decimal" className="input-forge h-11 min-w-0 flex-1 text-[14px]" placeholder="Gewicht hinzufügen, z. B. 12,5" aria-label="Einzelnes Gewicht" />
          <button type="button" onClick={addSingle} aria-label="Gewicht hinzufügen" className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color: '#16130f', background: SAND }}><Plus size={18} /></button>
        </div>
        <div className="mt-2 rounded-2xl p-3" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}` }}>
          <p className="mb-2 text-[12px] font-medium" style={{ color: TEXT }}>Bereich erzeugen</p>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
            {(['from', 'to', 'step'] as const).map((key) => <label key={key} className="block min-w-0"><span className="mb-1 block text-[10.5px]" style={{ color: DIM }}>{key === 'from' ? 'von' : key === 'to' ? 'bis' : 'Schritt'}</span><input value={range[key]} onChange={(event) => setRange({ ...range, [key]: event.target.value })} inputMode="decimal" className="input-forge h-11 w-full !px-2 text-center text-[14px]" placeholder={key === 'from' ? '5' : key === 'to' ? '100' : '7,5'} /></label>)}
            <button type="button" onClick={addRange} className="tap h-11 rounded-xl px-3 text-[12.5px] font-medium" style={{ color: SAND, border: `1px solid ${SAND}55` }}>Hinzufügen</button>
          </div>
          <p className="mt-2 text-[10.5px]" style={{ color: DIM }}>Mehrere Bereiche kombinierbar, z. B. 5–50 in 7,5er-Schritten und 60–100 in 10er-Schritten.</p>
        </div>
      </section>

      {exercises && <section>
        <span className={label} style={{ color: DIM }}>Genutzt bei</span>
        {linkable.length ? <div className="flex flex-wrap gap-1.5">{linkable.map((exercise) => {
          const selected = linked.includes(exercise.id);
          return <button key={exercise.id} type="button" onClick={() => setLinked((current) => (selected ? current.filter((id) => id !== exercise.id) : [...current, exercise.id]))} aria-pressed={selected} className="tap flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px]" style={{ color: selected ? '#16130f' : TEXT, background: selected ? SAND : 'rgba(255,247,235,0.04)', border: `1px solid ${selected ? SAND : BORDER}` }}>{selected && <Check size={13} />}{exercise.name}</button>;
        })}</div> : <p className="text-[12px]" style={{ color: DIM }}>Noch keine Maschinen- oder Kabelzug-Übungen in deiner Bibliothek.</p>}
      </section>}

      <label className="block"><span className={label} style={{ color: DIM }}>Notizen (optional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={3} className="input-forge w-full resize-none text-[14px]" placeholder="Sitzposition, Polster, Besonderheiten" /></label>

      {profile && onDeleted && <button type="button" onClick={() => setConfirmDelete(true)} className="tap flex h-11 items-center gap-2 text-[13px]" style={{ color: '#fca5a5' }}><Trash2 size={15} />Geräteprofil entfernen</button>}
    </div>

    <footer className="space-y-2 border-t p-4" style={{ borderColor: BORDER, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      {error && <p className="rounded-xl px-3 py-2 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      <button type="button" onClick={() => void save()} disabled={saving} className="btn-forge flex h-12 w-full items-center justify-center gap-2 text-[14px]">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{profile ? 'Speichern' : 'Geräteprofil anlegen'}</button>
    </footer>
    <ConfirmDialog open={confirmDelete} busy={saving} destructive title="Geräteprofil entfernen?" description={profile ? `„${profile.name}“ wird von Übungen und Trainingstagen gelöst. Vergangene Sessions behalten ihre Daten.` : ''} confirmLabel="Entfernen" onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} />
  </ForgeSheet>;
}
