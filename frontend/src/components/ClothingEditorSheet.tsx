import { useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus, Trash2, X } from 'lucide-react';
import ForgeSheet from './ForgeSheet';
import { saveWeightClothing, type ClothingItem } from '../api/api';
import { haptic } from './navigation';
import { CLOTHING_ICONS, CLOTHING_ICON_KEYS, type ClothingIconKey } from './clothingIcons';
import ClothingIcon from './ClothingIcon';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.52)';
const BORDER = 'rgba(232,197,138,0.12)';
const MAX_ITEMS = 6;

interface Row { key: string; id?: string; name: string; weight: string; icon: ClothingIconKey }

interface Props {
  items: ClothingItem[];
  onSaved: (items: ClothingItem[]) => void;
  onClose: () => void;
}

const fieldStyle = { color: TEXT, background: 'rgba(255,247,235,0.05)', border: `1px solid ${BORDER}` };

/** Define what is subtracted from the scale: name, weight in grams and an icon with preview. */
export default function ClothingEditorSheet({ items, onSaved, onClose }: Props) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => items.map((item) => ({
    key: item.id, id: item.id, name: item.name, weight: String(item.weight_g), icon: item.icon as ClothingIconKey,
  })));
  const [openIcon, setOpenIcon] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (key: string, changes: Partial<Row>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...changes } : row));
  const add = () => {
    counter.current += 1;
    const key = `new-${counter.current}`;
    setRows((current) => [...current, { key, name: '', weight: '', icon: 'shirt' }]);
    setOpenIcon(null);
  };
  const remove = (key: string) => { setRows((current) => current.filter((row) => row.key !== key)); setOpenIcon(null); };

  const save = async () => {
    const payload = rows.map((row) => ({ id: row.id, name: row.name.trim(), weight_g: Number(row.weight.replace(',', '.')), icon: row.icon }));
    if (payload.some((item) => !item.name)) { setError('Jeder Eintrag braucht einen Namen.'); return; }
    if (payload.some((item) => !Number.isFinite(item.weight_g) || item.weight_g < 1 || item.weight_g > 5000)) { setError('Das Gewicht muss zwischen 1 und 5000 g liegen.'); return; }
    setSaving(true); setError(null);
    try {
      const saved = await saveWeightClothing(payload.map((item) => ({ ...item, weight_g: Math.round(item.weight_g) })));
      haptic('success');
      onSaved(saved.items);
      onClose();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Speichern fehlgeschlagen.');
      setSaving(false);
    }
  };

  return <ForgeSheet label="Kleidung beim Wiegen" onClose={onClose}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[18px] font-semibold leading-snug" style={{ color: TEXT }}>Kleidung beim Wiegen</h2>
        <p className="mt-0.5 text-[12px]" style={{ color: DIM }}>Das Gewicht wird beim Antippen vom Wert abgezogen.</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Schließen" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.05)' }}><X size={18} /></button>
    </div>

    <ul className="mt-4 space-y-2">
      {rows.map((row, index) => <li key={row.key} className="rounded-2xl p-2" style={{ background: 'rgba(255,247,235,0.035)', border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpenIcon(openIcon === row.key ? null : row.key)} aria-expanded={openIcon === row.key} aria-label={`Icon wählen, aktuell ${CLOTHING_ICONS[row.icon].label}`}
            className="tap flex h-11 shrink-0 items-center gap-0.5 rounded-xl pl-2.5 pr-1.5" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}>
            <ClothingIcon icon={row.icon} size={20} />
            <ChevronDown size={13} style={{ transform: openIcon === row.key ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
          </button>
          <input value={row.name} onChange={(event) => patch(row.key, { name: event.target.value.slice(0, 24) })} placeholder="Name" aria-label={`Name ${index + 1}`}
            className="h-11 min-w-0 flex-1 rounded-xl px-3 text-[16px] outline-none" style={fieldStyle} />
          <div className="relative shrink-0">
            <input value={row.weight} onChange={(event) => patch(row.key, { weight: event.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="0" aria-label={`Gewicht in Gramm ${index + 1}`}
              className="h-11 w-[84px] rounded-xl pl-3 pr-7 text-right text-[16px] tabular-nums outline-none" style={fieldStyle} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: DIM }}>g</span>
          </div>
          <button type="button" onClick={() => remove(row.key)} aria-label={`${row.name || 'Eintrag'} löschen`}
            className="tap flex h-11 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color: DIM }}><Trash2 size={16} /></button>
        </div>
        {openIcon === row.key && <div className="forge-expand mt-2 grid grid-cols-6 gap-1.5" role="listbox" aria-label="Icon">
          {CLOTHING_ICON_KEYS.map((key) => <button key={key} type="button" role="option" aria-selected={row.icon === key} aria-label={CLOTHING_ICONS[key].label} title={CLOTHING_ICONS[key].label}
            onClick={() => { patch(row.key, { icon: key }); setOpenIcon(null); haptic('tap'); }}
            className="tap flex h-11 items-center justify-center rounded-xl"
            style={row.icon === key ? { color: '#16130f', background: SAND } : { color: TEXT, background: 'rgba(255,247,235,0.05)' }}>
            <ClothingIcon icon={key} size={20} />
          </button>)}
        </div>}
      </li>)}
    </ul>

    {rows.length < MAX_ITEMS && <button type="button" onClick={add} className="tap mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium" style={{ color: SAND, border: `1px dashed ${BORDER}` }}><Plus size={15} />Hinzufügen</button>}
    {error && <p className="mt-3 rounded-xl px-3 py-2.5 text-[12px]" style={{ color: '#fca5a5', background: 'rgba(248,113,113,0.1)' }}>{error}</p>}
    <button type="button" onClick={() => void save()} disabled={saving} className="btn-forge mt-3 h-12 w-full text-[14px]">{saving ? <Loader2 size={16} className="animate-spin" /> : 'Speichern'}</button>
  </ForgeSheet>;
}
