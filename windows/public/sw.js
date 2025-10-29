/* global self, caches, fetch */
const VERSION = 'slides-v1';
const MEDIA_CACHE = `media-${VERSION}`;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|webm|m4v|mov)(\?.*)?$/i;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (!k.startsWith('media-') || k === MEDIA_CACHE) return;
      return caches.delete(k);
    }));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!MEDIA_EXT.test(url.pathname)) return; // اسمح فقط بالميديا

  e.respondWith((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const cached = await cache.match(e.request);
    if (cached) return cached;
    try {
      const resp = await fetch(e.request, { credentials: 'omit' });
      if (resp && resp.ok) await cache.put(e.request, resp.clone());
      return resp;
    } catch {
      return cached || Response.error();
    }
  })());
});
