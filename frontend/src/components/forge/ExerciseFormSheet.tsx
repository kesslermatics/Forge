import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { createForgeExercise, generateForgeExerciseDraft, getForgeMachineProfiles, updateForgeExercise } from '../../api/api';
import type { ForgeEquipment, ForgeExercise, ForgeMachineProfile } from '../../api/api';
import ForgeSheet from '../ForgeSheet';
import EquipmentIcon from './EquipmentIcon';
import MachineProfileFormSheet from './MachineProfileFormSheet';
import { EQUIPMENT, MUSCLES, equipmentLabel, iconForEquipment, machineCapable, muscleLabel, similarExercises } from './labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';

interface Props {
  /** Edit this exercise; omit to create a new one. */
  exercise?: ForgeExercise | null;
  initialName?: string;
  library: ForgeExercise[];
  onSaved: (exercise: ForgeExercise) => void;
  /** Called when the user picks an existing look-alike instead of creating a duplicate. */
  onUseExisting?: (exercise: ForgeExercise) => void;
  onClose: () => void;
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className="tap flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px]" style={{ color: selected ? '#16130f' : TEXT, background: selected ? SAND : 'rgba(255,247,235,0.04)', border: `1px solid ${selected ? SAND : BORDER}` }}>{selected && <Check size={13} />}{children}</button>;
}

/** Create or edit an exercise with live duplicate detection and an optional AI draft. */
export default function ExerciseFormSheet({ exercise, initialName = '', library, onSaved, onUseExisting, onClose }: Props) {
  const editing = Boolean(exercise);
  const [name, setName] = useState(exercise?.name ?? initialName);
  const [equipment, setEquipment] = useState<ForgeEquipment>(exercise?.equipment ?? 'machine');
  const [primary, setPrimary] = useState(exercise?.primary_muscle_group ?? '');
  const [secondary, setSecondary] = useState<string[]>(exercise?.secondary_muscle_groups ?? []);
  const [profileIds, setProfileIds] = useState<string[]>(exercise?.machine_profiles.map((profile) => profile.id) ?? []);
  const [profiles, setProfiles] = useState<ForgeMachineProfile[]>([]);
  const [aiOpen, setAiOpen] = useState(!editing && !initialName);
  const [aiText, setAiText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [aiDuplicate, setAiDuplicate] = useState<ForgeExercise | null>(null);
  const [profileSheet, setProfileSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getForgeMachineProfiles().then(setProfiles).catch(() => undefined); }, []);

  const similar = useMemo(() => similarExercises(name, library, exercise?.id), [name, library, exercise?.id]);
  const duplicates = useMemo(() => {
    const list = aiDuplicate && !similar.some((item) => item.id === aiDuplicate.id) ? [aiDuplicate, ...similar] : similar;
    return list.slice(0, 3);
  }, [aiDuplicate, similar]);

  const draftWithAi = async () => {
    const text = aiText.trim();
    if (text.length < 3) { setError('Beschreib kurz, welche Übung du anlegen willst.'); return; }
    setDrafting(true); setError(null);
    try {
      const { draft } = await generateForgeExerciseDraft(text, []);
      setName(draft.name);
      setEquipment(draft.equipment);
      setPrimary(draft.primary_muscle_group);
      setSecondary(draft.secondary_muscle_groups);
      if (!machineCapable(draft.equipment)) setProfileIds([]);
      setAiDuplicate(library.find((item) => item.id === draft.duplicate_of) ?? null);
      setAiOpen(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Der KI-Entwurf hat nicht geklappt.');
    } finally { setDrafting(false); }
  };

  const save = async () => {
    if (!name.trim()) { setError('Gib der Übung einen Namen.'); return; }
    if (!primary) { setError('Wähl den Hauptmuskel.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        icon: exercise && exercise.equipment === equipment ? exercise.icon : iconForEquipment(equipment),
        equipment,
        primary_muscle_group: primary,
        secondary_muscle_groups: secondary.filter((item) => item !== primary),
        machine_profile_ids: machineCapable(equipment) ? profileIds : [],
      };
      onSaved(exercise ? await updateForgeExercise(exercise.id, payload) : await createForgeExercise(payload));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Übung konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const sectionLabel = 'mb-2 block text-[11px] font-medium uppercase tracking-wider';

  return <ForgeSheet label={editing ? 'Übung bearbeiten' : 'Neue Übung'} onClose={onClose} fullscreen>
    <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: BORDER }}>
      <div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Übungsbibliothek</p><h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>{editing ? 'Übung bearbeiten' : 'Neue Übung'}</h2></div>
      <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
    </header>

    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
      {!editing && <section className="rounded-2xl" style={{ background: 'rgba(232,197,138,0.06)', border: `1px solid ${SAND}33` }}>
        <button type="button" onClick={() => setAiOpen((open) => !open)} aria-expanded={aiOpen} className="tap flex w-full items-center gap-3 p-3.5 text-left">
          <Sparkles size={17} style={{ color: SAND }} />
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium" style={{ color: TEXT }}>Mit KI beschreiben</span><span className="block text-[11.5px]" style={{ color: DIM }}>Füllt alles aus und prüft, ob es die Übung schon gibt</span></span>
          <ChevronDown size={17} style={{ color: DIM, transform: aiOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
        {aiOpen && <div className="forge-expand space-y-2 px-3.5 pb-3.5">
          <textarea value={aiText} onChange={(event) => setAiText(event.target.value)} rows={2} maxLength={2000} className="input-forge w-full resize-none text-[14px]" placeholder="z. B. Brustgestütztes Rudern an der Maschine" />
          <button type="button" onClick={() => void draftWithAi()} disabled={drafting} className="btn-forge flex h-11 w-full items-center justify-center gap-2 text-[13.5px]">{drafting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Entwurf erstellen</button>
        </div>}
      </section>}

      <section>
        <label className="block"><span className={sectionLabel} style={{ color: DIM }}>Name</span>
          <input value={name} onChange={(event) => { setName(event.target.value); setAiDuplicate(null); }} maxLength={255} className="input-forge h-12 w-full text-[15px]" placeholder="z. B. Latzug eng" />
        </label>
        {duplicates.length > 0 && <div className="forge-expand mt-2 rounded-2xl p-3" style={{ background: 'rgba(244,180,106,0.08)', border: '1px solid rgba(244,180,106,0.3)' }}>
          <p className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: '#f4c48a' }}><AlertTriangle size={14} />{aiDuplicate ? 'Die gibt es wahrscheinlich schon' : 'Ähnlich in deiner Bibliothek'}</p>
          <div className="mt-2 space-y-1.5">{duplicates.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl p-2" style={{ background: 'rgba(22,19,15,0.5)' }}>
            <EquipmentIcon equipment={item.equipment} size={34} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px]" style={{ color: TEXT }}>{item.name}</span><span className="block text-[11px]" style={{ color: DIM }}>{muscleLabel(item.primary_muscle_group)} · {equipmentLabel(item.equipment)}</span></span>
            {onUseExisting && <button type="button" onClick={() => onUseExisting(item)} className="tap h-9 shrink-0 rounded-lg px-3 text-[12px] font-medium" style={{ color: '#16130f', background: SAND }}>Verwenden</button>}
          </div>)}</div>
        </div>}
      </section>

      <section>
        <span className={sectionLabel} style={{ color: DIM }}>Equipment</span>
        <div className="grid grid-cols-2 gap-2">{EQUIPMENT.map((item) => {
          const selected = equipment === item.value;
          return <button key={item.value} type="button" onClick={() => { setEquipment(item.value); if (!machineCapable(item.value)) setProfileIds([]); }} aria-pressed={selected} className="tap flex h-12 items-center gap-2.5 rounded-xl px-3 text-left text-[13.5px]" style={{ color: selected ? SAND : TEXT, background: selected ? 'rgba(232,197,138,0.1)' : 'rgba(255,247,235,0.03)', border: `1px solid ${selected ? `${SAND}77` : BORDER}` }}>
            <EquipmentIcon equipment={item.value} size={30} active={selected} />{item.label}
          </button>;
        })}</div>
      </section>

      <section>
        <span className={sectionLabel} style={{ color: DIM }}>Hauptmuskel</span>
        <div className="flex flex-wrap gap-1.5">{MUSCLES.map((muscle) => <Chip key={muscle} selected={primary === muscle} onClick={() => { setPrimary(muscle); setSecondary((current) => current.filter((item) => item !== muscle)); }}>{muscleLabel(muscle)}</Chip>)}</div>
      </section>

      <section>
        <span className={sectionLabel} style={{ color: DIM }}>Mittrainiert (optional)</span>
        <div className="flex flex-wrap gap-1.5">{MUSCLES.filter((muscle) => muscle !== primary && muscle !== 'Other').map((muscle) => {
          const selected = secondary.includes(muscle);
          return <Chip key={muscle} selected={selected} onClick={() => setSecondary((current) => (selected ? current.filter((item) => item !== muscle) : [...current, muscle]))}>{muscleLabel(muscle)}</Chip>;
        })}</div>
      </section>

      {machineCapable(equipment) && <section>
        <span className={sectionLabel} style={{ color: DIM }}>Geräteprofile</span>
        <p className="mb-2 text-[11.5px]" style={{ color: DIM }}>An welchen Geräten machst du die Übung? Der Coach kennt dann die echten Gewichtsstufen.</p>
        <div className="flex flex-wrap gap-1.5">
          {profiles.map((profile) => {
            const selected = profileIds.includes(profile.id);
            return <Chip key={profile.id} selected={selected} onClick={() => setProfileIds((current) => (selected ? current.filter((id) => id !== profile.id) : [...current, profile.id]))}>{profile.name}</Chip>;
          })}
          <button type="button" onClick={() => setProfileSheet(true)} className="tap flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px]" style={{ color: SAND, border: `1px dashed ${SAND}66` }}><Plus size={14} />Neues Gerät</button>
        </div>
      </section>}
    </div>

    <footer className="space-y-2 border-t p-4" style={{ borderColor: BORDER, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      {error && <p className="rounded-xl px-3 py-2 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
      <button type="button" onClick={() => void save()} disabled={saving || drafting} className="btn-forge flex h-12 w-full items-center justify-center gap-2 text-[14px]">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{editing ? 'Speichern' : duplicates.length ? 'Trotzdem neu anlegen' : 'Übung anlegen'}</button>
    </footer>

    {profileSheet && <MachineProfileFormSheet
      onClose={() => setProfileSheet(false)}
      onSaved={(profile) => { setProfiles((current) => [...current, profile].sort((a, b) => a.name.localeCompare(b.name))); setProfileIds((current) => [...current, profile.id]); setProfileSheet(false); }}
    />}
  </ForgeSheet>;
}
