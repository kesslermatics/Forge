import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

const THRESHOLD = 96;

/** Swipe a row to the left to delete it. Vertical movement keeps scrolling the page. */
export default function SwipeToDelete({ onDelete, disabled = false, label = 'Entfernen', children }: {
  onDelete: () => void; disabled?: boolean; label?: string; children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);

  const end = () => {
    const wasSwiping = swiping.current;
    start.current = null; swiping.current = false; setDragging(false);
    if (!wasSwiping) return;
    if (dx <= -THRESHOLD) {
      try { navigator.vibrate?.(15); } catch { /* unsupported */ }
      setDx(-520);
      window.setTimeout(() => { onDelete(); setDx(0); }, 170);
    } else setDx(0);
  };

  return <div className="relative overflow-hidden rounded-2xl">
    {!disabled && <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end gap-2 pr-5 text-[12px] font-semibold" style={{ background: dx <= -THRESHOLD ? 'rgba(220,38,38,0.85)' : 'rgba(220,38,38,0.35)', color: '#fff1f2', opacity: dx < 0 ? 1 : 0 }}><Trash2 size={16} />{label}</div>}
    <div
      onPointerDown={(event) => { if (!disabled && !(event.target as HTMLElement).closest('[data-noswipe], input, textarea')) { start.current = { x: event.clientX, y: event.clientY }; swiping.current = false; } }}
      onPointerMove={(event) => {
        if (!start.current || disabled) return;
        const deltaX = event.clientX - start.current.x;
        const deltaY = event.clientY - start.current.y;
        if (!swiping.current) {
          if (Math.abs(deltaY) > 12) { start.current = null; return; }
          if (deltaX < -12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            swiping.current = true; setDragging(true);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
          } else return;
        }
        const next = Math.min(0, deltaX);
        if (dx > -THRESHOLD && next <= -THRESHOLD) { try { navigator.vibrate?.(8); } catch { /* unsupported */ } }
        setDx(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClickCapture={(event) => { if (dx !== 0) { event.stopPropagation(); event.preventDefault(); } }}
      style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
    >{children}</div>
  </div>;
}
