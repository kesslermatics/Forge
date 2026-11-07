import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraOff, Flashlight, Keyboard, Loader2, ScanBarcode, Search, X } from 'lucide-react';
import { lookupBarcode, type FoodDetail } from '../../api/api';
import { haptic, useBackDismiss } from '../navigation';
import { DIM, SAND, TEXT } from './trackUtils';

interface Props {
  onFound: (food: FoodDetail) => void;
  onOpenSearch: () => void;
  onClose: () => void;
}

type Phase = 'starting' | 'scanning' | 'looking' | 'not-found' | 'denied' | 'error';

interface DetectorLike { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (options: { formats: string[] }) => DetectorLike;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

/** Full-screen camera scanner. Uses the native BarcodeDetector where available, ZXing otherwise (iOS Safari). */
export default function BarcodeScannerSheet({ onFound, onOpenSearch, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const busyRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('starting');
  const [message, setMessage] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // Parent callbacks change identity on every render; refs keep the camera running.
  const onFoundRef = useRef(onFound);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onFoundRef.current = onFound; onCloseRef.current = onClose; }, [onFound, onClose]);
  useBackDismiss(onClose);

  const stopCamera = useCallback(() => {
    stopRef.current();
    stopRef.current = () => undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const handleCode = useCallback(async (raw: string) => {
    const code = raw.replace(/\D/g, '');
    if (busyRef.current || code.length < 6) return;
    busyRef.current = true;
    setLastCode(code); setPhase('looking'); setMessage(null);
    haptic('success');
    try {
      const food = await lookupBarcode(code);
      stopCamera();
      onFoundRef.current(food);
    } catch (caught: unknown) {
      setMessage(caught instanceof Error ? caught.message : 'Produkt nicht gefunden.');
      setPhase('not-found');
    } finally { busyRef.current = false; }
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setPhase('starting'); setMessage(null); busyRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) { setPhase('error'); setMessage('Dein Browser unterstützt keinen Kamerazugriff.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(Boolean(capabilities.torch));
      setPhase('scanning');

      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
      const nativeFormats = Native?.getSupportedFormats ? await Native.getSupportedFormats().catch(() => []) : [];
      if (Native && FORMATS.some((format) => nativeFormats.includes(format))) {
        const detector = new Native({ formats: FORMATS.filter((format) => nativeFormats.includes(format)) });
        let active = true;
        let timer = 0;
        const tick = async () => {
          if (!active) return;
          if (!busyRef.current && video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) void handleCode(codes[0].rawValue);
            } catch { /* frame not ready */ }
          }
          timer = window.setTimeout(() => void tick(), 140);
        };
        void tick();
        stopRef.current = () => { active = false; window.clearTimeout(timer); };
        return;
      }

      // Fallback: ZXing, lazy-loaded so the main bundle stays small.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) void handleCode(result.getText());
      });
      stopRef.current = () => controls.stop();
    } catch (caught: unknown) {
      const name = caught instanceof DOMException ? caught.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPhase('denied');
        setMessage('Kein Kamerazugriff. Erlaube die Kamera in den Browser-Einstellungen oder gib den Barcode ein.');
      } else {
        setPhase('error');
        setMessage('Die Kamera konnte nicht gestartet werden.');
      }
    }
  }, [handleCode, stopCamera]);

  useEffect(() => {
    void startCamera();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { stopCamera(); document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); };
  }, [startCamera, stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn(!torchOn);
    } catch { setTorchAvailable(false); }
  };

  const resume = () => { setPhase('scanning'); setMessage(null); busyRef.current = false; if (!streamRef.current) void startCamera(); };
  const cameraLive = phase === 'scanning' || phase === 'looking' || phase === 'not-found';

  return createPortal(<div className="forge-sheet-backdrop fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Barcode scannen">
    <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ opacity: cameraLive ? 1 : 0, transition: 'opacity 0.3s' }} />
    <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 38% at 50% 44%, transparent 60%, rgba(0,0,0,0.62) 100%)' }} />

    <div className="relative z-10 flex items-center justify-between p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <button type="button" onClick={onClose} aria-label="Scanner schließen" className="tap flex h-11 w-11 items-center justify-center rounded-full" style={{ color: TEXT, background: 'rgba(22,19,15,0.6)', backdropFilter: 'blur(12px)' }}><X size={20} /></button>
      <p className="rounded-full px-3.5 py-1.5 text-[12px] font-medium" style={{ color: TEXT, background: 'rgba(22,19,15,0.6)', backdropFilter: 'blur(12px)' }}>Barcode scannen</p>
      {torchAvailable ? <button type="button" onClick={() => void toggleTorch()} aria-label={torchOn ? 'Licht aus' : 'Licht an'} aria-pressed={torchOn} className="tap flex h-11 w-11 items-center justify-center rounded-full" style={{ color: torchOn ? '#16130f' : TEXT, background: torchOn ? SAND : 'rgba(22,19,15,0.6)', backdropFilter: 'blur(12px)' }}><Flashlight size={18} /></button> : <span className="w-11" />}
    </div>

    <div className="relative z-10 flex flex-1 items-center justify-center px-8">
      {cameraLive ? <div className="relative h-[34vw] max-h-48 w-full max-w-sm" style={{ ['--scan-h' as string]: 'calc(100% - 2px)' }}>
        {['left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl', 'right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl', 'left-0 bottom-0 border-l-2 border-b-2 rounded-bl-2xl', 'right-0 bottom-0 border-r-2 border-b-2 rounded-br-2xl']
          .map((corner) => <span key={corner} className={`absolute h-8 w-8 ${corner}`} style={{ borderColor: SAND }} />)}
        {phase === 'scanning' && <span className="track-scan-line absolute inset-x-3 top-0 h-0.5 rounded-full" style={{ background: SAND, boxShadow: `0 0 14px ${SAND}` }} />}
        {phase === 'looking' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl" style={{ background: 'rgba(22,19,15,0.7)' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: SAND }} />
          <p className="text-[12px] tabular-nums" style={{ color: TEXT }}>{lastCode}</p>
        </div>}
      </div> : phase === 'starting' ? <Loader2 size={26} className="animate-spin" style={{ color: SAND }} />
        : <div className="max-w-xs text-center"><CameraOff size={28} className="mx-auto" style={{ color: SAND }} /><p className="mt-3 text-[13px] leading-relaxed" style={{ color: TEXT }}>{message}</p>
          {phase === 'error' && <button type="button" onClick={() => void startCamera()} className="btn-forge mt-4 h-11 text-[13px]">Erneut versuchen</button>}</div>}
    </div>

    <div className="relative z-10 space-y-3 p-4" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      {phase === 'not-found' && <div className="forge-toast rounded-3xl p-4" style={{ background: 'rgba(29,25,19,0.94)', border: `1px solid ${SAND}44`, backdropFilter: 'blur(16px)' }}>
        <p className="text-[14px] font-semibold" style={{ color: TEXT }}>Kein Produkt zu {lastCode}</p>
        <p className="mt-1 text-[12px]" style={{ color: DIM }}>{message}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={resume} className="tap h-11 rounded-xl text-[13px] font-medium" style={{ color: TEXT, border: '1px solid rgba(255,247,235,0.14)' }}>Weiter scannen</button>
          <button type="button" onClick={() => { stopCamera(); onOpenSearch(); }} className="tap flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold" style={{ color: '#16130f', background: SAND }}><Search size={15} />Suchen</button>
        </div>
      </div>}
      {phase === 'scanning' && !manualOpen && <p className="text-center text-[12px]" style={{ color: 'rgba(242,236,226,0.8)' }}><ScanBarcode size={14} className="mr-1.5 inline" style={{ color: SAND }} />Halte den Barcode in den Rahmen</p>}
      {manualOpen || phase === 'denied' || phase === 'error'
        ? <form onSubmit={(event) => { event.preventDefault(); if (manual.trim()) void handleCode(manual); }} className="flex gap-2">
          <input value={manual} onChange={(event) => setManual(event.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={14} autoFocus={manualOpen} placeholder="Barcode eingeben" aria-label="Barcode eingeben" className="input-forge text-[15px] tabular-nums" style={{ background: 'rgba(22,19,15,0.85)' }} />
          <button type="submit" disabled={manual.replace(/\D/g, '').length < 6 || phase === 'looking'} className="btn-forge h-12 shrink-0 !px-4 text-[13px] disabled:opacity-40">Suchen</button>
        </form>
        : <button type="button" onClick={() => setManualOpen(true)} className="tap mx-auto flex h-10 items-center gap-2 rounded-full px-4 text-[12px] font-medium" style={{ color: TEXT, background: 'rgba(22,19,15,0.6)', backdropFilter: 'blur(12px)' }}><Keyboard size={14} style={{ color: SAND }} />Barcode eintippen</button>}
    </div>
  </div>, document.body);
}
