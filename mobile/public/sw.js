// Service worker for the Rheo web app (PWA).
// - Only same-origin GET requests are handled; the API lives on another origin and is never cached.
// - Page navigations are network-first, falling back to the cached app shell when offline.
// - Hashed build assets under /_expo/static/ are immutable, so they are served cache-first.
// - Other same-origin files (icons, manifest, map worker) are network-first with a cache fallback.
// Bump CACHE_VERSION to drop every old cache on the next activation.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `rheo-${CACHE_VERSION}`;
const APP_SHELL = '/';
const PRECACHE = [APP_SHELL, '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL));
    return;
  }
  if (url.pathname.startsWith('/_expo/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});

// Tapping a notification brings the app to the front, or opens it when no window is left.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client);
      return open ? open.focus() : self.clients.openWindow(APP_SHELL);
    }),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(fallbackUrl ?? request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) ?? (fallbackUrl && (await caches.match(fallbackUrl)));
    if (cached) return cached;
    throw error;
  }
}
