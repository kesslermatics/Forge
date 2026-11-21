import type { FoodSummary, NutritionGoals, TrackEntry, UserInfo } from '../../api/api';

export const SAND = '#e8c58a';
export const TEXT = '#f2ece0';
export const DIM = 'rgba(242,236,226,0.52)';
export const FAINT = 'rgba(242,236,226,0.32)';
export const BORDER = 'rgba(232,197,138,0.12)';
export const PANEL = '#1d1913';
export const PROTEIN = '#f87171';
export const CARBS = '#fbbf24';
export const FAT = '#34d399';

export type LayoutContext = { user: UserInfo | null; refreshUser: () => Promise<UserInfo> };

/** Forge tracks days in Europe/Berlin regardless of the device clock's timezone. */
export function berlinToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function shiftDate(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()));
}

export function dayLabel(iso: string): string {
  const today = berlinToday();
  if (iso === today) return 'Heute';
  if (iso === shiftDate(today, -1)) return 'Gestern';
  if (iso === shiftDate(today, 1)) return 'Morgen';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const fmt = (value: number | null | undefined, digits = 0) =>
  value == null ? '–' : value.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtAmount = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** Decodes a photo with its EXIF rotation applied. `createImageBitmap` fails on some formats (HEIC on Android,
 * older Safari), the browser's own <img> decoder is the fallback. */
async function decodePhoto(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Das Foto konnte nicht gelesen werden.');
    }
  }
}

/** Phone photos are 4K and several MB. Vision models scale images down on their side anyway, so a long side
 * of 2560 px at high JPEG quality keeps every detail they can use while the upload stays around 1 MB. */
export async function photoToDataUrl(file: File, maxSide = 2560): Promise<string> {
  const photo = await decodePhoto(file);
  try {
    const ratio = Math.min(1, maxSide / Math.max(photo.width, photo.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.width * ratio));
    canvas.height = Math.max(1, Math.round(photo.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Das Foto konnte nicht verarbeitet werden.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    photo.release();
  }
}

export function scaled(per100: number | null | undefined, amount: number): number | null {
  return per100 == null ? null : (per100 * amount) / 100;
}

/** Number → input text without thousands separators ("1250,5"). */
export const toAmountInput = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',');

export const parseAmount = (value: string): number | null => {
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number > 0 && number <= 10000 ? Math.round(number * 10) / 10 : null;
};

export const SLOT_SUGGESTIONS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks', 'Pre-Workout', 'Post-Workout'];

export const foodKey = (item: Pick<FoodSummary, 'source' | 'source_id'>) => `${item.source}:${item.source_id}`;

/** Product page → meal page hand-over for the "added" toast after navigating back. */
let flash: { entry: TrackEntry; at: number } | null = null;
export function setTrackFlash(entry: TrackEntry) { flash = { entry, at: Date.now() }; }
/** Read without consuming (safe in state initialisers); call clearTrackFlash() in an effect. */
export function peekTrackFlash(): TrackEntry | null { return flash && Date.now() - flash.at < 8000 ? flash.entry : null; }
export function clearTrackFlash() { flash = null; }

/** Recent search results per meal and day (order and amounts depend on both), so going back to a meal page shows the list instantly. */
const searchCache = new Map<string, FoodSummary[]>();
const searchKey = (scope: string, query: string) => `${scope}|${query.toLowerCase()}`;
export function cachedSearch(scope: string, query: string): FoodSummary[] | undefined { return searchCache.get(searchKey(scope, query)); }
export function clearSearchCache() { searchCache.clear(); }
export function cacheSearch(scope: string, query: string, items: FoodSummary[]) {
  searchCache.set(searchKey(scope, query), items);
  if (searchCache.size > 40) searchCache.delete(searchCache.keys().next().value!);
}

export function timeLabel(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

export const ATTRIBUTION = 'Produktdaten: Open Food Facts (ODbL) · Grundnahrungsmittel: Max Rubner-Institut, BLS 4.0 (CC BY 4.0)';

/** "danach noch 390 kcal" for the product page: what is left today once this amount is added. */
export function afterAdding(dayKcal: number, goals: NutritionGoals | null, addKcal: number | null): { text: string; over: boolean } | null {
  if (!goals || addKcal == null) return null;
  const left = Math.round(goals.kcal - dayKcal - addKcal);
  return left >= 0 ? { text: `danach ${left.toLocaleString('de-DE')} übrig`, over: false } : { text: `danach ${Math.abs(left).toLocaleString('de-DE')} drüber`, over: true };
}
