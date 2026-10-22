import { useRef, useState } from 'react';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import type { ForgeSessionExercise, ForgeSessionSet } from '../../api/api';
import { BORDER, DIM, FAINT, SAND, TEXT, displayLoad, formatKg, haptic, weightChips } from './shared';

const SWIPE_DELETE_THRESHOLD = 96;

interface Props {
  set: ForgeSessionSet;
  label: string;
  exercise: ForgeSessionExercise;
  active: boolean;
  readOnly: boolean;
  pending: boolean;
  justChecked: boolean;
  weightDraft: string | undefined;
  onActivate: () => void;
  onWeightInput: (raw: string) => void;
  onWeightPick: (value: number) => void;
  onWeightBlur: () => void;
  onReps: (value: number | null) => void;
  onToggle: () => void;
  onDelete: () => void;
  onToggleType: () => void;
}

export default function SetRow({
  set, label, exercise, active, readOnly, pending, justChecked, weightDraft,
  onActivate, onWeightInput, onWeightPick, onWeightBlur, onReps, onToggle, onDelete, onToggleType,
}: Props) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const warmup = set.set_type === 'warmup';
  const weightValue = weightDraft ?? (set.actual_weight_kg != null ? formatKg(set.actual_weight_kg) : '');
  const currentWeight = set.actual_weight_kg ?? set.target_weight_kg;
  const currentReps = set.actual_reps ?? set.target_reps;
  const chips = weightChips(exercise, currentWeight);
  const bodyweight = exercise.equipment === 'none';
  const canSwipe = !readOnly && !pending;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipe || (event.target as HTMLElement).closest('[data-noswipe]')) return;
    start.current = { x: event.clientX, y: event.clientY };
    swiping.current = false;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const deltaX = event.clientX - start.current.x;
    const deltaY = event.clientY - start.current.y;
    if (!swiping.current) {
      if (Math.abs(deltaY) > 12) { start.current = null; return; }
      if (deltaX < -10 && Math.abs(deltaX) > Math.abs(deltaY)) {
        swiping.current = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      } else return;
    }
    const next = Math.min(0, deltaX);
    if (dx > -SWIPE_DELETE_THRESHOLD && next <= -SWIPE_DELETE_THRESHOLD) haptic(8);
    setDx(next);
  };
  const onPointerEnd = () => {
    const wasSwiping = swiping.current;
    start.current = null;
    swiping.current = false;
    setDragging(false);
    if (!wasSwiping) return;
    if (dx <= -SWIPE_DELETE_THRESHOLD) {
      haptic(15);
      setLeaving(true);
      setDx(-480);
      window.setTimeout(onDelete, 170);
    } else {
      setDx(0);
    }
  };

  return <div className={`relative overflow-hidden rounded-2xl ${leaving ? 'forge-row-leave' : 'forge-row-enter'}`}>
    {canSwipe && <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end gap-2 pr-5 text-[12px] font-semibold" style={{ background: dx <= -SWIPE_DELETE_THRESHOLD ? 'rgba(220,38,38,0.85)' : 'rgba(220,38,38,0.35)', color: '#fff1f2', opacity: dx < 0 ? 1 : 0 }}><Trash2 size={16} />Löschen</div>}
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={() => { if (!active && !readOnly) onActivate(); }}
      className={`relative ${set.completed ? 'forge-set-done' : ''} ${justChecked ? 'forge-set-check' : ''}`}
      style={{
        transform: `translateX(${dx}px)`,
        transition: dragging ? 'none' : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        touchAction: 'pan-y',
        background: active && !set.completed ? 'rgba(232,197,138,0.06)' : 'rgba(30,26,20,0.98)',
        border: `1px solid ${active && !set.completed ? 'rgba(232,197,138,0.3)' : BORDER}`,
        borderRadius: 16,
      }}
    >
      <div className="grid items-center gap-1.5 px-2.5 py-2.5" style={{ gridTemplateColumns: '38px minmax(0,1fr) 78px 54px 46px' }}>
        <button
          type="button"
          data-noswipe
          disabled={readOnly || pending}
          onClick={(event) => { event.stopPropagation(); onToggleType(); }}
          aria-label={warmup ? 'Aufwärmsatz – tippen für Arbeitssatz' : `Arbeitssatz ${label} – tippen für Aufwärmsatz`}
          className="tap flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-semibold disabled:opacity-70"
          style={{ color: warmup ? '#16130f' : SAND, background: warmup ? SAND : 'rgba(232,197,138,0.08)', border: `1px solid ${warmup ? SAND : 'rgba(232,197,138,0.22)'}` }}
        >{warmup ? 'W' : label}</button>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider" style={{ color: FAINT }}>Ziel</p>
          <p className="truncate text-[13px] font-medium tabular-nums" style={{ color: set.completed ? DIM : TEXT }}>{displayLoad(set.target_weight_kg, set.target_reps, exercise.equipment)}</p>
        </div>
        <label data-noswipe className="block">
          <span className="sr-only">Gewicht in kg</span>
          <input
            value={weightValue}
            disabled={readOnly || pending}
            inputMode="decimal"
            enterKeyHint="next"
            onFocus={onActivate}
            onChange={(event) => onWeightInput(event.target.value)}
            onBlur={onWeightBlur}
            placeholder={set.target_weight_kg != null ? formatKg(set.target_weight_kg) : bodyweight ? 'BW' : 'kg'}
            className="input-forge !h-11 !px-1.5 !py-0 text-center text-[15px] font-semibold tabular-nums"
          />
        </label>
        <label data-noswipe className="block">
          <span className="sr-only">Wiederholungen</span>
          <input
            value={set.actual_reps ?? ''}
            disabled={readOnly || pending}
            inputMode="numeric"
            enterKeyHint="done"
            onFocus={onActivate}
            onChange={(event) => {
              const raw = event.target.value.replace(/\D/g, '').slice(0, 3);
              onReps(raw ? Math.min(200, Number(raw)) : null);
            }}
            placeholder={set.target_reps != null ? String(set.target_reps) : 'Wdh.'}
            className="input-forge !h-11 !px-1 !py-0 text-center text-[15px] font-semibold tabular-nums"
          />
        </label>
        <button
          type="button"
          data-noswipe
          disabled={readOnly || pending}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          aria-pressed={set.completed}
          aria-label={set.completed ? 'Satz wieder öffnen' : 'Satz abhaken'}
          className="tap flex h-11 w-11 items-center justify-center justify-self-end rounded-xl disabled:opacity-50"
          style={{ background: set.completed ? SAND : 'rgba(255,247,235,0.06)', color: set.completed ? '#16130f' : DIM, border: `1px solid ${set.completed ? SAND : 'rgba(255,247,235,0.1)'}` }}
        ><Check size={20} strokeWidth={2.6} /></button>
      </div>

      {active && !set.completed && !readOnly && <div data-noswipe className="forge-expand space-y-2 px-2.5 pb-3">
        {chips.length > 0 && <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }} role="group" aria-label="Gewicht wählen">
          {chips.map((value) => {
            const selected = currentWeight != null && Math.abs(value - currentWeight) < 1e-6;
            const isTarget = set.target_weight_kg != null && Math.abs(value - set.target_weight_kg) < 1e-6;
            return <button
              key={value}
              type="button"
              onClick={() => { haptic(6); onWeightPick(value); }}
              className="tap shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold tabular-nums"
              style={{ color: selected ? '#16130f' : TEXT, background: selected ? SAND : 'rgba(255,247,235,0.05)', border: `1px solid ${selected ? SAND : isTarget ? 'rgba(232,197,138,0.5)' : 'rgba(255,247,235,0.1)'}` }}
            >{formatKg(value)} kg</button>;
          })}
        </div>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px]" style={{ color: DIM }}>Wiederholungen</span>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Eine Wiederholung weniger" disabled={!currentReps || currentReps <= 1} onClick={() => { haptic(5); onReps(Math.max(1, (currentReps ?? 1) - 1)); }} className="tap flex h-10 w-12 items-center justify-center rounded-xl disabled:opacity-30" style={{ color: TEXT, background: 'rgba(255,247,235,0.06)', border: '1px solid rgba(255,247,235,0.1)' }}><Minus size={17} /></button>
            <span className="w-9 text-center text-[16px] font-semibold tabular-nums" style={{ color: TEXT }}>{currentReps ?? '–'}</span>
            <button type="button" aria-label="Eine Wiederholung mehr" onClick={() => { haptic(5); onReps(Math.min(200, (currentReps ?? 0) + 1)); }} className="tap flex h-10 w-12 items-center justify-center rounded-xl" style={{ color: TEXT, background: 'rgba(255,247,235,0.06)', border: '1px solid rgba(255,247,235,0.1)' }}><Plus size={17} /></button>
          </div>
        </div>
      </div>}
      {pending && <span className="sr-only">Wird gespeichert</span>}
    </div>
  </div>;
}
