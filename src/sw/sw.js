/* Service worker template (NFR-STO-005). The build replaces __PRECACHE__ and __VERSION__ below
 * with the precache list and version; see the `offline` plugin in vite.config.ts. Plain JS
 * because it is copied, not bundled. */
const PRECACHE = __PRECACHE__;
const VERSION = __VERSION__;
const CACHE = `gssk-studio-${VERSION}`;
const scope = new URL(self.registration.scope);
const url = (path) => new URL(path, scope).href;
const SHELL = url('index.html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([url('./'), ...PRECACHE.map(url)]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('gssk-studio-') && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const target = new URL(req.url);
  if (req.method !== 'GET' || target.origin !== scope.origin) return;

  if (req.mode === 'navigate') {
    // Every screen is the same shell; the client router picks the screen.
    event.respondWith(fetch(req).catch(() => caches.match(SHELL, { cacheName: CACHE })));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit ?? fetch(req)));
});
