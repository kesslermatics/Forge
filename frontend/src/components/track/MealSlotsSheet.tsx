import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import ForgeSheet from '../ForgeSheet';
import ConfirmDialog from '../ConfirmDialog';
import { createMealSlot, deleteMealSlot, renameMealSlot, reorderMealSlots, type MealSlot } from '../../api/api';
import { SlotIcon } from './shared';
import { BORDER, DIM, SAND, SLOT_SUGGESTIONS, TEXT } from './trackUtils';

interface Props {
  slots: MealSlot[];
  onChange: (slots: MealSlot[]) => void;
  onClose: () => void;
}

/** Create, rename, reorder and delete the user's own tracking slots. */
export default function MealSlotsSheet({ slots, onChange, onClose }: Props) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MealSlot | null>(null);

  const taken = new Set(slots.map((slot) => slot.name.toLowerCase()));
  const suggestions = SLOT_SUGGESTIONS.filter((item) => !taken.has(item.toLowerCase()));

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await action(); }
    catch (caught: unknown) { setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.'); }
    finally { setBusy(null); }
  };

  const add = (value: string) => run('add', async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const created = await createMealSlot(trimmed);
    onChange([...slots, created]);
    setName('');
  });

  const saveRename = (slot: MealSlot) => run(`rename-${slot.id}`, async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === slot.name) { setEditingId(null); return; }
    const updated = await renameMealSlot(slot.id, trimmed);
    onChange(slots.map((item) => item.id === slot.id ? updated : item));
    setEditingId(null);
  });

  const move = (index: number, delta: number) => run(`move-${index}`, async () => {
    const target = index + delta;
    if (target < 0 || target >= slots.length) return;
    const next = [...slots];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((slot, position) => ({ ...slot, position })));
    await reorderMealSlots(next.map((slot) => slot.id));
  });

  const remove = (slot: MealSlot) => run(`delete-${slot.id}`, async () => {
    await deleteMealSlot(slot.id);
    onChange(slots.filter((item) => item.id !== slot.id));
  });

  return <ForgeSheet label="Mahlzeiten bearbeiten" onClose={onClose}>
    <div className="p-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Deine Struktur</p>
          <h2 className="mt-1 text-[20px] font-semibold" style={{ color: TEXT }}>Mahlzeiten</h2>
          <p className="mt-1 text-[11px]" style={{ color: DIM }}>Lege an, wie du deinen Tag einteilst. Einträge bleiben beim Löschen erhalten.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
      </div>

      <div className="mt-4 space-y-1.5">
        {slots.map((slot, index) => <div key={slot.id} className="flex items-center gap-2 rounded-2xl p-2 pl-3" style={{ background: 'rgba(255,247,235,0.03)', border: `1px solid ${BORDER}` }}>
          <span className="shrink-0" style={{ color: SAND }}><SlotIcon name={slot.name} size={16} /></span>
          {editingId === slot.id
            ? <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveRename(slot); }}>
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={60} className="input-forge !py-2 text-[14px]" aria-label="Neuer Name" />
              <button type="submit" aria-label="Namen speichern" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: '#16130f', background: SAND }}>{busy === `rename-${slot.id}` ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}</button>
            </form>
            : <span className="min-w-0 flex-1 truncate text-[14px] font-medium" style={{ color: TEXT }}>{slot.name}</span>}
          {editingId !== slot.id && <div className="flex shrink-0 items-center">
            <button type="button" disabled={index === 0 || busy !== null} onClick={() => void move(index, -1)} aria-label={`${slot.name} nach oben`} className="tap flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-25" style={{ color: DIM }}><ArrowUp size={15} /></button>
            <button type="button" disabled={index === slots.length - 1 || busy !== null} onClick={() => void move(index, 1)} aria-label={`${slot.name} nach unten`} className="tap flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-25" style={{ color: DIM }}><ArrowDown size={15} /></button>
            <button type="button" onClick={() => { setEditingId(slot.id); setEditName(slot.name); }} aria-label={`${slot.name} umbenennen`} className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: SAND }}><Pencil size={14} /></button>
            <button type="button" onClick={() => setToDelete(slot)} aria-label={`${slot.name} löschen`} className="tap flex h-9 w-9 items-center justify-center rounded-full" style={{ color: DIM }}><Trash2 size={14} /></button>
          </div>}
        </div>)}
        {!slots.length && <p className="rounded-2xl px-4 py-5 text-center text-[12px]" style={{ color: DIM, border: `1px dashed ${BORDER}` }}>Noch keine Mahlzeiten angelegt.</p>}
      </div>

      <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void add(name); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Neue Mahlzeit, z. B. Pre-Workout" className="input-forge text-[14px]" aria-label="Name der neuen Mahlzeit" />
        <button type="submit" disabled={!name.trim() || busy !== null} className="btn-forge h-12 shrink-0 !px-4 disabled:opacity-40" aria-label="Mahlzeit anlegen">{busy === 'add' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={17} />}</button>
      </form>
      {suggestions.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{suggestions.map((item) => <button key={item} type="button" disabled={busy !== null} onClick={() => void add(item)} className="tap flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] disabled:opacity-50" style={{ color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` }}><Plus size={12} style={{ color: SAND }} />{item}</button>)}</div>}
      {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
    </div>
    <ConfirmDialog open={toDelete !== null} busy={busy !== null} destructive title={`„${toDelete?.name ?? ''}“ löschen?`} description="Bereits getrackte Lebensmittel bleiben im Tagebuch und erscheinen unter „Ohne Mahlzeit“." confirmLabel="Löschen" onCancel={() => setToDelete(null)} onConfirm={() => { const slot = toDelete; setToDelete(null); if (slot) void remove(slot); }} />
  </ForgeSheet>;
}
