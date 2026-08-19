/* ════════════════════════════════════════════════════════════
   MOCK DATA for the design preview (/preview)
   Mirrors the real API shapes so variants feel authentic.
   No backend / auth required.
   ════════════════════════════════════════════════════════════ */

export const mockUser = {
    firstName: 'Robert',
    today: new Date(),
};

export const mockWeather = {
    emoji: '☀️',
    temperature_c: 14,
    temp_min_c: 8,
    temp_max_c: 17,
    condition: 'Klar',
};

/* ── Today's nutrition (live) ─────────────────────────────── */
export const mockNutrition = {
    totals: { calories: 1460, protein: 132, carbs: 138, fat: 44, sugar: 38, fiber: 22, saturated: 12, salt: 4.1 },
    goals: { calories: 2200, protein: 180, carbs: 220, fat: 70, sugar: 60, fiber: 30, saturated: 20, salt: 6 },
};

/* ── Streaks ──────────────────────────────────────────────── */
export const mockStreaks = {
    training: { current: 4, longest: 11 },
    nutrition: { current: 12, longest: 12 },
    combined: { current: 4, longest: 8 },
};

/* ── Weight trend (last ~12 entries, gentle cut) ──────────── */
export const mockWeight = [
    83.6, 83.4, 83.5, 83.1, 82.9, 83.0, 82.6, 82.5, 82.4, 82.2, 82.4, 82.1,
].map((w, i) => ({ date: `d${i}`, weight_kg: w }));

/* ── The HERO feature: the training game plan ─────────────── *
   Formerly "Workout Tips". Tells you exactly what to hit,
   set by set, with the reasoning behind it.                   */

export type ProgressionStatus =
    | 'INCREASE_WEIGHT'
    | 'KEEP_PROGRESSING'
    | 'STAGNATED'
    | 'REGRESSED'
    | 'FIRST_SESSION';

export interface SetTarget {
    set_number: number;
    weight_kg: number;
    reps: number;
    note: string;
}

export interface ExerciseTarget {
    name: string;
    muscle: string;
    progression_status: ProgressionStatus;
    last_time: string;
    set_targets: SetTarget[];
    reasoning: string;
}

export interface GamePlan {
    workout_title: string;
    focus: string;
    est_duration_min: number;
    nutrition_context: string;
    exercise_targets: ExerciseTarget[];
    general_advice: string;
}

export const mockGamePlan: GamePlan = {
    workout_title: 'Push Day',
    focus: 'Brust · Schultern · Trizeps',
    est_duration_min: 62,
    nutrition_context:
        'Du liegst heute 130 g unter deinem Protein-Ziel und hast noch 740 kcal frei. Iss vor dem Training ~40 g Kohlenhydrate für volle Power.',
    general_advice:
        'Deine Drückleistung steigt seit 3 Wochen. Halt die Pausen bei 2–3 min, damit du die Zielgewichte sauber triffst. Fokus heute: kontrollierte Exzentrik auf der Bank.',
    exercise_targets: [
        {
            name: 'Bankdrücken (Langhantel)',
            muscle: 'Brust',
            progression_status: 'INCREASE_WEIGHT',
            last_time: '4×5 @ 80 kg',
            set_targets: [
                { set_number: 1, weight_kg: 82.5, reps: 5, note: 'Neues Arbeitsgewicht' },
                { set_number: 2, weight_kg: 82.5, reps: 5, note: '' },
                { set_number: 3, weight_kg: 82.5, reps: 5, note: '' },
                { set_number: 4, weight_kg: 82.5, reps: 5, note: 'Wenn sauber → nächstes Mal 85' },
            ],
            reasoning:
                'Letzte Session alle 4 Sätze mit 80 kg sauber getroffen. +2,5 kg ist der logische nächste Schritt für progressive Overload.',
        },
        {
            name: 'Schrägbank Kurzhantel',
            muscle: 'Obere Brust',
            progression_status: 'KEEP_PROGRESSING',
            last_time: '3×9 @ 30 kg',
            set_targets: [
                { set_number: 1, weight_kg: 30, reps: 10, note: 'Eine Wdh. mehr' },
                { set_number: 2, weight_kg: 30, reps: 10, note: '' },
                { set_number: 3, weight_kg: 30, reps: 10, note: 'Ziel: 3×10, dann hoch' },
            ],
            reasoning:
                'Du bist bei 9 Wdh. Erst die 10 in allen Sätzen knacken, bevor du das Gewicht erhöhst. Sauberer Weg zu mehr Volumen.',
        },
        {
            name: 'Schulterdrücken (Maschine)',
            muscle: 'Schultern',
            progression_status: 'STAGNATED',
            last_time: '3×8 @ 45 kg',
            set_targets: [
                { set_number: 1, weight_kg: 45, reps: 8, note: 'Gleich halten' },
                { set_number: 2, weight_kg: 45, reps: 8, note: '' },
                { set_number: 3, weight_kg: 45, reps: 8, note: 'Letzte 2 Wdh. langsam' },
            ],
            reasoning:
                'Seit 2 Sessions bei 45 kg festgefahren. Wir halten das Gewicht und arbeiten an Tempo & Form, um den Reiz neu zu setzen.',
        },
        {
            name: 'Trizeps Seildrücken',
            muscle: 'Trizeps',
            progression_status: 'INCREASE_WEIGHT',
            last_time: '3×12 @ 25 kg',
            set_targets: [
                { set_number: 1, weight_kg: 27.5, reps: 12, note: 'Gewicht hoch' },
                { set_number: 2, weight_kg: 27.5, reps: 11, note: '' },
                { set_number: 3, weight_kg: 27.5, reps: 10, note: 'Bis zum Muskelversagen' },
            ],
            reasoning:
                'Alle Sätze mit 25 kg locker bei 12 Wdh. Zeit für +2,5 kg. Reps dürfen leicht sinken, das ist normal.',
        },
    ],
};

/* Human labels + colors for progression status */
export const progressionMeta: Record<
    ProgressionStatus,
    { label: string; short: string; color: string; bg: string }
> = {
    INCREASE_WEIGHT: { label: 'Gewicht erhöhen', short: 'Hochgehen', color: '#34d399', bg: 'rgba(52,211,153,0.14)' },
    KEEP_PROGRESSING: { label: 'Reps steigern', short: 'Reps +', color: '#60a5fa', bg: 'rgba(96,165,250,0.14)' },
    STAGNATED: { label: 'Halten & schärfen', short: 'Halten', color: '#fbbf24', bg: 'rgba(251,191,36,0.14)' },
    REGRESSED: { label: 'Zurückdrehen', short: 'Deload', color: '#f87171', bg: 'rgba(248,113,113,0.14)' },
    FIRST_SESSION: { label: 'Erstes Mal', short: 'Neu', color: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
};

/* Derived helpers */
export const nutritionMacros = (n = mockNutrition) => [
    { key: 'protein', label: 'Protein', current: n.totals.protein, goal: n.goals.protein, unit: 'g', accent: '#f87171' },
    { key: 'carbs', label: 'Carbs', current: n.totals.carbs, goal: n.goals.carbs, unit: 'g', accent: '#fbbf24' },
    { key: 'fat', label: 'Fett', current: n.totals.fat, goal: n.goals.fat, unit: 'g', accent: '#34d399' },
];

export const caloriesRemaining = Math.max(0, mockNutrition.goals.calories - mockNutrition.totals.calories);
export const caloriesPct = mockNutrition.totals.calories / mockNutrition.goals.calories;

export const weightDelta =
    mockWeight[mockWeight.length - 1].weight_kg - mockWeight[0].weight_kg;
export const weightCurrent = mockWeight[mockWeight.length - 1].weight_kg;
