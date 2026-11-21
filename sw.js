// Service worker: makes the app open instantly and work offline (gyms often have no signal).
// - App files: served from cache, refreshed in the background (a new version shows on next open).
// - Exercise photos from GitHub: cached the first time you view them.
// - GitHub API calls (your sync): never cached.
// Bump VERSION whenever you deploy changes.

const VERSION = 'v5';
const CACHE = 'ironbook-' + VERSION;
const IMG_CACHE = 'ironbook-img';
const APP_FILES = [
  './', './index.html', './manifest.json', './css/app.css', './css/fonts.css', './data/exercises.json',
  './js/app.js', './js/store.js', './js/sync.js', './js/calc.js', './js/exercises.js', './js/ui.js', './js/charts.js',
  './js/timer.js', './js/ics.js', './js/seed.js', './js/health.js', './js/views/log.js',
  './js/views/today.js', './js/views/plan.js', './js/views/library.js', './js/views/progress.js', './js/views/profile.js', './js/views/workout.js',
  './fonts/barlow-0.woff2', './fonts/barlow-1.woff2', './fonts/barlow-2.woff2', './fonts/barlow-3.woff2',
  './fonts/barlow-condensed-4.woff2', './fonts/barlow-condensed-5.woff2', './fonts/dm-sans-6.woff2', './fonts/inter-7.woff2',
  './fonts/sora-8.woff2', './fonts/unbounded-9.woff2', './fonts/plus-jakarta-sans.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.github.com') return; // sync: always network

  if (url.hostname === 'raw.githubusercontent.com') {
    e.respondWith(caches.open(IMG_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const key = url.pathname.endsWith('/') ? './' : e.request;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
