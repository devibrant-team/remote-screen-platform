/* global self, caches, fetch */
const VERSION = 'devibrant-v1.0.0';
const STATIC_CACHE = `static-${VERSION}`;
const IMAGE_CACHE = `image-${VERSION}`;
const API_CACHE   = `api-${VERSION}`;

// امتدادات
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const VID_EXT = /\.(mp4|webm|m4v|mov|m4s|ts)(\?.*)?$/i;

// نقاط نهاية API اللي منحبّ نعمل إلها cache (عدّل المسارات حسب باك إندك)
const API_HINTS = [
  '/showsdefault',            // GET /showsdefault/:screenId
  '/showscheduleplaylist',    // GET /showscheduleplaylist/:scheduleId
  '/GetParentSchedule',       // GET /GetParentSchedule/:screenId (مثال)
];

// ملفات ممكن تسبق-تحميلها (اختياري)
const PRECACHE_URLS = [
  '/',                        // شيلها إذا عندك Electron فقط
  // '/index.html',           // إذا Website
  // '/assets/index-xxx.js',
  // '/assets/index-xxx.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(STATIC_CACHE);
    try { await c.addAll(PRECACHE_URLS); } catch { /* ignore */ }
    // نفعّل فوراً
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        if (!k.includes(VERSION)) {
          return caches.delete(k);
        }
        return Promise.resolve();
      })
    );
    // سيطر على كل الصفحات المفتوحة
    await self.clients.claim();
  })());
});

/**
 * helper: هل الطلب API playlist/schedule؟
 */
function isPlaylistApi(url) {
  const u = url.toLowerCase();
  return API_HINTS.some((hint) => u.includes(hint.toLowerCase()));
}

/**
 * helper: network-first مع fallback للكاش (للـ API)
 */
async function apiNetworkFirst(event) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(event.request);
    // خزّن نسخة إذا نجح
    if (res && res.ok) {
      cache.put(event.request, res.clone());
    }
    return res;
  } catch (e) {
    // أوفلاين → رجّع آخر نسخة
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw e;
  }
}

/**
 * helper: stale-while-revalidate للصور والستايل والسكرِبت
 */
async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const networkPromise = fetch(event.request)
    .then((res) => {
      try {
        if (res && res.ok) cache.put(event.request, res.clone());
      } catch {}
      return res;
    })
    .catch(() => null);

  // رجّع الكاش فورًا إذا موجود، مع تحديث بالخلفية
  return cached || networkPromise || fetch(event.request);
}

/**
 * ملاحظة على الفيديو:
 * - ما منستخدم CacheStorage للفيديوهات، حتى ما نكسر دعم Range والـ HTTP cache الداخلي
 * - ببساطة منمرّر الطلب للشبكة كما هو
 */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // بس GET

  const url = new URL(req.url);

  // فيديو؟ مرّر كما هو (لا كاش بالـ SW)
  if (VID_EXT.test(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  // صور → stale-while-revalidate
  if (IMG_EXT.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, IMAGE_CACHE));
    return;
  }

  // ملفات ثابتة من نفس الأصل (css/js/html) → stale-while-revalidate
  const isSameOrigin = url.origin === self.location.origin;
  const isStatic = isSameOrigin && (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html')
  );
  if (isStatic) {
    event.respondWith(staleWhileRevalidate(event, STATIC_CACHE));
    return;
  }

  // API playlists/schedules → network-first + fallback
  if (isPlaylistApi(url.pathname)) {
    event.respondWith(apiNetworkFirst(event));
    return;
  }

  // غير ذلك → مرّر كما هو
  // (بما فيها صور/فيديو من دومينات خارجية ما بدنا نكاشيها)
  // إذا بدك تكاشي صور خارجية: أضف شرط دومين واضح
  return;
});
