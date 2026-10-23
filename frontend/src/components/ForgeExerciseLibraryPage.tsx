import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, Plus, Search, Settings2, X } from 'lucide-react';
import { getForgeExercises, getForgePlans } from '../api/api';
import type { ForgeExercise, ForgePlan } from '../api/api';
import EquipmentIcon from './forge/EquipmentIcon';
import ExerciseFormSheet from './forge/ExerciseFormSheet';
import { EQUIPMENT, equipmentLabel, muscleLabel, muscleOrder, relativeDays } from './forge/labels';

const SAND = '#e8c58a'; const TEXT = '#f2ece0'; const DIM = 'rgba(242,236,226,0.5)'; const BORDER = 'rgba(232,197,138,0.12)';

export default function ForgeExerciseLibraryPage() {
  const navigate = useNavigate();
  const [exercises, setExercises] = useState<ForgeExercise[]>([]);
  const [plans, setPlans] = useState<ForgePlan[]>([]);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([getForgeExercises(), getForgePlans()])
      .then(([loadedExercises, loadedPlans]) => { setExercises(loadedExercises); setPlans(loadedPlans); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Übungen konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  const planUsage = useMemo(() => {
    const usage = new Map<string, number>();
    plans.forEach((plan) => new Set(plan.exercises.map((entry) => entry.exercise.id)).forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1)));
    return usage;
  }, [plans]);
  const muscles = useMemo(() => [...new Set(exercises.map((item) => item.primary_muscle_group))].sort((a, b) => muscleOrder(a) - muscleOrder(b)), [exercises]);
  const equipmentOptions = useMemo(() => EQUIPMENT.filter((item) => exercises.some((exercise) => exercise.equipment === item.value)), [exercises]);
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('de-DE');
    const matches = exercises.filter((item) => {
      const haystack = `${item.name} ${muscleLabel(item.primary_muscle_group)} ${equipmentLabel(item.equipment)}`.toLocaleLowerCase('de-DE');
      return (!normalized || haystack.includes(normalized)) && (!muscle || item.primary_muscle_group === muscle) && (!equipment || item.equipment === equipment);
    });
    const byMuscle = new Map<string, ForgeExercise[]>();
    matches.forEach((item) => byMuscle.set(item.primary_muscle_group, [...(byMuscle.get(item.primary_muscle_group) ?? []), item]));
    return [...byMuscle].sort((a, b) => muscleOrder(a[0]) - muscleOrder(b[0])).map(([key, items]) => ({ key, items: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [exercises, query, muscle, equipment]);
  const matchCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin" style={{ color: SAND }} /></div>;

  const chip = (active: boolean, label: string, onClick: () => void) => <button key={label} type="button" onClick={onClick} aria-pressed={active} className="tap h-9 shrink-0 rounded-full px-3.5 text-[12.5px]" style={{ color: active ? '#16130f' : TEXT, background: active ? SAND : 'rgba(255,247,235,0.05)', border: `1px solid ${active ? SAND : BORDER}` }}>{label}</button>;

  return <div className="space-y-4 forge-anim">
    <header className="flex items-center gap-3">
      <button type="button" onClick={() => navigate('/forge')} className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label="Zurück zum Plan" style={{ color: SAND, background: 'rgba(232,197,138,0.08)' }}><ArrowLeft size={19} /></button>
      <div className="min-w-0 flex-1"><h1 className="text-[24px] font-semibold tracking-tight" style={{ color: TEXT }}>Übungen</h1><p className="text-[12px]" style={{ color: DIM }}>{exercises.length} in deiner Bibliothek</p></div>
      <button type="button" onClick={() => setCreating(true)} className="tap flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold" style={{ color: '#16130f', background: SAND }}><Plus size={16} />Neu</button>
    </header>
    {error && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</div>}

    <button type="button" onClick={() => navigate('/forge/machine-profiles')} className="card-forge tap flex w-full items-center gap-3 p-3.5 text-left">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><Settings2 size={18} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium" style={{ color: TEXT }}>Geräteprofile</span><span className="block text-[11.5px]" style={{ color: DIM }}>Gewichtsstufen deiner Maschinen und Kabelzüge</span></span>
      <ChevronRight size={18} style={{ color: DIM }} />
    </button>

    <div className="sticky top-14 z-20 -mx-4 space-y-2 px-4 pb-2 pt-1" style={{ background: 'rgba(22,19,15,0.94)', backdropFilter: 'blur(12px)' }}>
      <label className="flex h-12 items-center gap-2 rounded-2xl px-3.5" style={{ background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}>
        <Search size={17} style={{ color: DIM }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Übung suchen" aria-label="Übung suchen" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" style={{ color: TEXT }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche leeren" className="tap p-1" style={{ color: DIM }}><X size={16} /></button>}
      </label>
      <div className="forge-chip-row -mx-4 flex gap-1.5 overflow-x-auto px-4">{chip(!muscle, 'Alle Muskeln', () => setMuscle(''))}{muscles.map((item) => chip(muscle === item, muscleLabel(item), () => setMuscle(muscle === item ? '' : item)))}</div>
      {equipmentOptions.length > 1 && <div className="forge-chip-row -mx-4 flex gap-1.5 overflow-x-auto px-4">{equipmentOptions.map((item) => chip(equipment === item.value, item.label, () => setEquipment(equipment === item.value ? '' : item.value)))}</div>}
    </div>

    {groups.map((group) => <section key={group.key}>
      <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DIM }}>{muscleLabel(group.key)} · {group.items.length}</h2>
      <div className="overflow-hidden rounded-2xl" style={{ background: 'rgba(255,247,235,0.025)', border: `1px solid ${BORDER}` }}>
        {group.items.map((exercise, index) => {
          const usedIn = planUsage.get(exercise.id) ?? 0;
          const last = relativeDays(exercise.last_performance?.completed_at);
          const meta = [equipmentLabel(exercise.equipment), usedIn ? `in ${usedIn} ${usedIn === 1 ? 'Plan' : 'Plänen'}` : null, last ? `zuletzt ${last}` : 'noch nie trainiert'].filter(Boolean).join(' · ');
          return <button key={exercise.id} type="button" onClick={() => navigate(`/forge/exercises/${exercise.id}/history`)} className="tap flex w-full items-center gap-3 px-3 py-3 text-left" style={{ borderTop: index ? '1px solid rgba(255,247,235,0.05)' : 'none' }}>
            <EquipmentIcon equipment={exercise.equipment} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium" style={{ color: TEXT }}>{exercise.name}</span>
              <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: DIM }}>{meta}</span>
              {exercise.machine_profiles.length > 0 && <span className="mt-0.5 block truncate text-[11px]" style={{ color: SAND }}>{exercise.machine_profiles.map((profile) => profile.name).join(' · ')}</span>}
            </span>
            <ChevronRight size={17} className="shrink-0" style={{ color: 'rgba(242,236,226,0.3)' }} />
          </button>;
        })}
      </div>
    </section>)}

    {!matchCount && <div className="card-forge p-7 text-center">
      <p className="text-[13px]" style={{ color: DIM }}>{exercises.length ? 'Keine passende Übung.' : 'Noch keine Übungen angelegt.'}</p>
      <button type="button" onClick={() => setCreating(true)} className="btn-forge mt-3 inline-flex h-11 items-center gap-2"><Plus size={15} />{query.trim() ? `„${query.trim()}“ anlegen` : 'Übung anlegen'}</button>
    </div>}

    {creating && <ExerciseFormSheet
      initialName={matchCount ? '' : query.trim()}
      library={exercises}
      onClose={() => setCreating(false)}
      onSaved={(saved) => { setCreating(false); navigate(`/forge/exercises/${saved.id}/history`); }}
      onUseExisting={(existing) => { setCreating(false); navigate(`/forge/exercises/${existing.id}/history`); }}
    />}
  </div>;
}
