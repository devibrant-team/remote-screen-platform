// src/utils/mediaPrefetcher.ts
type Cancel = () => void;

const imageCache = new Set<string>();
const videoCache = new Set<string>();
const inflightFetches = new Map<string, AbortController>();

/** Prefetch an image URL into the browser cache. */
export function prefetchImage(url?: string): Cancel {
  if (!url) return () => {};
  if (imageCache.has(url)) return () => {};

  let cancelled = false;
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  img.src = url;
  img.onload = () => !cancelled && imageCache.add(url);
  img.onerror = () => {};
  return () => {
    cancelled = true;
  };
}
const DEFAULT_WARM_RANGE = 256 * 1024; // 256KB (بدل 4KB)
let VIDEO_WARM_RANGE = DEFAULT_WARM_RANGE;

export function setVideoWarmRange(bytes: number) {
  VIDEO_WARM_RANGE = Math.max(16 * 1024, Math.min(bytes, 1024 * 1024)); // من 16KB إلى 1MB
}
export function prefetchVideo(url?: string): Cancel {
  if (!url) return () => {};
  if (videoCache.has(url)) return () => {};

  if (inflightFetches.has(url)) {
    const ac = inflightFetches.get(url)!;
    return () => ac.abort();
  }

  const ac = new AbortController();
  inflightFetches.set(url, ac);

  fetch(url, { method: "HEAD", signal: ac.signal })
    .then(() => videoCache.add(url))
    .catch(() => {
      return fetch(url, {
        method: "GET",
        headers: { Range: `bytes=0-${VIDEO_WARM_RANGE - 1}` },
        signal: ac.signal,
      })
        .then(() => videoCache.add(url))
        .catch(() => {});
    })
    .finally(() => inflightFetches.delete(url));

  return () => ac.abort();
}

// تسخين playlist كاملة (كل الشرائح/السلوتس)
export function prefetchWholePlaylist(playlist?: {
  slides?: Array<{ slots: any[] }>;
}): Cancel {
  const cancels: Cancel[] = [];
  const slides = playlist?.slides || [];
  for (const s of slides) {
    cancels.push(prefetchSlideMedia(s as any));
  }
  return () => cancels.forEach((c) => c());
}

/** Prefetch all media in a slide (returns a combined cancel). */
export function prefetchSlideMedia(slide: {
  slots: Array<{ mediaType?: string; ImageFile?: string }>;
}): Cancel {
  const cancels: Cancel[] = [];
  for (const slot of slide.slots || []) {
    const url = slot.ImageFile;
    const isVideo = (slot.mediaType || "").toLowerCase() === "video";
    cancels.push(isVideo ? prefetchVideo(url) : prefetchImage(url));
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
    if (slide) {
      cancels.push(prefetchSlideMedia(slide));
    }
  }
  return () => cancels.forEach((c) => c());
}

export function isImagePrefetched(url?: string) {
  return !!url && imageCache.has(url);
}
export function isVideoPrefetched(url?: string) {
  return !!url && videoCache.has(url);
}
// أضف في mediaPrefetcher.ts (أنت عندك VIDEO_WARM_RANGE و setVideoWarmRange)
export function setAdaptiveVideoWarmRange(mode: "ONLINE_GOOD" | "ONLINE_SLOW" | "SERVER_DOWN" | "OFFLINE") {
  if (mode === "ONLINE_GOOD") setVideoWarmRange(256 * 1024);
  else if (mode === "ONLINE_SLOW") setVideoWarmRange(512 * 1024);
  else setVideoWarmRange(128 * 1024); // حالات صعبة: خفّف طلبات الشبكة
}

export function prefetchWindowSmart(
  slides: Array<{ slots: any }>,
  startIndex: number,
  mode: "ONLINE_GOOD" | "ONLINE_SLOW" | "SERVER_DOWN" | "OFFLINE"
) {
  const count = mode === "ONLINE_SLOW" ? 3 : 2;
  return prefetchWindow(slides as any, startIndex, count);
}
