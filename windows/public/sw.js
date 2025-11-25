/* global self, caches, fetch */
const VERSION = "devibrant-v1.0.0";
const STATIC_CACHE = `static-${VERSION}`;
const IMAGE_CACHE = `image-${VERSION}`;
const API_CACHE = `api-${VERSION}`;

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const VID_EXT = /\.(mp4|webm|m4v|mov|m4s|ts)(\?.*)?$/i;

const API_HINTS = [
  "/showsdefault",
  "/showscheduleplaylist",
  "/GetParentSchedule",
];

const PRECACHE_URLS = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(STATIC_CACHE);
      try {
        await c.addAll(PRECACHE_URLS);
      } catch (err) {
        // ignore
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (!k.includes(VERSION)) {
            return caches.delete(k);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

function isPlaylistApi(url) {
  const u = url.toLowerCase();
  return API_HINTS.some((hint) => u.includes(hint.toLowerCase()));
}

async function apiNetworkFirst(event) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(event.request);
    if (res && res.ok) {
      cache.put(event.request, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);

  const networkPromise = fetch(event.request)
    .then((res) => {
      try {
        if (res && res.ok) cache.put(event.request, res.clone());
      } catch (err) {}
      return res;
    })
    .catch(() => null);

  if (cached) return cached;
  if (networkPromise) return networkPromise;
  return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // فيديو → لا كاش، فقط forward
  if (VID_EXT.test(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  // صور من نفس الـ origin
  if (isSameOrigin && IMG_EXT.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, IMAGE_CACHE));
    return;
  }

  // static assets
  const isStatic =
    isSameOrigin &&
    (url.pathname.startsWith("/assets/") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".html"));
  if (isStatic) {
    event.respondWith(staleWhileRevalidate(event, STATIC_CACHE));
    return;
  }

  // API playlists/schedules
  if (isSameOrigin && isPlaylistApi(url.pathname)) {
    event.respondWith(apiNetworkFirst(event));
    return;
  }

  // غير ذلك → مرّر كما هو
  return;
});
