// src/utils/mediaPrefetcher.ts
// Prefetch helpers for images/videos + adaptive warm range for smoother playback.

type Cancel = () => void;

const imageCache = new Set<string>();
const videoCache = new Set<string>();

/** 
 * 🔵 ثوابت للتحكم بحجم الـ warm prefetch حسب جودة النت:
 *  - PREFETCH_WARM_GOOD → 8MB (جودة جيدة)
 *  - PREFETCH_WARM_POOR → 4MB (جودة ضعيفة / أبطأ)
 */
export const PREFETCH_WARM_GOOD = 8 * 1024 * 1024; // 8 MB
export const PREFETCH_WARM_POOR = 4 * 1024 * 1024; // 4 MB

/**
 * inflightFetches:
 *  - مفتاحها هو URL الميديا بعد normalize
 *  - قيمتها AbortController للـ fetch الجاري
 *
 *  منطق:
 *  - طلب واحد فقط جاري لكل URL.
 *  - أي prefetchVideo ثاني لنفس URL → لا يفتح طلب جديد ولا يوقف القديم.
 */
const inflightFetches = new Map<string, AbortController>();

/** توحيد URL الميديا: إزالة cb=.. إن وُجد لمنع اختلافات بين التسخين والتشغيل */
export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return url;
  const u = url
    .replace(/([?&])cb=\d+(&|$)/, (_m, p1, p2) => (p2 ? p1 : ""))
    .replace(/\?&$/, "?")
    .replace(/\?$/, "");
  return u;
}

/** Prefetch an image URL into the browser cache. */
export function prefetchImage(url?: string): Cancel {
  url = normalizeMediaUrl(url);
  if (!url) return () => {};
  if (imageCache.has(url)) return () => {};

  let cancelled = false;
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = url;
  img.onload = () => !cancelled && imageCache.add(url!);
  img.onerror = () => {};
  return () => {
    cancelled = true;
  };
}

/* ──────────────────────────────────────────────────────────────
   Adaptive warm range for VIDEOS
────────────────────────────────────────────────────────────── */
const MIN_RANGE = 256 * 1024;           // 256 KB
const MAX_RANGE = 12 * 1024 * 1024;     // 12 MB
let VIDEO_WARM_RANGE = 4 * 1024 * 1024; // 4 MB افتراضي

export function setVideoWarmRange(bytes: number) {
  VIDEO_WARM_RANGE = Math.max(MIN_RANGE, Math.min(bytes, MAX_RANGE));
}

/** Quick bandwidth probe (1 MB range GET) to adapt warm size dynamically. */
let lastMbps = 0;
export async function probeBandwidth(urlSample: string): Promise<number> {
  try {
    const t0 = performance.now();
    const size = 1 * 1024 * 1024 - 1; // 1 MB chunk
    const url = normalizeMediaUrl(urlSample)!;
    await fetch(url, {
      method: "GET",
      headers: { Range: `bytes=0-${size}` },
      cache: "no-store",
      credentials: "omit",
    });
    const ms = Math.max(1, performance.now() - t0);
    const mbps = (1 /*MB*/ * 8 * 1000) / ms; // megabits/s
    lastMbps = mbps;

    // Heuristic: دفّئ ~5 ثواني (سقف 12Mbps لتجنب المبالغة)
    const targetMb = (Math.min(mbps, 12) * 5) / 8; // MB
    const targetBytes = Math.round(targetMb * 1024 * 1024);
    setVideoWarmRange(targetBytes);

    // eslint-disable-next-line no-console
    console.log(
      `[prefetch] probe ≈ ${mbps.toFixed(
        2
      )} Mbps → warm ~${(targetBytes / 1024 / 1024).toFixed(1)} MB`
    );
    return mbps;
  } catch {
    return lastMbps || 0;
  }
}

/** Coarse adaptation when we don't have a probe yet. */
export function setAdaptiveVideoWarmRange(
  mode: "ONLINE_GOOD" | "ONLINE_SLOW" | "SERVER_DOWN" | "OFFLINE"
) {
  // ✅ لو النت جيد → 8MB، غير ذلك → 4MB ثابتة
  if (mode === "ONLINE_GOOD") {
    setVideoWarmRange(PREFETCH_WARM_GOOD);
  } else {
    setVideoWarmRange(PREFETCH_WARM_POOR);
  }
}

/**
 * Prefetch a small initial byte range of the video (seeds HTTP cache).
 *
 * منطق جديد:
 *  - لو الفيديو سبق وتسخّن (videoCache) → لا شيء.
 *  - لو هناك fetch جاري لنفس URL (inflightFetches) → لا شيء.
 *  - غير ذلك → نعمل Range GET واحد فقط.
 */
export function prefetchVideo(url?: string): Cancel {
  url = normalizeMediaUrl(url);
  if (!url) return () => {};
  if (videoCache.has(url)) return () => {};

  // لو في طلب جاري لنفس URL → لا تعمل طلب جديد
  const existing = inflightFetches.get(url);
  if (existing) {
    return () => {
      // لا نلغي الطلب الأصلي، نتركه يكمل
    };
  }

  const ac = new AbortController();
  inflightFetches.set(url, ac);

  fetch(url, {
    method: "GET",
    headers: { Range: `bytes=0-${VIDEO_WARM_RANGE - 1}` },
    signal: ac.signal,
    cache: "default",
    credentials: "omit",
  })
    .then((res) => {
      if (res && res.ok) {
        videoCache.add(url!);
      }
    })
    .catch(() => {
      // نتجاهل الأخطاء
    })
    .finally(() => {
      inflightFetches.delete(url!);
    });

  // هذا الـ cancel يخص هذا الـ fetch فقط
  return () => {
    try {
      if (!ac.signal.aborted) ac.abort();
    } catch {}
    inflightFetches.delete(url!);
  };
}

/** Prefetch all media in a slide (returns a combined cancel). */
export function prefetchSlideMedia(slide: {
  slots: Array<{ mediaType?: string; ImageFile?: string }>;
}): Cancel {
  const cancels: Cancel[] = [];
  for (const slot of slide.slots || []) {
    const url = normalizeMediaUrl(slot?.ImageFile);
    const type = String(slot?.mediaType || "").toLowerCase();
    if (!url) continue;
    cancels.push(type === "video" ? prefetchVideo(url) : prefetchImage(url));
  }
  return () => cancels.forEach((c) => c());
}

/** Prefetch a small window of slides ahead, safely. */
export function prefetchWindow(
  slides: Array<{ slots: any }>,
  startIndex: number,
  count: number
): Cancel {
  const cancels: Cancel[] = [];
  const len = slides?.length ?? 0;
  if (len <= 1) return () => {};

  const toPrefetch = Math.min(count, Math.max(0, len - 1));
  for (let i = 1; i <= toPrefetch; i++) {
    const idx = (startIndex + i) % len;
    const slide = slides[idx];
    if (slide) cancels.push(prefetchSlideMedia(slide as any));
  }
  return () => cancels.forEach((c) => c());
}

/** Prefetch playlist (all slides). */
export function prefetchWholePlaylist(playlist?: {
  slides?: Array<{ slots: any[] }>;
}): Cancel {
  const cancels: Cancel[] = [];
  for (const s of playlist?.slides || []) {
    cancels.push(prefetchSlideMedia(s as any));
  }
  return () => cancels.forEach((c) => c());
}

export function isImagePrefetched(url?: string) {
  const u = normalizeMediaUrl(url);
  return !!u && imageCache.has(u);
}
export function isVideoPrefetched(url?: string) {
  const u = normalizeMediaUrl(url);
  return !!u && videoCache.has(u);
}

/** Smart window size by net mode. */
export function prefetchWindowSmart(
  slides: Array<{ slots: any }>,
  startIndex: number,
  mode: "ONLINE_GOOD" | "ONLINE_SLOW" | "SERVER_DOWN" | "OFFLINE"
) {
  const count = mode === "ONLINE_SLOW" ? 3 : 2;
  return prefetchWindow(slides as any, startIndex, count);
}
