// src/features/schedule/components/HeadlessWarmup.tsx
import { useEffect, useRef } from "react";
import { getNetQuality } from "../../../utils/netQuality";
import { setVideoWarmRange, prefetchWholePlaylist } from "../../../utils/mediaPrefetcher";

type Props = {
  playlist?: { slides?: Array<{ slots: any[] }> };
  onReady?: () => void;        // نناديها لما نحس أن التسخين كفاية
  maxMs?: number;              // سقف الوقت للتسخين (افتراضي 3 دقائق)
  aggressive?: boolean;        // لو TRUE، زد مدى الفيديو
};

/**
 * HeadlessWarmup
 * - يُنشئ عناصر <img>/<video> مخفية لتسريع تعبئة الكاش.
 * - يستند لجودة الشبكة لتحديد السلوك.
 */
export default function HeadlessWarmup({ playlist, onReady, maxMs = 180000, aggressive = false }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = getNetQuality();
    // ضبط نطاق التسخين للفيديو وفقًا للجودة
    if (aggressive || q === "POOR") setVideoWarmRange(512 * 1024);   // 512KB
    else if (q === "GOOD") setVideoWarmRange(256 * 1024);            // 256KB
    else setVideoWarmRange(128 * 1024);                               // 128KB عند شبه انقطاع

    // 1) تسخين عبر fetch (كاش المتصفح)
    const cancelPrefetch = prefetchWholePlaylist(playlist);

    // 2) تسخين DOM فعلي (canplay/loadeddata للڤيديو)
    const holder = holderRef.current!;
    holder.innerHTML = "";

    const slides = playlist?.slides || [];
    const created: Array<HTMLImageElement | HTMLVideoElement> = [];

    for (const slide of slides) {
      for (const slot of slide.slots || []) {
        const url = slot?.ImageFile;
        const type = String(slot?.mediaType || "").toLowerCase();
        if (!url) continue;

        if (type === "video") {
          const v = document.createElement("video");
          v.preload = "auto";
          v.muted = true;
          v.playsInline = true;
          v.src = url;
          v.style.position = "absolute";
          v.style.width = "1px"; v.style.height = "1px"; v.style.opacity = "0";
          holder.appendChild(v);
          created.push(v);
        } else {
          const img = new Image();
          img.decoding = "async";
          img.loading = "eager";
          img.src = url;
          // لا نضيفه للـDOM لأن اللوود يكفي
          created.push(img as any);
        }
      }
    }

    let readyFired = false;
    const t0 = Date.now();

    function maybeReady() {
      if (readyFired) return;
      // معيار جاهزية مبسّط: لو مر نصف maxMs أو لا يوجد فيديو أصلاً
      const hasVideo = created.some((el) => el instanceof HTMLVideoElement);
      if (!hasVideo || Date.now() - t0 > maxMs / 2) {
        readyFired = true;
        onReady?.();
      }
    }

    const timer = setTimeout(() => {
      if (!readyFired) {
        readyFired = true;
        onReady?.();
      }
    }, maxMs);

    const probeTimer = setInterval(maybeReady, 3000);

    return () => {
      clearTimeout(timer);
      clearInterval(probeTimer);
      cancelPrefetch();
      created.forEach((el) => {
        // إيقاف الفيديوهات
        if (el instanceof HTMLVideoElement) {
          try { el.pause(); el.src = ""; } catch {}
        }
      });
      holder.innerHTML = "";
    };
  }, [playlist, onReady, maxMs, aggressive]);

  return <div ref={holderRef} style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />;
}
