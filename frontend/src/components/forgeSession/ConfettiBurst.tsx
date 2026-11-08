import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

const COLORS = ['#e8c58a', '#83d6ad', '#f2ece0', '#f5d9a8', '#a8e6c8'];

// Fixed pattern (no randomness during render): golden-angle spread, biased upwards, mixed distances and shapes.
const FLAKES = Array.from({ length: 34 }, (_, index) => {
  const angle = ((index * 137.5) % 360) * (Math.PI / 180);
  const distance = 46 + ((index * 53) % 70);
  return {
    x: Math.round(Math.cos(angle) * distance * 1.25),
    y: Math.round(Math.sin(angle) * distance * 0.8 - 26),
    r: ((index * 97) % 2 === 0 ? 1 : -1) * (180 + ((index * 41) % 260)),
    fall: 34 + ((index * 29) % 46),
    d: ((index * 7) % 10) * 0.012,
    w: index % 3 === 0 ? 6 : 5,
    h: index % 3 === 0 ? 6 : 10,
    round: index % 3 === 0,
    c: COLORS[index % COLORS.length],
  };
});

/**
 * Confetti burst centred on its spot in the layout. The flakes are drawn in a portal on the page itself,
 * so rows with overflow hidden or transforms cannot clip them. Mount it to play it once.
 */
export default function ConfettiBurst() {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  // Stable callback: measured once on mount, not on every render.
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const box = node.getBoundingClientRect();
    setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, []);

  return <>
    <span ref={anchor} aria-hidden="true" className="pointer-events-none absolute inset-0" />
    {origin && createPortal(
      <div aria-hidden="true" className="pointer-events-none fixed z-[90]" style={{ left: origin.x, top: origin.y, width: 0, height: 0 }}>
        {FLAKES.map((flake, index) => <span
          key={index}
          className="forge-confetti"
          style={{
            width: flake.w, height: flake.h, borderRadius: flake.round ? '50%' : 1.5, background: flake.c,
            ['--x' as string]: `${flake.x}px`, ['--y' as string]: `${flake.y}px`, ['--r' as string]: `${flake.r}deg`,
            ['--fall' as string]: `${flake.fall}px`, ['--d' as string]: `${flake.d}s`,
          }}
        />)}
      </div>,
      document.body,
    )}
  </>;
}
