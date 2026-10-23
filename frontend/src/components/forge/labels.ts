import type { ForgeEquipment, ForgeExercise, ForgeLoadBasis, ForgeLoadingSystem, ForgePlan } from '../../api/api';

/** Internal muscle tokens stay English (history, AI, analytics); the UI shows German labels. */
export const MUSCLES = ['Chest', 'Back', 'Lats', 'Traps', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Abs', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Full Body', 'Other'] as const;

const MUSCLE_LABELS: Record<string, string> = {
  Chest: 'Brust', Back: 'Rücken', Lats: 'Latissimus', Traps: 'Trapez', Shoulders: 'Schultern',
  Biceps: 'Bizeps', Triceps: 'Trizeps', Forearms: 'Unterarme', Abs: 'Bauch', Quadriceps: 'Quadrizeps',
  Hamstrings: 'Beinbeuger', Glutes: 'Gesäß', Calves: 'Waden', 'Full Body': 'Ganzkörper', Other: 'Sonstiges',
};

export const muscleLabel = (muscle: string | null | undefined) => (muscle ? MUSCLE_LABELS[muscle] ?? muscle : 'Sonstiges');

export const muscleOrder = (muscle: string) => {
  const index = (MUSCLES as readonly string[]).indexOf(muscle);
  return index >= 0 ? index : MUSCLES.length;
};

export const EQUIPMENT: Array<{ value: ForgeEquipment; label: string }> = [
  { value: 'machine', label: 'Maschine' }, { value: 'cable', label: 'Kabelzug' }, { value: 'barbell', label: 'Langhantel' },
  { value: 'dumbbell', label: 'Kurzhantel' }, { value: 'kettlebell', label: 'Kettlebell' }, { value: 'none', label: 'Körpergewicht' },
  { value: 'other', label: 'Sonstiges' },
];

export const equipmentLabel = (equipment: string) => EQUIPMENT.find((item) => item.value === equipment)?.label ?? 'Sonstiges';

export const machineCapable = (equipment: string) => equipment === 'machine' || equipment === 'cable';

/** Exercise icon token derived from equipment; the library no longer asks for one. */
export const iconForEquipment = (equipment: ForgeEquipment) => ({
  machine: 'Cog', cable: 'Cable', barbell: 'Dumbbell', dumbbell: 'Dumbbell', kettlebell: 'Weight', none: 'PersonStanding', other: 'Shapes',
} as const)[equipment];

export const LOADING_SYSTEMS: Array<{ value: ForgeLoadingSystem; label: string; hint: string }> = [
  { value: 'selectorized', label: 'Steckgewicht', hint: 'Gewichtsblock mit Stift, feste Stufen' },
  { value: 'plate_loaded', label: 'Scheiben', hint: 'Du lädst Hantelscheiben selbst' },
  { value: 'fixed', label: 'Feste Last', hint: 'Gewicht lässt sich nicht verstellen' },
  { value: 'other', label: 'Sonstiges', hint: 'z. B. Band, Luft- oder Hydraulikwiderstand' },
  { value: 'unknown', label: 'Unbekannt', hint: 'Der Coach rechnet vorsichtiger' },
];

export const LOAD_BASES: Array<{ value: ForgeLoadBasis; label: string; hint: string }> = [
  { value: 'displayed_total', label: 'Gesamtgewicht', hint: 'Angezeigtes Gewicht ist die ganze Last' },
  { value: 'per_side', label: 'Je Seite', hint: 'Angegebenes Gewicht gilt pro Arm/Seite' },
  { value: 'unknown', label: 'Unbekannt', hint: 'Nicht sicher' },
];

export const loadingLabel = (value: ForgeLoadingSystem) => LOADING_SYSTEMS.find((item) => item.value === value)?.label ?? 'Unbekannt';
export const loadBasisLabel = (value: ForgeLoadBasis) => LOAD_BASES.find((item) => item.value === value)?.label ?? 'Unbekannt';

export const formatKg = (value: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value);

/** Rough duration: 2.5 min per working set, 1.5 per warm-up, 2 per exercise change. */
export const estimateMinutes = (exercises: Array<{ warmups: number; workings: number }>) =>
  Math.round(exercises.reduce((sum, item) => sum + item.warmups * 1.5 + item.workings * 2.5 + 2, 0));

export const relativeDays = (iso: string | null | undefined) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 60) return `vor ${Math.round(days / 7)} Wochen`;
  return `vor ${Math.round(days / 30)} Monaten`;
};

/** Top primary muscles of a plan, weighted by working sets. */
export const planMuscleFocus = (plan: ForgePlan, limit = 3) => {
  const weights = new Map<string, number>();
  plan.exercises.forEach((entry) => {
    const sets = entry.sets.filter((set) => set.set_type === 'working').length || 1;
    weights.set(entry.exercise.primary_muscle_group, (weights.get(entry.exercise.primary_muscle_group) ?? 0) + sets);
  });
  return [...weights].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([muscle]) => muscle);
};

const normalizeName = (value: string) => value.toLocaleLowerCase('de-DE')
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

/** Library exercises whose name looks like the typed one (typos, word order, umlauts). */
export const similarExercises = (name: string, library: ForgeExercise[], excludeId?: string | null, limit = 3) => {
  const target = normalizeName(name);
  if (target.length < 3) return [];
  const targetTokens = new Set(target.split(' ').filter((token) => token.length > 1));
  return library
    .filter((exercise) => exercise.id !== excludeId)
    .map((exercise) => {
      const candidate = normalizeName(exercise.name);
      const tokens = candidate.split(' ').filter((token) => token.length > 1);
      const overlap = tokens.filter((token) => targetTokens.has(token)).length / Math.max(tokens.length, targetTokens.size, 1);
      const distance = 1 - levenshtein(candidate, target) / Math.max(candidate.length, target.length, 1);
      const contains = candidate.includes(target) || target.includes(candidate) ? 0.85 : 0;
      return { exercise, score: Math.max(overlap, distance, contains) };
    })
    .filter((item) => item.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.exercise);
};
