import { Check, Flag, HeartPulse, Loader2 } from 'lucide-react';
import type { ForgeSession } from '../../api/api';
import { BORDER, DIM, FAINT, SAND, TEXT, exerciseDone, formatClock, haptic } from './shared';

const CARDIO_MINUTES = [10, 15, 20, 30, 45, 60];

interface Props {
  session: ForgeSession;
  now: number;
  editable: boolean;
  /** Shows the finish button; only an active session can be completed. */
  canComplete: boolean;
  completing: boolean;
  onNoteChange: (value: string) => void;
  onNoteBlur: () => void;
  onCardio: (done: boolean, minutes: number | null) => void;
  onComplete: () => void;
}

/** The page after the last exercise: context for the whole workout, read by the coach and over MCP. */
export default function SessionWrapUp({ session, now, editable, canComplete, completing, onNoteChange, onNoteBlur, onCardio, onComplete }: Props) {
  const sets = session.exercises.flatMap((exercise) => exercise.sets);
  const openSets = sets.filter((set) => !set.completed).length;
  const doneExercises = session.exercises.filter(exerciseDone).length;
  const cardio = Boolean(session.cardio_done);
  const minutes = session.cardio_minutes ?? null;

  return <section className="card-forge forge-anim overflow-hidden" style={{ borderColor: `${SAND}26` }}>
    <div className="flex items-start gap-3 p-4 pb-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: SAND, background: 'rgba(232,197,138,0.1)' }}><Flag size={18} /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[21px] font-semibold leading-tight" style={{ color: TEXT }}>Abschluss</h2>
        <p className="mt-1 text-[12px] tabular-nums" style={{ color: DIM }}>
          {formatClock(session.started_at, session.completed_at, now)} · {doneExercises}/{session.exercises.length} Übungen · {sets.length - openSets}/{sets.length} Sätze
        </p>
      </div>
    </div>

    <div className="space-y-4 px-4 pb-4">
      <div>
        <p className="mb-2 text-[11px] font-medium" style={{ color: DIM }}>Zusätzlich gemacht</p>
        <button
          type="button"
          role="checkbox"
          aria-checked={cardio}
          disabled={!editable}
          onClick={() => { haptic(8); onCardio(!cardio, cardio ? null : minutes); }}
          className="tap flex min-h-14 w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left disabled:opacity-60"
          style={{ background: cardio ? 'rgba(232,197,138,0.09)' : 'rgba(255,247,235,0.03)', border: `1px solid ${cardio ? `${SAND}66` : BORDER}`, transition: 'background 0.2s, border-color 0.2s' }}
        >
          <HeartPulse size={18} style={{ color: cardio ? SAND : DIM }} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium" style={{ color: TEXT }}>Cardio</span>
            <span className="mt-0.5 block text-[11px]" style={{ color: DIM }}>Laufband, Rad, Crosstrainer… erklärt eine längere Trainingszeit</span>
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: cardio ? SAND : 'transparent', border: `1.5px solid ${cardio ? SAND : 'rgba(242,236,226,0.3)'}`, color: '#16130f', transition: 'all 0.2s' }}>
            {cardio && <Check size={15} strokeWidth={3} />}
          </span>
        </button>

        {cardio && <div className="forge-expand mt-2.5">
          <p className="mb-1.5 text-[10.5px]" style={{ color: FAINT }}>Wie lange? (optional)</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cardio-Dauer">
            {CARDIO_MINUTES.map((value) => {
              const selected = minutes === value;
              return <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!editable}
                onClick={() => { haptic(6); onCardio(true, selected ? null : value); }}
                className="tap h-9 min-w-[52px] rounded-full px-3 text-[12.5px] font-medium tabular-nums disabled:opacity-60"
                style={selected ? { color: '#16130f', background: SAND } : { color: TEXT, background: 'rgba(255,247,235,0.04)', border: `1px solid ${BORDER}` }}
              >{value} min</button>;
            })}
          </div>
        </div>}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium" style={{ color: DIM }}>Trainingsnotiz</span>
        <textarea
          value={session.training_note ?? ''}
          disabled={!editable}
          rows={3}
          maxLength={2000}
          onChange={(event) => onNoteChange(event.target.value)}
          onBlur={onNoteBlur}
          placeholder="z. B. wenig geschlafen, Studio voll, danach 20 min Laufband…"
          className="input-forge min-h-[88px] resize-y text-[13.5px] leading-relaxed"
        />
        <span className="mt-1 block text-[10.5px]" style={{ color: FAINT }}>Gilt für das ganze Training. Der Coach sieht die Notiz und das Cardio bei künftigen Auswertungen.</span>
      </label>

      {canComplete && <div className="pt-1">
        {openSets > 0 && <p className="mb-2 text-center text-[11px]" style={{ color: DIM }}>{openSets === 1 ? '1 Satz ist' : `${openSets} Sätze sind`} noch nicht abgehakt.</p>}
        <button type="button" onClick={onComplete} disabled={completing} className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold disabled:opacity-60" style={{ color: '#16130f', background: SAND }}>
          {completing && <Loader2 size={16} className="animate-spin" />}Training beenden
        </button>
      </div>}
    </div>
  </section>;
}
