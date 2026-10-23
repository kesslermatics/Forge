import { useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 8;
const EDGE = 90;

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (from: number, to: number) => void;
  renderItem: (item: T, index: number, state: { dragging: boolean }) => React.ReactNode;
  disabled?: boolean;
  className?: string;
}

type Rect = { top: number; height: number };
type Drag = { from: number; to: number; offset: number; rects: Rect[]; gap: number };

const vibrate = (pattern: number) => {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
};

/**
 * Vertical list sortable by long-press and drag (touch and mouse). A short swipe or tap
 * passes through to the item, so rows can still expand, swipe or scroll. Elements marked
 * with ``data-nodrag`` (inputs, steppers) never start a drag.
 */
export default function SortableList<T>({ items, getKey, onReorder, renderItem, disabled = false, className }: Props<T>) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const press = useRef<{ index: number; x: number; y: number; scrollY: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pointerY = useRef(0);
  const suppressClick = useRef(false);
  const scrollFrame = useRef<number | null>(null);

  const update = (next: Drag | null) => { dragRef.current = next; setDrag(next); };

  const targetIndex = (current: Drag, offset: number) => {
    const { from, rects } = current;
    const startRect = rects[from];
    if (!startRect) return from;
    const center = startRect.top + startRect.height / 2 + offset;
    let to = from;
    rects.forEach((rect, index) => {
      const middle = rect.top + rect.height / 2;
      if (index > from && center > middle) to = Math.max(to, index);
      if (index < from && center < middle) to = Math.min(to, index);
    });
    return to;
  };

  const move = (clientY: number) => {
    const current = dragRef.current;
    if (!current || !press.current) return;
    const offset = clientY + window.scrollY - press.current.y - press.current.scrollY;
    update({ ...current, offset, to: targetIndex(current, offset) });
  };

  // While dragging the page must not scroll; near the screen edges it scrolls on purpose.
  useEffect(() => {
    if (!drag) return;
    const blockScroll = (event: TouchEvent) => { if (dragRef.current) event.preventDefault(); };
    document.addEventListener('touchmove', blockScroll, { passive: false });
    const tick = () => {
      const y = pointerY.current;
      const speed = y < EDGE ? -Math.ceil((EDGE - y) / 8) : y > window.innerHeight - EDGE ? Math.ceil((y - (window.innerHeight - EDGE)) / 8) : 0;
      if (speed) { window.scrollBy(0, speed); move(y); }
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener('touchmove', blockScroll);
      if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    if (!dragRef.current) press.current = null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (disabled || items.length < 2 || event.button !== 0 || (event.target as HTMLElement).closest('[data-nodrag]')) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    pointerY.current = event.clientY;
    press.current = {
      index, x: event.clientX, y: event.clientY, scrollY: window.scrollY,
      timer: setTimeout(() => {
        const rects = itemRefs.current.slice(0, items.length).map((item) => {
          const rect = item?.getBoundingClientRect();
          return { top: (rect?.top ?? 0) + window.scrollY, height: rect?.height ?? 0 };
        });
        const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].top - rects[0].height) : 0;
        try { element.setPointerCapture(pointerId); } catch { /* pointer already gone */ }
        vibrate(15);
        update({ from: index, to: index, offset: 0, rects, gap });
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerY.current = event.clientY;
    if (dragRef.current) { move(event.clientY); return; }
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) cancelPress();
  };

  const onPointerEnd = () => {
    const current = dragRef.current;
    cancelPress();
    press.current = null;
    if (!current) return;
    suppressClick.current = true;
    update(null);
    if (current.to !== current.from) { vibrate(8); onReorder(current.from, current.to); }
  };

  const shiftFor = (index: number) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.offset;
    const height = (drag.rects[drag.from]?.height ?? 0) + drag.gap;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -height;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return height;
    return 0;
  };

  return <div className={className}>
    {items.map((item, index) => <div
      key={getKey(item)}
      ref={(element) => { itemRefs.current[index] = element; }}
      className={`forge-sortable-item ${drag?.from === index ? 'is-dragging' : ''}`}
      style={{ transform: `translateY(${shiftFor(index)}px)`, touchAction: drag ? 'none' : 'pan-y' }}
      onPointerDown={(event) => onPointerDown(event, index)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(event) => { if (!(event.target as HTMLElement).closest('input, textarea')) event.preventDefault(); }}
      onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); } }}
    >
      {renderItem(item, index, { dragging: drag?.from === index })}
    </div>)}
  </div>;
}
