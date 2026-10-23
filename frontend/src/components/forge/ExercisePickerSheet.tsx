import { useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { ForgeExercise } from '../../api/api';
import ForgeSheet from '../ForgeSheet';
import EquipmentIcon from './EquipmentIcon';
import ExerciseFormSheet from './ExerciseFormSheet';
import { EQUIPMENT, equipmentLabel, muscleLabel, muscleOrder, relativeDays } from './labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';
const RECENT_LIMIT = 6;

interface Props {
  exercises: ForgeExercise[];
  title: string;
  /** Multi-select with a confirm button; otherwise a tap picks immediately. */
  multiple?: boolean;
  /** Exercises shown but not selectable (e.g. already in the plan). */
  disabledIds?: string[];
  disabledLabel?: string;
  /** Muscle group shown first, e.g. the muscle of the exercise being replaced. */
  preferMuscle?: string | null;
  confirmLabel?: (count: number) => string;
  busy?: boolean;
  onPick?: (exercise: ForgeExercise) => void;
  onConfirm?: (exercises: ForgeExercise[]) => void;
  /** Lets the parent keep its own library list in sync after an inline create. */
  onExerciseCreated?: (exercise: ForgeExercise) => void;
  onClose: () => void;
}

const lastUsed = (exercise: ForgeExercise) => exercise.last_performance?.completed_at ?? null;

/** Full-screen exercise picker: search, muscle and equipment chips, recent first, inline create. */
export default function ExercisePickerSheet({
  exercises, title, multiple = false, disabledIds = [], disabledLabel = 'Schon drin', preferMuscle = null,
  confirmLabel = (count) => (count ? `${count} ${count === 1 ? 'Übung' : 'Übungen'} hinzufügen` : 'Übungen auswählen'),
  busy = false, onPick, onConfirm, onExerciseCreated, onClose,
}: Props) {
  const [created, setCreated] = useState<ForgeExercise[]>([]);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState<{ name: string } | null>(null);

  const library = useMemo(() => {
    const ids = new Set(exercises.map((item) => item.id));
    return [...exercises, ...created.filter((item) => !ids.has(item.id))];
  }, [exercises, created]);
  const muscles = useMemo(() => [...new Set(library.map((item) => item.primary_muscle_group))].sort((a, b) => muscleOrder(a) - muscleOrder(b)), [library]);
  const equipmentOptions = useMemo(() => EQUIPMENT.filter((item) => library.some((exercise) => exercise.equipment === item.value)), [library]);
  const normalizedQuery = query.trim().toLocaleLowerCase('de-DE');
  const filtering = Boolean(normalizedQuery || muscle || equipment);

  const matches = useMemo(() => library.filter((item) => {
    const haystack = `${item.name} ${muscleLabel(item.primary_muscle_group)} ${item.primary_muscle_group} ${equipmentLabel(item.equipment)}`.toLocaleLowerCase('de-DE');
    return (!normalizedQuery || haystack.includes(normalizedQuery)) && (!muscle || item.primary_muscle_group === muscle) && (!equipment || item.equipment === equipment);
  }), [library, normalizedQuery, muscle, equipment]);

  const recent = useMemo(() => (filtering ? [] : library.filter(lastUsed).sort((a, b) => (lastUsed(b) ?? '').localeCompare(lastUsed(a) ?? '')).slice(0, RECENT_LIMIT)), [filtering, library]);

  const groups = useMemo(() => {
    if (normalizedQuery) {
      const ranked = [...matches].sort((a, b) => Number(!a.name.toLocaleLowerCase('de-DE').startsWith(normalizedQuery)) - Number(!b.name.toLocaleLowerCase('de-DE').startsWith(normalizedQuery)) || a.name.localeCompare(b.name));
      return [{ key: 'results', title: `${ranked.length} ${ranked.length === 1 ? 'Treffer' : 'Treffer'}`, items: ranked }];
    }
    const byMuscle = new Map<string, ForgeExercise[]>();
    matches.forEach((item) => byMuscle.set(item.primary_muscle_group, [...(byMuscle.get(item.primary_muscle_group) ?? []), item]));
    return [...byMuscle].sort((a, b) => Number(b[0] === preferMuscle) - Number(a[0] === preferMuscle) || muscleOrder(a[0]) - muscleOrder(b[0]))
      .map(([key, items]) => ({ key, title: muscleLabel(key), items: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [matches, normalizedQuery, preferMuscle]);

  const exactMatch = library.some((item) => item.name.trim().toLocaleLowerCase('de-DE') === normalizedQuery);

  const choose = (exercise: ForgeExercise) => {
    if (disabledIds.includes(exercise.id) || busy) return;
    try { navigator.vibrate?.(6); } catch { /* unsupported */ }
    if (!multiple) { onPick?.(exercise); return; }
    setSelected((current) => (current.includes(exercise.id) ? current.filter((id) => id !== exercise.id) : [...current, exercise.id]));
  };

  const handleCreated = (exercise: ForgeExercise) => {
    setForm(null);
    setCreated((current) => [...current, exercise]);
    onExerciseCreated?.(exercise);
    setQuery('');
    if (multiple) setSelected((current) => [...current, exercise.id]);
    else onPick?.(exercise);
  };

  const row = (exercise: ForgeExercise) => {
    const disabled = disabledIds.includes(exercise.id);
    const isSelected = selected.includes(exercise.id);
    const used = relativeDays(lastUsed(exercise));
    return <button key={exercise.id} type="button" onClick={() => choose(exercise)} disabled={disabled} aria-pressed={multiple ? isSelected : undefined} className="tap flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left disabled:opacity-45" style={{ background: isSelected ? 'rgba(232,197,138,0.1)' : 'transparent', border: `1px solid ${isSelected ? `${SAND}55` : 'transparent'}` }}>
      <EquipmentIcon equipment={exercise.equipment} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium" style={{ color: TEXT }}>{exercise.name}</span>
        <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>{muscleLabel(exercise.primary_muscle_group)} · {equipmentLabel(exercise.equipment)}{used ? ` · ${used}` : ''}</span>
      </span>
      {disabled ? <span className="shrink-0 text-[11px]" style={{ color: DIM }}>{disabledLabel}</span>
        : multiple ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: isSelected ? SAND : 'transparent', border: `1.5px solid ${isSelected ? SAND : 'rgba(255,247,235,0.22)'}`, color: '#16130f' }}>{isSelected && <Check size={15} strokeWidth={3} />}</span>
          : <Plus size={18} className="shrink-0" style={{ color: SAND }} />}
    </button>;
  };

  const chip = (active: boolean, label: string, onClick: () => void) => <button type="button" onClick={onClick} aria-pressed={active} className="tap h-9 shrink-0 rounded-full px-3.5 text-[12.5px]" style={{ color: active ? '#16130f' : TEXT, background: active ? SAND : 'rgba(255,247,235,0.05)', border: `1px solid ${active ? SAND : BORDER}` }}>{label}</button>;

  return <ForgeSheet label={title} onClose={onClose} fullscreen>
    <header className="space-y-3 border-b px-4 pb-3 pt-3" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
      </div>
      <label className="flex h-12 items-center gap-2 rounded-2xl px-3.5" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>
        <Search size={17} style={{ color: DIM }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" enterKeyHint="search" placeholder={`${library.length} Übungen durchsuchen`} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: TEXT }} aria-label="Übung suchen" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche leeren" className="tap p-1" style={{ color: DIM }}><X size={16} /></button>}
      </label>
      <div className="forge-chip-row -mx-4 flex gap-1.5 overflow-x-auto px-4">{chip(!muscle, 'Alle', () => setMuscle(''))}{muscles.map((item) => chip(muscle === item, muscleLabel(item), () => setMuscle(muscle === item ? '' : item)))}</div>
      {equipmentOptions.length > 1 && <div className="forge-chip-row -mx-4 flex gap-1.5 overflow-x-auto px-4">{equipmentOptions.map((item) => chip(equipment === item.value, item.label, () => setEquipment(equipment === item.value ? '' : item.value)))}</div>}
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-2">
      {recent.length > 0 && <section className="mb-2">
        <h3 className="sticky top-0 z-10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: SAND, background: '#1d1913' }}>Zuletzt trainiert</h3>
        {recent.map(row)}
      </section>}
      {groups.map((group) => <section key={group.key} className="mb-2">
        <h3 className="sticky top-0 z-10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM, background: '#1d1913' }}>{group.title}</h3>
        {group.items.map(row)}
      </section>)}
      {!matches.length && <p className="px-4 py-8 text-center text-[13px]" style={{ color: DIM }}>Nichts gefunden.</p>}
      <div className="px-2 pt-2">
        <button type="button" onClick={() => setForm({ name: exactMatch ? '' : query.trim() })} className="tap flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[13.5px] font-medium" style={{ color: SAND, border: `1px dashed ${SAND}66` }}>
          <Plus size={16} />{query.trim() && !exactMatch ? `„${query.trim()}“ neu anlegen` : 'Neue Übung anlegen'}
        </button>
      </div>
    </div>

    {multiple && <footer className="border-t p-4" style={{ borderColor: BORDER, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <button type="button" disabled={!selected.length || busy} onClick={() => onConfirm?.(selected.map((id) => library.find((item) => item.id === id)).filter((item): item is ForgeExercise => Boolean(item)))} className="btn-forge flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-40">{confirmLabel(selected.length)}</button>
    </footer>}

    {form && <ExerciseFormSheet
      initialName={form.name}
      library={library}
      onClose={() => setForm(null)}
      onSaved={handleCreated}
      onUseExisting={(exercise) => { setForm(null); setQuery(''); choose(exercise); }}
    />}
  </ForgeSheet>;
}
