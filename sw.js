const CACHE = 'pro4rail-shell-v3';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'store.js', 'pins.js', 'config.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'apple-touch-icon.png', 'favicon-48.png',
  'assets/logo-light.png', 'assets/logo-dark.png',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2', 'fonts/barlow-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-500-normal.woff2', 'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
];

self.addEventListener('install', e => {
  // Einzelne fehlende Dateien dürfen die Installation nicht verhindern.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Nur eigene Dateien cachen. API-Aufrufe (Supabase, transport.rest, CDN) gehen immer direkt ins Netz.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first, damit Updates sofort ankommen; Cache nur als Offline-Fallback.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
