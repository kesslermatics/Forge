import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';
import { useLanguage } from '../i18n';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = { apiKey: string | null; onClose: () => void };

export default function ApiKeyCreatedDialog({ apiKey, onClose }: Props) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const close = useCallback(() => {
    setCopied(false);
    setCopyFailed(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!apiKey) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
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
  }, [apiKey, close]);

  if (!apiKey) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return <div className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center" role="presentation">
    <button type="button" tabIndex={-1} aria-label={t('settings.apiKeyClose')} onClick={close} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="api-key-created-title" aria-describedby="api-key-created-description" className="card-forge relative z-10 w-full max-w-lg p-5 shadow-2xl" style={{ borderColor: 'rgba(232,197,138,0.34)', background: '#211c14' }}>
      <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: '#16130f', background: '#e8c58a' }}><KeyRound size={18} /></div><div className="min-w-0 flex-1"><h2 id="api-key-created-title" className="text-[17px] font-semibold" style={{ color: '#f2ece0' }}>{t('settings.apiKeyCreatedTitle')}</h2><p id="api-key-created-description" className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(242,236,226,0.62)' }}>{t('settings.apiKeyCreatedDesc')}</p></div><button type="button" onClick={close} aria-label={t('settings.apiKeyClose')} className="tap -mr-1 -mt-1 p-1" style={{ color: 'rgba(242,236,226,0.48)' }}><X size={17} /></button></div>
      <div className="mt-5 rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(232,197,138,0.18)' }}><code className="block select-all break-all font-mono text-[12px] leading-relaxed" style={{ color: '#f2ece0' }}>{apiKey}</code></div>
      {copyFailed && <p role="alert" className="mt-2 text-[11px]" style={{ color: '#f87171' }}>{t('settings.apiKeyCopyFailed')}</p>}
      <div className="mt-5 flex gap-2"><button type="button" onClick={() => void copy()} className="btn-forge flex-1 text-[12px]">{copied ? <><Check size={14} />{t('settings.apiKeyCopied')}</> : <><Copy size={14} />{t('settings.apiKeyCopy')}</>}</button><button ref={closeRef} type="button" onClick={close} className="tap flex-1 rounded-xl px-3 py-2.5 text-[12px] font-medium" style={{ color: 'rgba(242,236,226,0.72)', border: '1px solid rgba(255,247,235,0.11)' }}>{t('settings.apiKeyDone')}</button></div>
    </div>
  </div>;
}
