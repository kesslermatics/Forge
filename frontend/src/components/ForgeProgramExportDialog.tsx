import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { ForgeProgram } from '../api/api';
import { buildProgramExport } from './forgeProgramExport';

const SAND = '#e8c58a';
const TEXT = '#f2ece0';
const DIM = 'rgba(242,236,226,0.48)';

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback unten */ }
  // Fallback für unsichere Kontexte (z. B. http im lokalen Netz).
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { document.body.removeChild(area); }
}

// Wird nur bei geöffnetem Dialog gemountet, dadurch startet der Kopier-Status jedes Mal frisch.
type Props = { program: ForgeProgram; onClose: () => void };

export default function ForgeProgramExportDialog({ program, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null);
  const json = useMemo(() => JSON.stringify(buildProgramExport(program), null, 2), [program]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
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
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => setCopied((await copyText(json)) ? 'ok' : 'error');

  return <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="presentation">
    <button type="button" tabIndex={-1} aria-label="Dialog schließen" onClick={onClose} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="forge-export-title" className="card-forge relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col p-5 shadow-2xl" style={{ borderColor: 'rgba(232,197,138,0.34)', background: '#211c14' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: SAND }}>Export</p><h2 id="forge-export-title" className="mt-1 truncate text-[17px] font-semibold" style={{ color: TEXT }}>{program.name}</h2></div>
        <button ref={closeRef} type="button" onClick={onClose} className="tap -mr-1 -mt-1 p-1" aria-label="Schließen" style={{ color: DIM }}><X size={17} /></button>
      </div>
      <textarea readOnly value={json} aria-label="Plan als JSON" spellCheck={false} onFocus={(event) => event.currentTarget.select()} className="mt-4 min-h-[220px] w-full flex-1 resize-none rounded-xl p-3 font-mono text-[11px] leading-relaxed" style={{ color: TEXT, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,247,235,0.08)' }} />
      <button type="button" onClick={() => void handleCopy()} className="btn-forge mt-4 flex w-full items-center justify-center gap-2">{copied === 'ok' ? <Check size={14} /> : <Copy size={14} />}{copied === 'ok' ? 'Kopiert' : copied === 'error' ? 'Kopieren fehlgeschlagen' : 'JSON kopieren'}</button>
      <p className="sr-only" role="status" aria-live="polite">{copied === 'ok' ? 'In die Zwischenablage kopiert' : ''}</p>
    </div>
  </div>;
}
