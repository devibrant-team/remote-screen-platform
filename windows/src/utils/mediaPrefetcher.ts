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

/** Prefetch video HEAD/bytes lightly to warm cache. */
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
        headers: { Range: "bytes=0-4095" },
        signal: ac.signal,
      })
        .then(() => videoCache.add(url))
        .catch(() => {});
    })
    .finally(() => inflightFetches.delete(url));

  return () => ac.abort();
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
