// Service worker for the installed desktop app. Pages and assets load from the network first,
// so you always get the latest version, and fall back to the last copy when offline.
// Lead data (/api/*) is never cached here: it always comes live.

const CACHE = 'jobalert-v1';
const SHELL = ['/', '/index.html', '/job.html', '/assets/styles.css', '/assets/core.js', '/assets/app.js', '/assets/job.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  // Cache each file on its own: one failed file (or a full disk) must not stop the app installing.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: url.pathname === '/job.html' })),
  );
});
