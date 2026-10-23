import { Cable, Cog, Dumbbell, PersonStanding, Shapes, Weight } from 'lucide-react';
import type { ForgeEquipment } from '../../api/api';

const ICONS = { machine: Cog, cable: Cable, barbell: Dumbbell, dumbbell: Dumbbell, kettlebell: Weight, none: PersonStanding, other: Shapes } as const;

/** Rounded equipment badge used in every exercise list. */
export default function EquipmentIcon({ equipment, size = 40, active = false }: { equipment: ForgeEquipment | string; size?: number; active?: boolean }) {
  const Icon = ICONS[equipment as ForgeEquipment] ?? Shapes;
  return <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-xl" style={{
    width: size, height: size,
    color: active ? '#16130f' : '#e8c58a',
    background: active ? '#e8c58a' : 'rgba(232,197,138,0.1)',
    border: `1px solid ${active ? '#e8c58a' : 'rgba(232,197,138,0.16)'}`,
  }}><Icon size={Math.round(size * 0.45)} /></span>;
}
