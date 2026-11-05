/* PowerSeva service worker: keeps the app shell on the phone so it opens on a weak or missing network.
 * API calls (/api) and uploaded photos are never cached here - private data stays out of the shared cache. */
const VERSION = 'powerseva-v1';
const SHELL = [
  '/', '/index.html', '/login.html', '/register.html', '/forgot-password.html', '/offline.html',
  '/citizen/dashboard.html', '/citizen/report-fault.html', '/citizen/my-complaints.html', '/citizen/track-complaint.html', '/citizen/alerts.html',
  '/css/style.css', '/css/auth.css', '/css/dashboard.css', '/css/responsive.css',
  '/js/lang-te.js', '/js/i18n.js', '/js/api.js', '/js/validation.js', '/js/map.js', '/js/complaints.js', '/js/citizen.js', '/js/auth.js', '/js/pwa.js', '/js/password-toggle.js',
  '/assets/vendor/leaflet.js', '/assets/vendor/leaflet.css', '/assets/vendor/leaflet-heat.js',
  '/assets/images/favicon.svg', '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // Pages: try the network first so updates show up, fall back to the saved copy
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match('/offline.html')))
    );
    return;
  }

  // Scripts, styles, images: show the saved copy at once and refresh it in the background
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
