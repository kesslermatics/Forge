import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { deleteForgePlanImage, fetchForgePlanImage, uploadForgePlanImage } from '../api/api';
import type { ForgePlan } from '../api/api';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';
const BORDER = 'rgba(232,197,138,0.11)';

const validateImage = (file: File) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Bitte wähle ein JPEG-, PNG- oder WebP-Bild.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Das Bild darf höchstens 10 MiB groß sein.');
};

export default function ForgePlanImageCard({ plan, onUpdated }: { plan: ForgePlan; onUpdated: (plan: ForgePlan) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan.has_image) { setImageUrl(null); return; }
    let active = true;
    let objectUrl: string | null = null;
    void fetchForgePlanImage(plan.id).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setImageUrl(objectUrl);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Bild konnte nicht geladen werden.');
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [plan.id, plan.has_image]);

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const image = input.files?.[0];
    input.value = '';
    if (!image) return;
    setBusy(true); setError(null);
    try {
      validateImage(image);
      const form = new FormData(); form.append('image', image);
      onUpdated(await uploadForgePlanImage(plan.id, form));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Bild konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  };

  const removeImage = async () => {
    setBusy(true); setError(null);
    try { onUpdated(await deleteForgePlanImage(plan.id)); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Bild konnte nicht entfernt werden.'); }
    finally { setBusy(false); }
  };

  return <section className="card-forge overflow-hidden" style={{ borderColor: `${SAND}2c` }}>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectImage(event)} className="hidden" />
    {imageUrl ? <div className="relative"><img src={imageUrl} alt={`Bild für ${plan.name}`} className="h-48 w-full object-cover" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10"><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Trainingstag</p><p className="mt-0.5 text-[15px] font-semibold" style={{ color: TEXT }}>{plan.name}</p></div></div> : <button onClick={() => inputRef.current?.click()} disabled={busy} className="tap flex w-full items-center gap-3 p-4 text-left disabled:opacity-55"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>{busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}</span><span><span className="block text-[12px] font-medium" style={{ color: TEXT }}>Optionales Bild hinzufügen</span><span className="mt-0.5 block text-[10px]" style={{ color: DIM }}>Gibt diesem Trainingstag eine persönliche visuelle Note.</span></span></button>}
    <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5" style={{ borderColor: 'rgba(255,247,235,0.06)' }}><span className="text-[10px]" style={{ color: DIM }}>{plan.has_image ? 'Privat gespeichert · nur für dich sichtbar' : 'JPEG, PNG oder WebP · max. 10 MiB'}</span><span className="flex gap-3">{plan.has_image && <button onClick={() => void removeImage()} disabled={busy} className="tap flex items-center gap-1 text-[10px] disabled:opacity-50" style={{ color: DIM }}><Trash2 size={12} />Entfernen</button>}<button onClick={() => inputRef.current?.click()} disabled={busy} className="tap flex items-center gap-1 text-[10px] disabled:opacity-50" style={{ color: SAND }}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}{plan.has_image ? 'Ersetzen' : 'Hochladen'}</button></span></div>
    {error && <p className="border-t px-4 py-2 text-[10px]" style={{ color: '#fca5a5', borderColor: 'rgba(255,247,235,0.06)' }}>{error}</p>}
  </section>;
}
