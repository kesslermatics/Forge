import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, ChevronLeft, ImagePlus, Loader2, LockKeyhole, Pencil, Save, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  createForgeProgressPhoto, deleteForgeProgressPhoto, fetchForgeProgressPhotoImage,
  listForgeProgressPhotos, updateForgeProgressPhoto,
} from '../api/api';
import type { ForgeProgressPhoto, ForgeProgressPhotoView } from '../api/api';
import ConfirmDialog from './ConfirmDialog';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.52)';
const BORDER = 'rgba(232,197,138,0.11)';
const VIEWS: Array<{ value: ForgeProgressPhotoView; label: string }> = [
  { value: 'front', label: 'Vorne' }, { value: 'side', label: 'Seite' },
  { value: 'back', label: 'Hinten' }, { value: 'other', label: 'Sonstiges' },
];

const isoToday = () => new Date().toISOString().slice(0, 10);
const photoLabel = (view: ForgeProgressPhotoView) => VIEWS.find((item) => item.value === view)?.label ?? view;

async function compressImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Bitte wähle ein JPEG-, PNG- oder WebP-Bild. HEIC wird aus Datenschutz- und Kompatibilitätsgründen nicht verarbeitet.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Das Bild darf höchstens 10 MiB groß sein.');

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    // Full-HD-scale upper bound; retain the original aspect ratio rather than cropping body shots.
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Das Bild konnte nicht vorbereitet werden.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) throw new Error('Das Bild konnte nicht komprimiert werden.');
    return new File([blob], 'forge-progress.webp', { type: 'image/webp' });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function ForgeProgressPhotosPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<ForgeProgressPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [takenOn, setTakenOn] = useState(isoToday());
  const [view, setView] = useState<ForgeProgressPhotoView>('front');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<ForgeProgressPhoto | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareSplit, setCompareSplit] = useState(50);
  const [photoToDelete, setPhotoToDelete] = useState<ForgeProgressPhoto | null>(null);

  const comparison = useMemo(() => compareIds.map((id) => photos.find((photo) => photo.id === id)).filter((photo): photo is ForgeProgressPhoto => Boolean(photo)), [compareIds, photos]);

  const loadPhotos = async () => {
    setLoading(true); setError(null);
    try {
      const result = await listForgeProgressPhotos(100);
      setPhotos(result.items); setTotal(result.total);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Progress-Fotos konnten nicht geladen werden.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadPhotos(); }, []);

  useEffect(() => {
    let current = true;
    const urls: string[] = [];
    void Promise.all(photos.map(async (photo) => {
      const blob = await fetchForgeProgressPhotoImage(photo.id);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return [photo.id, url] as const;
    })).then((pairs) => {
      if (current) setImageUrls(Object.fromEntries(pairs));
    }).catch(() => {
      if (current) setError('Ein privates Bild konnte nicht geladen werden.');
    });
    return () => { current = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [photos]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setError(null); setNotice(null);
    try {
      const prepared = await compressImage(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setSelectedFile(prepared); setPreviewUrl(URL.createObjectURL(prepared));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Das Bild konnte nicht vorbereitet werden.');
    }
  };

  const uploadPhoto = async () => {
    if (!selectedFile) { inputRef.current?.click(); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const form = new FormData();
      form.append('image', selectedFile);
      form.append('taken_on', takenOn);
      form.append('view', view);
      if (note.trim()) form.append('note', note.trim());
      const created = await createForgeProgressPhoto(form);
      setPhotos((current) => [created, ...current]); setTotal((current) => current + 1);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setSelectedFile(null); setPreviewUrl(null); setNote(''); setTakenOn(isoToday()); setView('front');
      setNotice('Dein privater Snapshot wurde gespeichert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Foto konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const toggleComparison = (photoId: string) => {
    setCompareIds((current) => {
      if (current.includes(photoId)) return current.filter((id) => id !== photoId);
      if (current.length === 2) return [current[1], photoId];
      return [...current, photoId];
    });
  };

  const beginEdit = (photo: ForgeProgressPhoto) => { setEditing(photo); setTakenOn(photo.taken_on); setView(photo.view); setNote(photo.note ?? ''); setError(null); setNotice(null); };
  const cancelEdit = () => { setEditing(null); setTakenOn(isoToday()); setView('front'); setNote(''); };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true); setError(null);
    try {
      const updated = await updateForgeProgressPhoto(editing.id, { taken_on: takenOn, view, note: note.trim() || null });
      setPhotos((current) => current.map((photo) => photo.id === updated.id ? updated : photo).sort((a, b) => b.taken_on.localeCompare(a.taken_on)));
      cancelEdit(); setNotice('Snapshot-Details gespeichert.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Details konnten nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const removePhoto = async (photo: ForgeProgressPhoto) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      await deleteForgeProgressPhoto(photo.id);
      setPhotos((current) => current.filter((item) => item.id !== photo.id)); setTotal((current) => Math.max(0, current - 1));
      setCompareIds((current) => current.filter((id) => id !== photo.id));
      if (editing?.id === photo.id) cancelEdit();
      setNotice('Snapshot gelöscht.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Snapshot konnte nicht gelöscht werden.');
    } finally { setSaving(false); }
  };

  return <div className="space-y-4 forge-anim">
    <header className="flex items-start gap-3">
      <button onClick={() => navigate('/forge')} className="tap mt-1 p-1 cursor-pointer" aria-label="Zurück zu Forge" style={{ color: SAND }}><ArrowLeft size={19} /></button>
      <div><p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: SAND }}>Forge journal</p><h1 className="text-[27px] font-semibold tracking-tight mt-1" style={{ color: TEXT }}>Progress</h1><p className="text-[13px] mt-1" style={{ color: DIM }}>Private Snapshots, nur für deinen Account.</p></div>
    </header>

    <div className="card-forge p-4 flex gap-3" style={{ borderColor: `${SAND}28` }}><LockKeyhole size={17} className="shrink-0 mt-0.5" style={{ color: SAND }} /><p className="text-[11px] leading-relaxed" style={{ color: DIM }}>Bilder werden privat gespeichert, nie veröffentlicht und weder an Gemini noch an eine KI-Auswertung gesendet.</p></div>

    {(error || notice) && <div className="rounded-2xl px-4 py-3 text-[12px]" style={{ background: error ? 'rgba(248,113,113,0.1)' : 'rgba(232,197,138,0.1)', color: error ? '#fca5a5' : SAND }}>{error || notice}</div>}

    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => void chooseFile(event)} />
    <section className="card-forge p-4 space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-[16px] font-semibold" style={{ color: TEXT }}>{editing ? 'Snapshot bearbeiten' : 'Neuer Snapshot'}</h2><p className="text-[11px] mt-0.5" style={{ color: DIM }}>{editing ? 'Ändere Datum, Ansicht oder Notiz.' : 'Kamera oder Galerie · JPEG, PNG, WebP · max. 10 MiB'}</p></div>{editing && <button onClick={cancelEdit} className="tap p-1 cursor-pointer" aria-label="Bearbeiten schließen" style={{ color: DIM }}><X size={17} /></button>}</div>
      {!editing && <><button onClick={() => inputRef.current?.click()} className="tap relative w-full min-h-36 overflow-hidden rounded-2xl border border-dashed cursor-pointer" style={{ borderColor: previewUrl ? `${SAND}66` : BORDER, background: 'rgba(255,247,235,0.025)' }}>{previewUrl ? <img src={previewUrl} alt="Vorschau des neuen Snapshots" className="h-44 w-full object-cover" /> : <span className="flex flex-col items-center gap-2 py-9" style={{ color: SAND }}><Camera size={23} /><span className="text-[12px] font-medium">Foto aufnehmen oder auswählen</span></span>}</button>{selectedFile && <p className="text-[10px] truncate" style={{ color: DIM }}>{selectedFile.size < 1024 * 1024 ? `${Math.round(selectedFile.size / 1024)} KB` : `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`} · wird privat als WebP gespeichert</p>}</>}
      <SnapshotFields takenOn={takenOn} view={view} note={note} onTakenOn={setTakenOn} onView={setView} onNote={setNote} />
      <div className="flex gap-2">{editing ? <button onClick={() => void saveEdit()} disabled={saving} className="btn-forge flex-1">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Details speichern</button> : <button onClick={() => void uploadPhoto()} disabled={saving || !selectedFile} className="btn-forge flex-1">{saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}Snapshot speichern</button>}{!editing && selectedFile && <button onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setSelectedFile(null); }} className="tap px-3 cursor-pointer" style={{ color: DIM }} aria-label="Auswahl entfernen"><X size={18} /></button>}</div>
    </section>

    {comparison.length === 2 && <Comparison photos={comparison} urls={imageUrls} split={compareSplit} onSplit={setCompareSplit} onClose={() => setCompareIds([])} />}

    <section className="space-y-3"><div className="flex items-end justify-between"><div><h2 className="text-[18px] font-semibold" style={{ color: TEXT }}>Dein Verlauf</h2><p className="text-[11px] mt-1" style={{ color: DIM }}>{total} {total === 1 ? 'Snapshot' : 'Snapshots'} · wähle zwei zum Vergleichen</p></div>{compareIds.length > 0 && <button onClick={() => setCompareIds([])} className="tap text-[11px] cursor-pointer" style={{ color: SAND }}>Auswahl löschen</button>}</div>
      {loading ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: SAND }} /></div> : photos.length ? <div className="grid grid-cols-2 gap-3">{photos.map((photo) => <PhotoCard key={photo.id} photo={photo} imageUrl={imageUrls[photo.id]} selected={compareIds.includes(photo.id)} saving={saving} onCompare={() => toggleComparison(photo.id)} onEdit={() => beginEdit(photo)} onDelete={() => setPhotoToDelete(photo)} />)}</div> : <div className="card-forge p-7 text-center"><ImagePlus size={23} className="mx-auto" style={{ color: SAND }} /><h2 className="text-[15px] font-semibold mt-3" style={{ color: TEXT }}>Dein erster Fortschritts-Snapshot</h2><p className="text-[12px] leading-relaxed mt-1.5" style={{ color: DIM }}>Mach ein Foto unter ähnlichem Licht und aus derselben Perspektive. Forge ergänzt es mit Datum, Gewicht und deinen Workouts, wenn diese Daten vorhanden sind.</p></div>}</section>
    <ConfirmDialog open={photoToDelete !== null} busy={saving} destructive title="Snapshot löschen?" description={photoToDelete ? `Der Snapshot vom ${formatDate(photoToDelete.taken_on)} und das zugehörige Bild werden dauerhaft gelöscht und können nicht wiederhergestellt werden.` : ''} confirmLabel="Snapshot löschen" onCancel={() => setPhotoToDelete(null)} onConfirm={() => { const photo = photoToDelete; setPhotoToDelete(null); if (photo) void removePhoto(photo); }} />
  </div>;
}

function SnapshotFields({ takenOn, view, note, onTakenOn, onView, onNote }: { takenOn: string; view: ForgeProgressPhotoView; note: string; onTakenOn: (value: string) => void; onView: (value: ForgeProgressPhotoView) => void; onNote: (value: string) => void }) {
  return <><div className="grid grid-cols-2 gap-2"><label className="text-[11px]" style={{ color: DIM }}>Datum<input type="date" max={isoToday()} value={takenOn} onChange={(event) => onTakenOn(event.target.value)} className="input-forge mt-1 !px-3 !py-2.5 text-[12px]" /></label><label className="text-[11px]" style={{ color: DIM }}>Ansicht<select value={view} onChange={(event) => onView(event.target.value as ForgeProgressPhotoView)} className="input-forge mt-1 !px-3 !py-2.5 text-[12px]">{VIEWS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><textarea value={note} maxLength={500} onChange={(event) => onNote(event.target.value)} rows={2} placeholder="Optional: z. B. morgens, gleiches Licht, nach Push-Tag" className="input-forge resize-none text-[12px]" /></>;
}

function PhotoCard({ photo, imageUrl, selected, saving, onCompare, onEdit, onDelete }: { photo: ForgeProgressPhoto; imageUrl?: string; selected: boolean; saving: boolean; onCompare: () => void; onEdit: () => void; onDelete: () => void }) {
  const context = [photo.context.weight_kg != null ? `${photo.context.weight_kg.toFixed(1)} kg` : null, photo.context.workout_names.length ? photo.context.workout_names.join(' · ') : null].filter(Boolean).join(' · ');
  return <article className="card-forge overflow-hidden"><button onClick={onCompare} className="tap relative block aspect-[3/4] w-full overflow-hidden cursor-pointer" aria-pressed={selected} aria-label={`${formatDate(photo.taken_on)} zum Vergleich auswählen`} style={{ background: 'rgba(255,247,235,0.04)' }}>{imageUrl ? <img src={imageUrl} alt={`Progress Snapshot ${formatDate(photo.taken_on)}`} className="h-full w-full object-cover" /> : <Loader2 size={19} className="absolute inset-0 m-auto animate-spin" style={{ color: SAND }} />}{selected && <span className="absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-semibold" style={{ background: SAND, color: '#16130f' }}>Vergleich ✓</span>}</button><div className="p-3"><div className="flex justify-between gap-2"><div className="min-w-0"><p className="text-[12px] font-semibold" style={{ color: TEXT }}>{formatDate(photo.taken_on)}</p><p className="text-[10px] mt-0.5" style={{ color: SAND }}>{photoLabel(photo.view)}</p></div><div className="flex shrink-0 gap-1"><button onClick={onEdit} disabled={saving} className="tap p-1 cursor-pointer disabled:opacity-50" aria-label="Snapshot bearbeiten" style={{ color: SAND }}><Pencil size={14} /></button><button onClick={onDelete} disabled={saving} className="tap p-1 cursor-pointer disabled:opacity-50" aria-label="Snapshot löschen" style={{ color: DIM }}><Trash2 size={14} /></button></div></div>{context && <p className="text-[10px] leading-relaxed mt-2 line-clamp-2" style={{ color: DIM }}>{context}</p>}{photo.note && <p className="text-[10px] leading-relaxed mt-1 line-clamp-2" style={{ color: 'rgba(242,236,226,0.7)' }}>{photo.note}</p>}</div></article>;
}

function Comparison({ photos, urls, split, onSplit, onClose }: { photos: ForgeProgressPhoto[]; urls: Record<string, string>; split: number; onSplit: (value: number) => void; onClose: () => void }) {
  const [before, after] = photos;
  return <section className="card-forge overflow-hidden" style={{ borderColor: `${SAND}36` }}><div className="flex items-center justify-between p-4"><div><p className="text-[10px] uppercase tracking-widest" style={{ color: SAND }}>Vergleich</p><h2 className="text-[16px] font-semibold mt-1" style={{ color: TEXT }}>{formatDate(before.taken_on)} ↔ {formatDate(after.taken_on)}</h2></div><button onClick={onClose} className="tap p-1 cursor-pointer" aria-label="Vergleich schließen" style={{ color: DIM }}><X size={17} /></button></div><div className="relative aspect-[3/4] overflow-hidden bg-black">{urls[before.id] && <img src={urls[before.id]} alt={`Vorher: ${formatDate(before.taken_on)}`} className="absolute inset-0 h-full w-full object-cover" />}{urls[after.id] && <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${split}%` }}><img src={urls[after.id]} alt={`Nachher: ${formatDate(after.taken_on)}`} className="h-full max-w-none object-cover" style={{ width: `${10000 / split}%` }} /></div>}<span className="absolute bottom-3 left-3 rounded-full px-2 py-1 text-[9px]" style={{ background: 'rgba(22,19,15,0.78)', color: TEXT }}>{formatDate(before.taken_on)}</span><span className="absolute bottom-3 right-3 rounded-full px-2 py-1 text-[9px]" style={{ background: 'rgba(22,19,15,0.78)', color: TEXT }}>{formatDate(after.taken_on)}</span></div><div className="p-4 flex items-center gap-3"><ChevronLeft size={16} style={{ color: SAND }} /><input type="range" min="1" max="99" value={split} onChange={(event) => onSplit(Number(event.target.value))} className="flex-1 accent-[#e8c58a]" aria-label="Vergleich verschieben" /><SlidersHorizontal size={16} style={{ color: SAND }} /></div></section>;
}

function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }); }
