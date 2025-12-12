// src/features/schedule/components/HeadlessWarmup.tsx
import { useEffect, useRef } from "react";
import { getNetQuality } from "../../utils/netQuality";
import {
  setVideoWarmRange,
  prefetchWholePlaylist,
  normalizeMediaUrl,
  PREFETCH_WARM_GOOD,
  PREFETCH_WARM_POOR,
} from "../../utils/mediaPrefetcher";

type Props = {
  playlist?: { slides?: Array<{ slots: any[] }> };
  onReady?: () => void; // نناديها لما نحس أن التسخين كفاية
  maxMs?: number; // سقف الوقت للتسخين (افتراضي 3 دقائق)
  aggressive?: boolean; // لو TRUE، زد مدى الفيديو وعدد الفيديوهات بالـ DOM
};

/**
 * HeadlessWarmup
 * - يشغل prefetchWholePlaylist (fetch-based warmup) → يحمّي كل child بالكامل.
 * - ينشئ عناصر <img>/<video> مخفية تحت كل شيء (z-index منخفض + opacity:0).
 * - يستند لجودة الشبكة لتحديد سلوك تسخين الفيديو (حجم الـ warm range).
 * - الهدف: لما يجي وقت الـ child يكون:
 *    - JSON playlist جاهز من React Query cache.
 *    - الميديا محمّية في HTTP cache / memory.
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

    // 🔥 اختار حجم التسخين بناءً على جودة الشبكة
    const quality = getNetQuality();

    if (aggressive || quality === "POOR") {
      // شبكة ضعيفة أو aggressive → 4MB (PREFETCH_WARM_POOR)
      setVideoWarmRange(PREFETCH_WARM_POOR);
    } else if (quality === "GOOD") {
      // شبكة جيدة → 8MB (PREFETCH_WARM_GOOD)
      setVideoWarmRange(PREFETCH_WARM_GOOD);
    } else {
      // وسط بينهما → 4MB كحل وسط
      setVideoWarmRange(PREFETCH_WARM_POOR);
    }

    // 🔁 fetch-based warmup لكل الـ playlist
    const cancelPrefetch = prefetchWholePlaylist(playlist);

    // DOM warmup (videos/images مخفية تحت)
    holder.innerHTML = "";

    const slides = playlist.slides || [];
    const created: Array<HTMLImageElement | HTMLVideoElement> = [];

    // نحدّد عدد الفيديوهات المسموح وضعها في الـ DOM للتسخين
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
          // نحطّه fullscreen لكن غير مرئي وتحت كل شيء
          v.style.position = "absolute";
          v.style.inset = "0";
          v.style.width = "100%";
          v.style.height = "100%";
          v.style.opacity = "0";
          v.style.pointerEvents = "none";
          v.style.zIndex = "-1";
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
      // لو ما في فيديو أصلاً، أو مرّ نص maxMs → اعتبر التسخين كفاية
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
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: -1, // 👈 تحت كل شيء
        opacity: 0, // غير مرئي
      }}
    />
  );
}
