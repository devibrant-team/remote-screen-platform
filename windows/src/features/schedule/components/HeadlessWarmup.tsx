// src/features/schedule/components/HeadlessWarmup.tsx
import { useEffect, useRef } from "react";
import { getNetQuality } from "../../../utils/netQuality";
import {
  setVideoWarmRange,
  prefetchWholePlaylist,
  normalizeMediaUrl,
} from "../../../utils/mediaPrefetcher";

type Props = {
  playlist?: { slides?: Array<{ slots: any[] }> };
  onReady?: () => void; // نناديها لما نحس أن التسخين كفاية
  maxMs?: number; // سقف الوقت للتسخين (افتراضي 3 دقائق)
  aggressive?: boolean; // لو TRUE، زد مدى الفيديو وعدد الفيديوهات بالـ DOM
};

/**
 * HeadlessWarmup
 * - يشغل prefetchWholePlaylist (fetch-based warmup).
 * - ينشئ عناصر <img>/<video> مخفية بعدد محدود.
 * - يستند لجودة الشبكة لتحديد سلوك تسخين الفيديو.
 */
export default function HeadlessWarmup({
  playlist,
  onReady,
  maxMs = 180000,
  aggressive = false,
}: Props) {
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = holderRef.current;

    if (!playlist || !playlist.slides?.length || !holder) {
      onReady?.();
      return;
    }

    const quality = getNetQuality();

    if (aggressive || quality === "POOR") {
      setVideoWarmRange(512 * 1024); // 512KB
    } else if (quality === "GOOD") {
      setVideoWarmRange(256 * 1024); // 256KB
    } else {
      setVideoWarmRange(128 * 1024); // 128KB
    }

    const cancelPrefetch = prefetchWholePlaylist(playlist);

    holder.innerHTML = "";

    const slides = playlist.slides || [];
    const created: Array<HTMLImageElement | HTMLVideoElement> = [];

    const MAX_DOM_VIDEOS = aggressive ? 6 : 3;
    let videoCount = 0;

    for (const slide of slides) {
      for (const slot of slide.slots || []) {
        const rawUrl = slot?.ImageFile as string | undefined;
        const url = normalizeMediaUrl(rawUrl);
        const type = String(slot?.mediaType || "").toLowerCase();
        if (!url) continue;

        if (type === "video") {
          if (videoCount >= MAX_DOM_VIDEOS) continue;
          videoCount++;

          const v = document.createElement("video");
          v.preload = "auto";
          v.muted = true;
          v.playsInline = true;
          v.src = url;
          v.style.position = "absolute";
          v.style.width = "1px";
          v.style.height = "1px";
          v.style.opacity = "0";
          holder.appendChild(v);
          created.push(v);
        } else {
          const img = new Image();
          img.decoding = "async";
          img.loading = "eager";
          img.src = url;
          created.push(img as any);
        }
      }
    }

    if (!created.length) {
      onReady?.();
      return () => {
        cancelPrefetch();
        holder.innerHTML = "";
      };
    }

    let readyFired = false;
    const t0 = Date.now();

    function fireReadyOnce() {
      if (readyFired) return;
      readyFired = true;
      onReady?.();
    }

    function maybeReady() {
      if (readyFired) return;
      const hasVideo = created.some((el) => el instanceof HTMLVideoElement);
      if (!hasVideo || Date.now() - t0 > maxMs / 2) {
        fireReadyOnce();
      }
    }

    const timer = window.setTimeout(() => {
      fireReadyOnce();
    }, maxMs);

    const probeTimer = window.setInterval(maybeReady, 3000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(probeTimer);
      cancelPrefetch();

      created.forEach((el) => {
        if (el instanceof HTMLVideoElement) {
          try {
            el.pause();
            el.src = "";
          } catch {
            // ignore
          }
        }
      });

      try {
        holder.innerHTML = "";
      } catch {
        // ignore
      }
    };
  }, [playlist, onReady, maxMs, aggressive]);

  return (
    <div
      ref={holderRef}
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    />
  );
}
