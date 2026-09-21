/**
 * E-Setu Service Worker — App Shell Cache
 *
 * Strategy: Cache-first for app shell assets, network-first for API calls.
 *
 * App shell (HTML, JS, CSS, fonts, icons) is cached on install so the app
 * loads instantly and works offline. API requests always hit the network
 * first; offline API handling is done by IndexedDB sync queue in the app.
 *
 * Cache versioning: bump CACHE_VERSION when deploying new app shell assets
 * so the old cache is cleaned up automatically.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `esetu-shell-${CACHE_VERSION}`;

// Assets to pre-cache on install (app shell)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/logo.png',
  '/logo.jpeg',
  '/favicon.svg',
  '/icons.svg',
];

// ── Install ────────────────────────────────────────────────────────────────
// Pre-cache the app shell. skipWaiting() makes the new SW active immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll throws if any request fails; use individual adds for resilience
      return Promise.allSettled(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Non-critical asset — log and continue
            console.warn('[SW] Failed to pre-cache:', url);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────────────────────
// Delete old caches from previous versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('esetu-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests — POST/PUT/DELETE go through normally
  if (request.method !== 'GET') return;

  // API calls → Network-first, no caching (handled by IndexedDB in app)
  if (url.pathname.startsWith('/v1/')) {
    event.respondWith(
      fetch(request).catch(() => {
        // Return a structured offline response so the app can detect offline
        return new Response(
          JSON.stringify({ offline: true, message: 'You are offline' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // App shell assets → Cache-first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      // Not in cache → fetch from network and cache the response
      return fetch(request)
        .then((response) => {
          // Only cache valid responses for same-origin assets
          if (
            response.ok &&
            response.type === 'basic' &&
            url.origin === self.location.origin
          ) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => {
          // For navigation requests, fall back to index.html (SPA)
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
          // For other assets, just fail
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// ── Background Sync (future) ───────────────────────────────────────────────
// The app uses a manual sync queue (IndexedDB + window 'online' event).
// Background Sync API can be added here in a future phase for background
// processing when the tab is closed.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-lots') {
    // Reserved for future background sync implementation
    console.log('[SW] Background sync triggered:', event.tag);
  }
});
