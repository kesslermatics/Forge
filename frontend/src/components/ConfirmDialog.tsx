import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  destructive?: boolean;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel, busy = false, destructive = false }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="presentation">
    <button type="button" tabIndex={-1} aria-label="Dialog schließen" disabled={busy} onClick={onCancel} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
    <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="forge-confirm-title" aria-describedby="forge-confirm-description" className="forge-confirm-dialog card-forge relative z-10 w-full max-w-sm p-5 shadow-2xl" style={{ borderColor: destructive ? 'rgba(248,113,113,0.35)' : 'rgba(232,197,138,0.34)', background: '#211c14' }}>
      <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: destructive ? '#fecaca' : '#16130f', background: destructive ? 'rgba(248,113,113,0.18)' : '#e8c58a' }}><AlertTriangle size={18} /></div><div className="min-w-0 flex-1"><h2 id="forge-confirm-title" className="text-[17px] font-semibold" style={{ color: '#f2ece0' }}>{title}</h2><p id="forge-confirm-description" className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.62)' }}>{description}</p></div><button type="button" onClick={onCancel} disabled={busy} className="tap -mr-1 -mt-1 p-1 disabled:opacity-40" aria-label="Abbrechen" style={{ color: 'rgba(242,236,226,0.48)' }}><X size={17} /></button></div>
      <div className="mt-5 flex gap-2"><button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="tap flex-1 rounded-xl px-3 py-2.5 text-[12px] font-medium disabled:opacity-50" style={{ color: 'rgba(242,236,226,0.72)', border: '1px solid rgba(255,247,235,0.11)' }}>Abbrechen</button><button type="button" onClick={onConfirm} disabled={busy} className="tap flex-1 rounded-xl px-3 py-2.5 text-[12px] font-semibold disabled:opacity-50" style={{ color: destructive ? '#fff1f2' : '#16130f', background: destructive ? 'rgba(220,38,38,0.82)' : '#e8c58a' }}>{busy ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" />Wird ausgeführt…</span> : confirmLabel}</button></div>
    </div>
  </div>;
}
