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

const CACHE_VERSION = 'v5-offline-ml-fix';
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept Vite dev server requests or localhost dev files
  if (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return; // Pass through directly to Vite
  }

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
          // Cache same-origin basic assets OR TensorFlow.js cross-origin models
          const isTFJSModel = url.hostname === 'storage.googleapis.com' || url.hostname === 'unpkg.com';
          
          if (
            response.ok &&
            (
              (response.type === 'basic' && url.origin === self.location.origin) ||
              isTFJSModel
            )
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
          // If it's an ML model and we're offline (and it's not cached), fail hard to prevent TFJS from hanging
          const isTFJSModel = url.hostname === 'storage.googleapis.com' || url.hostname === 'unpkg.com';
          if (isTFJSModel) {
             throw new TypeError('Offline: ML model not cached.');
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
