// One-shot self-destroying service worker.
//
// The app no longer ships a PWA / registerSW (see vite.config.ts). This file
// exists only to clean up clients that still have a service worker registered
// from a previous deploy: the browser re-checks /sw.js, installs this, and on
// activate it unregisters itself, deletes all caches, and reloads each open
// tab ONCE into a clean, SW-free state. Because the served index.html has no
// registerSW, the reloaded page does NOT register a worker again — so there is
// no reload loop. Safe to keep served indefinitely.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          if ('navigate' in client) client.navigate(client.url);
        }
      } catch {
        // best-effort cleanup; nothing to do on failure
      }
    })()
  );
});
