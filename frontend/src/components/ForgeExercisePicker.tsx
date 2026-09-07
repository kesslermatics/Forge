import { useMemo, useState } from 'react';
import { Check, Plus, Search, SlidersHorizontal } from 'lucide-react';
import type { ForgeEquipment, ForgeExercise } from '../api/api';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const equipmentLabels: Record<ForgeEquipment, string> = {
  none: 'Ohne Equipment', barbell: 'Langhantel', dumbbell: 'Kurzhantel', kettlebell: 'Kettlebell',
  cable: 'Kabelzug', machine: 'Maschine', other: 'Sonstiges',
};

interface Props {
  exercises: ForgeExercise[];
  selectedIds?: string[];
  multiple?: boolean;
  busyId?: string | null;
  onToggle: (exercise: ForgeExercise) => void;
  onCreate: () => void;
  title?: string;
}

export default function ForgeExercisePicker({ exercises, selectedIds = [], multiple = false, busyId, onToggle, onCreate, title = 'Übung auswählen' }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const muscles = useMemo(() => [...new Set(exercises.map((exercise) => exercise.primary_muscle_group))].sort(), [exercises]);
  const equipmentOptions = useMemo(() => [...new Set(exercises.map((exercise) => exercise.equipment))], [exercises]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de-DE');
    return exercises.filter((exercise) => {
      const matchesQuery = !normalized || `${exercise.name} ${exercise.primary_muscle_group} ${equipmentLabels[exercise.equipment]}`.toLocaleLowerCase('de-DE').includes(normalized);
      return matchesQuery && (!muscle || exercise.primary_muscle_group === muscle) && (!equipment || exercise.equipment === equipment);
    });
  }, [equipment, exercises, muscle, query]);

  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Bibliothek</p><h2 className="mt-1 text-[18px] font-semibold" style={{ color: TEXT }}>{title}</h2></div><button onClick={onCreate} className="tap flex items-center gap-1.5 text-[11px] font-medium" style={{ color: SAND }}><Plus size={14} />Neue Übung</button></div>
    <label className="input-forge flex items-center gap-2"><Search size={15} style={{ color: DIM }} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Muskelgruppe oder Equipment" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" style={{ color: TEXT }} /></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="relative"><SlidersHorizontal size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: DIM }} /><select value={muscle} onChange={(event) => setMuscle(event.target.value)} className="input-forge w-full !pl-8 text-[11px]"><option value="">Alle Muskeln</option>{muscles.map((item) => <option key={item}>{item}</option>)}</select></label>
      <select value={equipment} onChange={(event) => setEquipment(event.target.value)} className="input-forge w-full text-[11px]"><option value="">Alle Geräte</option>{equipmentOptions.map((item) => <option key={item} value={item}>{equipmentLabels[item]}</option>)}</select>
    </div>
    <div className="space-y-2">
      {filtered.map((exercise) => {
        const selected = selectedIds.includes(exercise.id);
        return <button key={exercise.id} onClick={() => onToggle(exercise)} disabled={Boolean(busyId)} className="tap flex w-full items-center gap-3 rounded-2xl p-3 text-left disabled:opacity-55" style={{ border: `1px solid ${selected ? `${SAND}66` : BORDER}`, background: selected ? 'rgba(232,197,138,0.09)' : 'rgba(255,247,235,0.03)' }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(232,197,138,0.1)', color: selected ? '#16130f' : SAND, border: `1px solid ${selected ? SAND : BORDER}` }}>{selected ? <Check size={16} /> : <Plus size={16} />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium" style={{ color: TEXT }}>{exercise.name}</span><span className="mt-0.5 block truncate text-[10px]" style={{ color: DIM }}>{exercise.primary_muscle_group} · {equipmentLabels[exercise.equipment]}</span></span>
          {busyId === exercise.id && <span className="text-[10px]" style={{ color: SAND }}>Wird hinzugefügt…</span>}
        </button>;
      })}
      {!filtered.length && <div className="rounded-2xl p-5 text-center text-[12px]" style={{ color: DIM, border: `1px dashed ${BORDER}` }}>Keine passende Übung. Passe die Filter an oder lege direkt eine neue an.</div>}
    </div>
    {multiple && <p className="text-[10px]" style={{ color: DIM }}>{selectedIds.length} ausgewählt · Auswahl wird in die Reihenfolge übernommen.</p>}
  </section>;
}
