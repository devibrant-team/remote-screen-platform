// src/features/schedule/components/PlaylistPlayer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChildPlaylistResponse, PlaylistSlide } from "../../../types/schedule";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectFade } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import {
  prefetchSlideMedia,
  prefetchWindowSmart,
} from "../../../utils/mediaPrefetcher";
import { echo, ReverbConnection, persistAuthTokenFromEvent } from "../../../echo";
import { useQueryClient } from "@tanstack/react-query";
import GridLayout from "./GridLayout";
import { currentNetMode, type NetMode } from "../../../utils/netHealth";

type PlaylistT = ChildPlaylistResponse["playlist"];

type Props = {
  playlist: PlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
};

/** ينتظر أول فريم لفيديو معيّن (أو canplay/playing) بمهلة محددة */
function waitForFirstFrame(vid: HTMLVideoElement, timeoutMs = 700) {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    };

    if (!vid) return finish();
    if (vid.readyState >= 2) return finish();

    const t = setTimeout(finish, timeoutMs);

    const onCanPlay = () => finish();
    const onPlaying = () => finish();

    // أدقّ طريقة إن متوفرة
    let cbId: number | null = null;
    const rVFC = (vid as any).requestVideoFrameCallback?.(() => finish());
    cbId = (typeof rVFC === "number" ? rVFC : null) as number | null;

    function cleanup() {
      clearTimeout(t);
      vid.removeEventListener("canplay", onCanPlay);
      vid.removeEventListener("playing", onPlaying);
      if (cbId && (vid as any).cancelVideoFrameCallback) {
        try {
          (vid as any).cancelVideoFrameCallback(cbId);
        } catch {}
      }
    }

    vid.addEventListener("canplay", onCanPlay, { once: true });
    vid.addEventListener("playing", onPlaying, { once: true });
  });
}

/** ينتظر أول فريم للفيديو الأساسي ضمن عنصر شريحة */
async function waitForPrimaryVideoReady(
  container: HTMLElement | null,
  timeoutMs = 700
) {
  if (!container) return;
  const vid = container.querySelector("video") as HTMLVideoElement | null;
  if (!vid) return; // الشريحة ما فيها فيديو
  try {
    // حاول التشغيل لضمان فك الـdecoder
    const p = vid.play();
    if (p?.catch) p.catch(() => {});
  } catch {}
  await waitForFirstFrame(vid, timeoutMs);
}

export default function PlaylistPlayer({
  playlist,
  initialIndex = 0,
  screenId,
  scheduleId,
  onRequestRefetch,
}: Props) {
  const qc = useQueryClient();

  const slides = useMemo(
    () =>
      [...(playlist?.slides ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      ),
    [playlist?.slides]
  );

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const swiperRef = useRef<SwiperClass | null>(null);

  const [netMode, setNetMode] = useState<NetMode>(currentNetMode());
  useEffect(() => {
    const id = window.setInterval(() => setNetMode(currentNetMode()), 4000);
    return () => window.clearInterval(id);
  }, []);

  const prevIndexRef = useRef<number>(initialIndex);

  const videoRefs = useRef<Record<number, HTMLVideoElement[]>>({});
  const videoGuardsCleanup = useRef<Map<HTMLVideoElement, () => void>>(new Map());

  const [showOverlay, setShowOverlay] = useState(false);

  // حُرّاس مبسّطين للفيديو (حالياً فقط لإبقاء channel للـ cleanup لو احتجناه)
  function attachVideoGuards(videoEl: HTMLVideoElement) {
    const prev = videoGuardsCleanup.current.get(videoEl);
    if (prev) prev();

    // هنا يمكن مستقبلاً نضيف logging أو مراقبة خفيفة من غير أي skip
    const cleanup = () => {
      // لا listeners حالياً
    };

    videoGuardsCleanup.current.set(videoEl, cleanup);
    return cleanup;
  }

  const slideTo = (idx: number) => {
    if (!slides.length) return;
    const target = (idx + slides.length) % slides.length;
    setActiveIndex(target);
    swiperRef.current?.slideTo(target);
  };
  const next = () => slideTo(activeIndex + 1);

  useEffect(() => {
    const onSkip = () => next();
    window.addEventListener("playlist:skip-once", onSkip);
    return () => window.removeEventListener("playlist:skip-once", onSkip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides.length]);

  useEffect(() => {
    if (!slides.length) return;
    if (activeIndex >= slides.length) {
      const safe = Math.max(0, slides.length - 1);
      if (safe !== activeIndex) {
        setActiveIndex(safe);
        swiperRef.current?.slideTo(safe, 0);
      }
    } else {
      swiperRef.current?.update?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Prefetch: current + window (adaptive by netMode)
  useEffect(() => {
    if (!slides.length) return;
    const cancelCurrent = prefetchSlideMedia(slides[activeIndex] as any);
    const cancelWindow = prefetchWindowSmart(slides as any, activeIndex, netMode);
    return () => {
      cancelCurrent();
      cancelWindow();
    };
  }, [activeIndex, slides, netMode]);

  // تشغيل الشريحة الفعّالة + تشغيل فيديوهاتها + كشف loop
  useEffect(() => {
    const slide = slides[activeIndex] as PlaylistSlide | undefined;
    if (!slide) return;

    const prev = prevIndexRef.current;
    if (slides.length > 0 && prev === slides.length - 1 && activeIndex === 0) {
      window.dispatchEvent(new CustomEvent("playlist:loop"));
    }
    prevIndexRef.current = activeIndex;

    // أوقف بقية الفيديوهات
    Object.entries(videoRefs.current).forEach(([sid, list]) => {
      if (Number(sid) !== slide.id) list.forEach((v) => v.pause());
    });

    // شغّل فيديوهات الشريحة الحالية
    const vids = videoRefs.current[slide.id] || [];
    vids.forEach((v) => {
      try {
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = "anonymous";
        v.style.willChange = "transform, opacity";
        attachVideoGuards(v);
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    });

    const hasDuration =
      Number.isFinite(slide.duration) && (slide.duration as number) > 0;
    if (!hasDuration) return;

    // 🔴 هون المنطق الجديد: الانتقال مبني فقط على مدة الشريحة
    const t = window.setTimeout(next, (slide.duration as number) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides]);

  // تسجيل الفيديوهات فور دخولها DOM
  const registerVideo = (slideId: number, el: HTMLVideoElement | null) => {
    if (!el) return;
    el.preload = "auto";
    el.playsInline = true;
    el.muted = true;
    el.crossOrigin = "anonymous";
    el.controls = false;
    el.disablePictureInPicture = true;
    el.setAttribute(
      "controlsList",
      "nodownload noplaybackrate noremoteplayback"
    );
    el.style.willChange = "transform, opacity";

    const list = (videoRefs.current[slideId] =
      videoRefs.current[slideId] || []);
    if (!list.includes(el)) list.push(el);
  };

  // تنظيف
  useEffect(() => {
    return () => {
      videoGuardsCleanup.current.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      videoGuardsCleanup.current.clear();
    };
  }, []);

  // Reverb
  useEffect(() => {
    if (!screenId && !scheduleId) return;

    const attach = (channelName: string) => {
      const channel = echo.channel(channelName);

      const handleGoto = (e: any) => {
        const idx = Number(e?.index ?? e?.slide);
        if (Number.isFinite(idx)) slideTo(idx);
      };
      const handleNext = () => next();
      const handlePrev = () => slideTo(activeIndex - 1);

      const handleReload = (e: any) => {
        persistAuthTokenFromEvent(e);
        if (onRequestRefetch) {
          onRequestRefetch();
          return;
        }
        if (screenId) {
          qc.invalidateQueries({
            queryKey: ["parentSchedules", String(screenId)],
            refetchType: "active",
          });
        }
        const sid = e?.scheduleId ?? e?.schedule_id ?? scheduleId;
        if (sid && screenId) {
          qc.invalidateQueries({
            queryKey: ["childPlaylist", String(sid), String(screenId)],
            refetchType: "active",
          });
        }
      };

      channel.listen(".SlideGoto", handleGoto);
      channel.listen(".SlideNext", handleNext);
      channel.listen(".SlidePrev", handlePrev);
      channel.listen(".PlaylistReload", handleReload);
      channel.listen(".ScheduleUpdate", handleReload);

      const cleanup = () => {
        try {
          channel.stopListening(".SlideGoto", handleGoto);
          channel.stopListening(".SlideNext", handleNext);
          channel.stopListening(".SlidePrev", handlePrev);
          channel.stopListening(".PlaylistReload", handleReload);
          channel.stopListening(".ScheduleUpdate", handleReload);
          echo.leave(channelName);
        } catch {}
      };
      return cleanup;
    };

    const unsubs: Array<() => void | undefined> = [];
    if (screenId) unsubs.push(attach(`screens.${screenId}`));
    if (scheduleId) unsubs.push(attach(`schedule.${scheduleId}`));

    const off = ReverbConnection.onStatus((s) => {
      if (s === "connected") {
        unsubs.forEach((u) => u && u());
        unsubs.length = 0;
        if (screenId) unsubs.push(attach(`screens.${screenId}`));
        if (scheduleId) unsubs.push(attach(`schedule.${scheduleId}`));
      }
    });

    return () => {
      off();
      unsubs.forEach((u) => u && u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, scheduleId, activeIndex, onRequestRefetch, qc]);

  if (!slides.length) return null;

  return (
    <div className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden">
      {/* Overlay لتغطية أي فجوة وجيزة أثناء الانتقال */}
      <div
        className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-150 ${
          showOverlay ? "opacity-30" : "opacity-0"
        }`}
      />

      <Swiper
        modules={[EffectFade]}
        effect="fade"
        fadeEffect={{ crossFade: true }} // ✅ تراكب حقيقي بدون فجوة سوداء
        speed={320}
        onSwiper={(sw) => {
          swiperRef.current = sw;
          sw.slideTo(initialIndex);
        }}
        onSlideChange={(sw) => setActiveIndex(sw.activeIndex)}
        onSlideChangeTransitionStart={async (sw) => {
          // جهّز الهدف قبل قطع الحاليين
          const target = sw.activeIndex;
          const slideEl = sw.slides?.[target] as HTMLElement | undefined;
          setShowOverlay(true);

          // شغّل فيديوهات الهدف فوراً (إن وجدت)
          const targetSlide = slides[target];
          const vidsTarget = videoRefs.current[targetSlide?.id || 0] || [];
          vidsTarget.forEach((v) => {
            try {
              v.preload = "auto";
              v.muted = true;
              v.playsInline = true;
              const p = v.play();
              if (p?.catch) p.catch(() => {});
            } catch {}
          });

          // انتظار أول فريم (أو 120ms إن ما في فيديو)
          if (vidsTarget.length) {
            await waitForPrimaryVideoReady(slideEl || null, 700);
          } else {
            await new Promise((r) => setTimeout(r, 120));
          }

          // الآن أوقف غير الهدف
          Object.entries(videoRefs.current).forEach(([sid, list]) => {
            if (Number(sid) !== targetSlide?.id)
              list.forEach((v) => {
                try {
                  v.pause();
                } catch {}
              });
          });

          // ارفع الـoverlay بعد شعرة
          setTimeout(() => setShowOverlay(false), 60);
        }}
        allowTouchMove={false}
        keyboard={{ enabled: false }}
        initialSlide={initialIndex}
        observer
        observeParents
        resizeObserver={true as any}
        className="w-full h-full"
      >
        {slides.map((s: PlaylistSlide) => (
          <SwiperSlide key={s.id} className="!w-full !h-full">
            <div className="w-full h-full bg-black">
              <GridLayout
                slide={s}
                onVideoRef={(el) => registerVideo(s.id, el)}
                gap={0}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
