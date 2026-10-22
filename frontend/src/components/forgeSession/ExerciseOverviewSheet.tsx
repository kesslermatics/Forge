import { ArrowDown, ArrowUp, Check, X } from 'lucide-react';
import type { ForgeSessionExercise } from '../../api/api';
import ForgeSheet from '../ForgeSheet';
import { BORDER, DIM, SAND, TEXT, exerciseDone } from './shared';

interface Props {
  exercises: ForgeSessionExercise[];
  activeIndex: number;
  readOnly: boolean;
  onJump: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onClose: () => void;
}

/** Compact list of all exercises: jump to one or change the order. */
export default function ExerciseOverviewSheet({ exercises, activeIndex, readOnly, onJump, onMove, onClose }: Props) {
  return <ForgeSheet label="Übungsübersicht" onClose={onClose}>
    <div className="flex items-center justify-between gap-3 pb-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Übersicht</p>
        <h2 className="mt-1 text-[18px] font-semibold" style={{ color: TEXT }}>Reihenfolge</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="Übersicht schließen" className="tap flex h-10 w-10 items-center justify-center rounded-full" style={{ color: DIM, background: 'rgba(255,247,235,0.06)' }}><X size={18} /></button>
    </div>
    <ol className="space-y-2">
      {exercises.map((exercise, index) => {
        const done = exerciseDone(exercise);
        const completed = exercise.sets.filter((set) => set.completed).length;
        const current = index === activeIndex;
        return <li key={exercise.id} className="forge-row-enter flex items-center gap-2 rounded-2xl p-2" style={{ background: current ? 'rgba(232,197,138,0.09)' : 'rgba(255,247,235,0.03)', border: `1px solid ${current ? `${SAND}55` : BORDER}` }}>
          <button type="button" onClick={() => onJump(index)} className="tap flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold" style={{ color: done ? '#16130f' : SAND, background: done ? SAND : 'rgba(232,197,138,0.08)' }}>{done ? <Check size={16} /> : index + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium" style={{ color: TEXT }}>{exercise.name}</span>
              <span className="mt-0.5 block text-[11px]" style={{ color: DIM }}>{completed}/{exercise.sets.length} Sätze{exercise.machine_profile_name ? ` · ${exercise.machine_profile_name}` : ''}</span>
            </span>
          </button>
          {!readOnly && <div className="flex shrink-0 gap-1">
            <button type="button" disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`${exercise.name} nach oben`} className="tap flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-20" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ArrowUp size={17} /></button>
            <button type="button" disabled={index === exercises.length - 1} onClick={() => onMove(index, index + 1)} aria-label={`${exercise.name} nach unten`} className="tap flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-20" style={{ color: SAND, background: 'rgba(255,247,235,0.05)' }}><ArrowDown size={17} /></button>
          </div>}
        </li>;
      })}
    </ol>
    {!readOnly && <p className="mt-3 text-[11px]" style={{ color: DIM }}>Eine neue Reihenfolge wird beim Beenden als Planänderung angeboten.</p>}
  </ForgeSheet>;
}
