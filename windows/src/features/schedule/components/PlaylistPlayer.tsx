import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChildPlaylistResponse,
  PlaylistSlide,
} from "../../../types/schedule";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectFade } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import {
  prefetchSlideMedia,
  prefetchWindow,
} from "../../../utils/mediaPrefetcher";
import {
  echo,
  ReverbConnection,
  persistAuthTokenFromEvent,
} from "../../../echo";
import { useQueryClient } from "@tanstack/react-query";
import GridLayout from "./GridLayout";

type PlaylistT = ChildPlaylistResponse["playlist"];

type Props = {
  playlist: PlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
};

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

  // لتتبّع الالتفاف من آخر شريحة إلى الأولى
  const prevIndexRef = useRef<number>(initialIndex);

  // فيديوهات + منظومة حُرّاس + منع تكرار degraded لنفس الشريحة
  const videoRefs = useRef<Record<number, HTMLVideoElement[]>>({});
  const videoGuardsCleanup = useRef<Map<HTMLVideoElement, () => void>>(new Map());
  const lastDegradedSlideRef = useRef<number | null>(null);

  const fireDegradedOnce = (slideId: number) => {
    if (lastDegradedSlideRef.current === slideId) return;
    lastDegradedSlideRef.current = slideId;
    window.dispatchEvent(new CustomEvent("playback:degraded"));
  };

  const slideTo = (idx: number) => {
    if (!slides.length) return;
    const target = (idx + slides.length) % slides.length;
    setActiveIndex(target);
    swiperRef.current?.slideTo(target);
  };
  const next = () => slideTo(activeIndex + 1);

  // دعم Skip-once: لو HomeScreen قرر نتجاوز شريحة سيئة
  useEffect(() => {
    const onSkip = () => {
      // نتجاوز الشريحة الحالية مرة واحدة
      next();
    };
    window.addEventListener("playlist:skip-once", onSkip);
    return () => window.removeEventListener("playlist:skip-once", onSkip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides.length]);

  // حافظ على الفهرس ضمن الحدود وتحديث الـSwiper
  useEffect(() => {
    if (!slides.length) return;
    if (activeIndex >= slides.length) {
      const safe = Math.max(0, slides.length - 1);
      if (safe !== activeIndex) {
        setActiveIndex(safe);
        swiperRef.current?.slideTo(safe, 0); // no animation
      }
    } else {
      swiperRef.current?.update?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Prefetch: الحالية + 2 قدّام (يمكن رفعها لـ3 لو بدك تربطها بـnetMode)
  useEffect(() => {
    if (!slides.length) return;
    const cancelCurrent = prefetchSlideMedia(slides[activeIndex] as any);
    const cancelWindow = prefetchWindow(slides as any, activeIndex, 2);
    return () => {
      cancelCurrent();
      cancelWindow();
    };
  }, [activeIndex, slides]);

  function attachVideoGuards(videoEl: HTMLVideoElement, slideId: number) {
    const prev = videoGuardsCleanup.current.get(videoEl);
    if (prev) prev();

    let ready = videoEl.readyState >= 2;

    const guardTimer = setTimeout(() => {
      if (!ready) fireDegradedOnce(slideId);
    }, 10000); // 10s لأول إطار

    const onCanPlay = () => { ready = true; };
    const onPlaying = () => { ready = true; };
    const onStalled = () => fireDegradedOnce(slideId);
    const onError = () => fireDegradedOnce(slideId);

    let lastTime = 0;
    let stagnantTimer: any = 0;
    const onTimeUpdate = () => {
      const t = videoEl.currentTime;
      if (t <= lastTime + 0.01) {
        if (!stagnantTimer) {
          stagnantTimer = setTimeout(() => fireDegradedOnce(slideId), 5000); // توقف التقدم 5s
        }
      } else {
        if (stagnantTimer) {
          clearTimeout(stagnantTimer);
          stagnantTimer = 0;
        }
        lastTime = t;
      }
    };

    videoEl.addEventListener("canplay", onCanPlay);
    videoEl.addEventListener("playing", onPlaying);
    videoEl.addEventListener("stalled", onStalled);
    videoEl.addEventListener("error", onError);
    videoEl.addEventListener("timeupdate", onTimeUpdate);

    const cleanup = () => {
      clearTimeout(guardTimer);
      if (stagnantTimer) clearTimeout(stagnantTimer);
      videoEl.removeEventListener("canplay", onCanPlay);
      videoEl.removeEventListener("playing", onPlaying);
      videoEl.removeEventListener("stalled", onStalled);
      videoEl.removeEventListener("error", onError);
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
    };

    videoGuardsCleanup.current.set(videoEl, cleanup);
    return cleanup;
  }

  // تشغيل الشريحة الفعّالة + تفعيل الحراس + كشف اكتمال الدورة
  useEffect(() => {
    const slide = slides[activeIndex] as PlaylistSlide | undefined;
    if (!slide) return;

    // كشف اكتمال الدورة: آخر → 0
    const prev = prevIndexRef.current;
    if (slides.length > 0 && prev === slides.length - 1 && activeIndex === 0) {
      window.dispatchEvent(new CustomEvent("playlist:loop"));
    }
    prevIndexRef.current = activeIndex;

    // reset منع التكرار للشريحة الحالية
    lastDegradedSlideRef.current = null;

    // أوقف بقية الفيديوهات
    Object.entries(videoRefs.current).forEach(([sid, list]) => {
      if (Number(sid) !== slide.id) list.forEach((v) => v.pause());
    });

    // شغّل فيديوهات الشريحة الحالية
    const vids = videoRefs.current[slide.id] || [];
    vids.forEach((v) => {
      try {
        v.preload = "auto";
        v.currentTime = 0;
        v.muted = true;
        v.playsInline = true;
        attachVideoGuards(v, slide.id);
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    });

    const hasDuration =
      Number.isFinite(slide.duration) && (slide.duration as number) > 0;
    if (!hasDuration) return;

    const t = window.setTimeout(next, (slide.duration as number) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides]);

  const registerVideo = (slideId: number, el: HTMLVideoElement | null) => {
    if (!el) return;
    const list = (videoRefs.current[slideId] = videoRefs.current[slideId] || []);
    if (!list.includes(el)) list.push(el);
  };

  useEffect(() => {
    return () => {
      videoGuardsCleanup.current.forEach((fn) => {
        try { fn(); } catch {}
      });
      videoGuardsCleanup.current.clear();
    };
  }, []);

  // Reverb: تحكم بالشريحة + إعادة تحميل
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
        const sid = e?.scheduleId ?? scheduleId;
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

    const unsubs: Array<(() => void) | undefined> = [];
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
    <div className="w-screen h-[100dvh] bg-black text-white overflow-hidden">
      <Swiper
        modules={[EffectFade]}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        onSwiper={(sw) => {
          swiperRef.current = sw;
          sw.slideTo(initialIndex);
        }}
        onSlideChange={(sw) => setActiveIndex(sw.activeIndex)}
        allowTouchMove={false}
        keyboard={{ enabled: false }}
        speed={400}
        initialSlide={initialIndex}
        observer
        observeParents
        resizeObserver={true as any}
        className="w-full h-full"
      >
        {slides.map((s: PlaylistSlide) => (
          <SwiperSlide key={s.id} className="!w-full !h-full">
            <div className="w-full h-full">
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
