import { CARBS, FAT, PROTEIN } from '../track/trackUtils';

export { CARBS, FAT, PROTEIN };
export const FIBER = '#b5d56a';
export const SUGAR = '#c084fc';
export const SALT = '#60a5fa';
/** Warm tone for "over the goal"; deliberately different from the protein red. */
export const OVER = '#f0936b';
export const TRACK = 'rgba(255,247,235,0.08)';
export const MEAL_PALETTE = ['#e8c58a', '#9bb59a', '#d99a8b', '#8fa3b8', '#c8a488', '#b79bc2', '#a8a58c'];

export type Range = 7 | 30;

/** A day counts as "in target" between 85 % and 105 % of the calorie goal. */
export const TARGET_MIN = 0.85;
export const TARGET_MAX = 1.05;
/** Protein and fiber goals count as met from 90 % on. */
export const HIT_MIN = 0.9;

export type DayStatus = 'empty' | 'neutral' | 'under' | 'target' | 'over';

export function kcalStatus(kcal: number, logged: boolean, goal: number | null): DayStatus {
  if (!logged) return 'empty';
  if (!goal) return 'neutral';
  const ratio = kcal / goal;
  if (ratio > TARGET_MAX) return 'over';
  return ratio >= TARGET_MIN ? 'target' : 'under';
}

export const STATUS_COLOR: Record<DayStatus, string> = {
  empty: 'rgba(255,247,235,0.14)',
  neutral: '#e8c58a',
  under: 'rgba(232,197,138,0.42)',
  target: '#e8c58a',
  over: OVER,
};

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** Monday = 0. */
export const weekdayIndex = (iso: string) => (utc(iso).getUTCDay() + 6) % 7;
export const dayOfMonth = (iso: string) => utc(iso).getUTCDate();
export const longDate = (iso: string) => utc(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const shortDay = (iso: string) => utc(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayMonth = (iso: string) => `${utc(iso).getUTCDate()}.${utc(iso).getUTCMonth() + 1}.`;

export const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/** Least-squares slope per index step over the non-null values; null with fewer than `min` points. */
export function slope(values: (number | null)[], min = 3): number | null {
  const points = values.flatMap((value, index) => (value === null ? [] : [[index, value] as const]));
  if (points.length < min) return null;
  const n = points.length;
  const sx = points.reduce((sum, [x]) => sum + x, 0);
  const sy = points.reduce((sum, [, y]) => sum + y, 0);
  const sxy = points.reduce((sum, [x, y]) => sum + x * y, 0);
  const sxx = points.reduce((sum, [x]) => sum + x * x, 0);
  const denominator = n * sxx - sx * sx;
  return denominator === 0 ? null : (n * sxy - sx * sy) / denominator;
}

export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? '−' : '+'}${text}`;
}
