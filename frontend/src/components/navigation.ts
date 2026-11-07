import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * PWA-friendly navigation helpers.
 *
 * Installed as an app, Forge is driven by the phone's back gesture/button. Overlays therefore get
 * their own history entry (back closes the overlay, not the page) and in-app back buttons step
 * back through history instead of pushing the parent route again.
 */

/** True when the current entry was reached by navigating inside the app (react-router keeps idx). */
export function canGoBack(): boolean {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

/** Back button handler: history back when possible, otherwise replace with the parent route. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    if (canGoBack()) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [fallback, navigate]);
}

// A sheet closed by code calls history.back(); a sheet opened in the same tick must wait for that
// popstate, otherwise the back would pop the new sheet's entry instead of the old one.
let pendingBack = false;
const waiting: (() => void)[] = [];
const liveOverlays = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (pendingBack) {
      pendingBack = false;
      waiting.splice(0).forEach((push) => push());
      return;
    }
    // Landing on the entry of an overlay that is no longer open (it closed while the app
    // navigated on): skip it, so one back press always reaches the previous screen.
    const key = (window.history.state as { forgeOverlay?: string } | null)?.forgeOverlay;
    if (key && !liveOverlays.has(key)) window.history.back();
  });
}

/**
 * Gives an overlay its own history entry while mounted: the system back closes it. When the
 * overlay closes another way, its entry is removed again so history stays clean. If the parent
 * navigates away while closing, it should use `replace` so the overlay entry is overwritten.
 */
export function useBackDismiss(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const key = Math.random().toString(36).slice(2);
    let pushed = false;
    let closedByBack = false;
    const push = () => {
      window.history.pushState({ ...(window.history.state ?? {}), forgeOverlay: key }, '');
      pushed = true;
    };
    liveOverlays.add(key);
    const onPop = () => {
      if (!pushed || closedByBack) return;
      // Still on (or back on) this overlay's entry: a nested overlay above it was closed.
      if ((window.history.state as { forgeOverlay?: string } | null)?.forgeOverlay === key) return;
      closedByBack = true;
      onCloseRef.current();
    };
    if (pendingBack) waiting.push(push);
    else push();
    window.addEventListener('popstate', onPop);
    return () => {
      liveOverlays.delete(key);
      window.removeEventListener('popstate', onPop);
      const index = waiting.indexOf(push);
      if (index >= 0) waiting.splice(index, 1);
      if (pushed && !closedByBack && (window.history.state as { forgeOverlay?: string } | null)?.forgeOverlay === key) {
        pendingBack = true;
        window.history.back();
      }
    };
  }, []);
}

/** Render-only helper for overlays whose visibility is a prop (they stay mounted while closed). */
export function BackDismiss({ onClose }: { onClose: () => void }) {
  useBackDismiss(onClose);
  return null;
}

/** Short vibration on supporting devices (Android); silently ignored elsewhere. */
export function haptic(kind: 'tap' | 'success' | 'warning' = 'tap') {
  const pattern = kind === 'success' ? [14] : kind === 'warning' ? [18, 40, 18] : [8];
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
