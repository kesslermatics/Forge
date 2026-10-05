import type { ForgeProgram } from '../api/api';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Baut aus dem Programm ein kompaktes Export-Objekt: Plan, Einheiten, Übungen und letzte Sätze. */
export function buildProgramExport(program: ForgeProgram) {
  // Ein Trainingstag kann in der Rotation mehrfach vorkommen, daher nach Plan zusammenfassen.
  const units = new Map<string, { routines: ForgeProgram['routines'] }>();
  [...program.routines].sort((a, b) => a.position - b.position).forEach((routine) => {
    const entry = units.get(routine.plan.id);
    if (entry) entry.routines.push(routine); else units.set(routine.plan.id, { routines: [routine] });
  });

  return {
    plan: program.name,
    modus: program.mode === 'weekly' ? 'Wochenplan' : 'Rotation',
    einheiten: [...units.values()].map(({ routines }) => {
      const plan = routines[0].plan;
      const weekdays = [...new Set(routines.flatMap((routine) => routine.weekdays))].sort();
      const frequenz = program.mode === 'weekly'
        ? { wochentage: weekdays.map((day) => WEEKDAYS[day] ?? String(day)), pro_woche: weekdays.length }
        : { pro_rotation: routines.length, positionen_in_rotation: routines.map((routine) => routine.position + 1) };
      return {
        name: plan.name,
        frequenz,
        uebungen: plan.exercises.map((entry) => {
          const last = entry.exercise.last_performance;
          return {
            name: entry.exercise.name,
            ...(entry.machine_profile ? { maschine: entry.machine_profile.name } : {}),
            letztes_training: last ? last.completed_at : null,
            letzte_saetze: (last?.sets ?? []).map((set, index) => ({
              satz: index + 1,
              typ: set.set_type === 'warmup' ? 'Aufwärmen' : 'Arbeitssatz',
              wdh: set.actual_reps,
              gewicht_kg: set.actual_weight_kg,
            })),
          };
        }),
      };
    }),
  };
}
