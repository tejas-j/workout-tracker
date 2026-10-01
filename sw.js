// Stale-while-revalidate for same-origin files so the app opens offline.
const CACHE = 'training-log-v3';
const SHELL = ['./', 'index.html', 'exercises.js', 'firebase-sync.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (req.method !== 'GET' || (url.origin !== location.origin && !sdk)) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req);
    const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});
