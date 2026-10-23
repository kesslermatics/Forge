import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';

interface Props {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  /** Full height on phones; the children own scrolling (e.g. sticky header and footer). */
  fullscreen?: boolean;
}

// Open sheets in stacking order: only the top one reacts to Escape and traps focus.
const openSheets: symbol[] = [];

export default function ForgeSheet({ label, onClose, children, closeOnBackdrop = true, fullscreen = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const id = Symbol(label);
    openSheets.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!fullscreen) focusable()[0]?.focus();
    else panel?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== id) return;
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) return;
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openSheets.indexOf(id);
      if (index >= 0) openSheets.splice(index, 1);
      if (!openSheets.length) document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [fullscreen, label]);

  return createPortal(
    <div className="forge-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={fullscreen
          ? 'forge-sheet-panel flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden outline-none sm:h-[88dvh] sm:rounded-[26px]'
          : 'forge-sheet-panel max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[26px] p-4 outline-none sm:rounded-[26px]'}
        style={{ background: '#1d1913', border: fullscreen ? undefined : '1px solid rgba(232,197,138,0.28)' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
