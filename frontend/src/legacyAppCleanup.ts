const LEGACY_CLEANUP_KEY = 'forge-legacy-browser-cache-cleanup-v1';

/**
 * Retire service workers and Cache Storage entries left by older deployments.
 * Forge currently has no offline worker, so keeping legacy app-shell caches would
 * only make an installed Chrome shortcut launch an outdated build.
 */
export async function cleanupLegacyBrowserState(): Promise<void> {
    if (localStorage.getItem(LEGACY_CLEANUP_KEY)) return;

    try {
        const registrations = 'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistrations()
            : [];
        await Promise.all(registrations.map(registration => registration.unregister()));

        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
        }

        localStorage.setItem(LEGACY_CLEANUP_KEY, 'done');
    } catch (error) {
        // Retry on the next app launch if Chrome temporarily blocks the cleanup.
        console.warn('Could not clear legacy installed-app cache state.', error);
    }
}
