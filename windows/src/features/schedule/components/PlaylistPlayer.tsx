// src/features/schedule/components/PlaylistPlayer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChildPlaylistResponse,
  PlaylistSlide,
  ParentScheduleItem,
} from "../../../types/schedule";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectFade } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import {
  prefetchSlideMedia,
  prefetchWindowSmart,
} from "../../../utils/mediaPrefetcher";
import {
  echo,
  ReverbConnection,
  persistAuthTokenFromEvent,
} from "../../../echo";
import { useQueryClient } from "@tanstack/react-query";
import GridLayout from "./GridLayout";
import { currentNetMode, type NetMode } from "../../../utils/netHealth";
import PlaylistDebugPanel from "./PlaylistDebugPanel";
import { useSlideLogic } from "../hooks/useSlideLogic";
import { useSchedulePlaylistTimeline } from "../hooks/useSchedulePlaylistTimeline";
import { usePlaylistHealth } from "../hooks/usePlaylistHealth";

type PlaylistT = ChildPlaylistResponse["playlist"];

type Props = {
  playlist: PlaylistT;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
  /** بداية child schedule من السيرفر "HH:mm:ss" (لو موجودة نفعّل sync المنطقي) */
  childStartTime?: string | null;
  activeSchedule?: ParentScheduleItem;
};

/** ينتظر أول فريم لفيديو معيّن (أو canplay/playing) بمهلة محددة — للـoverlay فقط */
function waitForFirstFrame(vid: HTMLVideoElement, timeoutMs = 700) {
  return new Promise<void>((resolve) => {
    let done = false;

    let timeoutId: number | null = null;
    let cbId: number | null = null;

    function cleanup() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (vid) {
        vid.removeEventListener("canplay", onCanPlay);
        vid.removeEventListener("playing", onPlaying);
        vid.removeEventListener("waiting", onWaiting);
      }
      if (cbId != null && (vid as any).cancelVideoFrameCallback) {
        try {
          (vid as any).cancelVideoFrameCallback(cbId);
        } catch {}
      }
    }

    const finish = () => {
      if (!done) {
        done = true;
        cleanup();
        resolve();
      }
    };

    const onCanPlay = () => finish();
    const onPlaying = () => finish();
    const onWaiting = () => {
      // هون بس للـoverlay، الـhealth الحقيقي جوّا usePlaylistHealth
    };

    if (!vid) {
      finish();
      return;
    }

    if (vid.readyState >= 2) {
      finish();
      return;
    }

    timeoutId = window.setTimeout(finish, timeoutMs);

    const rVFC = (vid as any).requestVideoFrameCallback?.(() => finish());
    cbId = (typeof rVFC === "number" ? rVFC : null) as number | null;

    vid.addEventListener("canplay", onCanPlay, { once: true });
    vid.addEventListener("playing", onPlaying, { once: true });
    vid.addEventListener("waiting", onWaiting, { once: true });
  });
}

/** ينتظر أول فريم للفيديو الأساسي ضمن عنصر شريحة — يؤثر فقط على الـoverlay */
async function waitForPrimaryVideoReady(
  container: HTMLElement | null,
  timeoutMs = 700
) {
  if (!container) return;
  const vid = container.querySelector("video") as HTMLVideoElement | null;
  if (!vid) return;
  try {
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
  childStartTime,
  activeSchedule,
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

  // ✅ حل مشكلة id: نستخدم scheduleId أو schedule.scheduleId فقط
  const resolvedScheduleId: string | number | undefined =
    scheduleId ?? activeSchedule?.scheduleId;

  // نوع الـplaylist: child أو default (مفيد للحارس)
  const sourceKind = (childStartTime ? "child" : "default") as
    | "child"
    | "default";

  // 🔁 منطق السيرفر/الـtimeline: أي slide لازم تكون الآن؟ وكم مرق عليها؟ وكم باقي؟
  const slideLogic = useSlideLogic(slides as any, childStartTime);

  // 🔁 Timeline كامل للـ schedule + playlist (loopات)
  const scheduleTimeline = useSchedulePlaylistTimeline({
    scheduleId: resolvedScheduleId,
    schedule: activeSchedule,
    slides: slides as PlaylistSlide[],
    childStartTime: childStartTime ?? null,
  });

  // 🛡️ حارس الصحة للـ playlist (glitches / loops + video guards)
  const health = usePlaylistHealth({
    scheduleId: resolvedScheduleId,
    source: sourceKind,
  });

  const [netMode, setNetMode] = useState<NetMode>(currentNetMode());
  useEffect(() => {
    const id = window.setInterval(() => setNetMode(currentNetMode()), 4000);
    return () => window.clearInterval(id);
  }, []);

  const prevIndexRef = useRef<number>(initialIndex);

  const videoRefs = useRef<Record<number, HTMLVideoElement[]>>({});

  const [showOverlay, setShowOverlay] = useState(false);

  // ⏱️ تايمر محلي فقط للـ debug (ما بيحرّك next أبداً)
  const [localSlideElapsed, setLocalSlideElapsed] = useState(0);

  const lastSeekPerSlide = useRef<Record<string | number, number>>({});

  useEffect(() => {
    const start = performance.now();
    setLocalSlideElapsed(0);

    const id = window.setInterval(() => {
      const now = performance.now();
      setLocalSlideElapsed((now - start) / 1000);
    }, 100);

    return () => window.clearInterval(id);
  }, [activeIndex]);

  // ⏱️ التوقيت الفعّال للشريحة
  const slideElapsed = slideLogic.enabled
    ? slideLogic.offsetInSlide
    : localSlideElapsed;

  const slideTo = (idx: number) => {
    if (!slides.length) return;
    const target = (idx + slides.length) % slides.length;
    setActiveIndex(target);
    swiperRef.current?.slideTo(target);
  };
  const next = () => slideTo(activeIndex + 1);

  // 🔄 sync مع منطق السيرفر/الـtimeline: أي slide لازم تكون الآن (index sync)
  useEffect(() => {
    if (!slideLogic.enabled) return;
    if (!slides.length) return;

    const idx = slideLogic.slideIndex;
    if (!Number.isFinite(idx)) return;
    if (idx === activeIndex) return;

    // حرك الـ Swiper بدون transition delay
    swiperRef.current?.slideTo(idx, 0);
    setActiveIndex(idx);
  }, [slideLogic.enabled, slideLogic.slideIndex, slides.length, activeIndex]);

  // 🎯 Sync الفيديو مع offsetInSlide لما ندخل على الشريحة في نصها
  useEffect(() => {
    if (!slideLogic.enabled) return;
    if (!slides.length) return;

    const slide = slides[activeIndex] as PlaylistSlide | undefined;
    if (!slide) return;

    const duration = slide.duration || 0;
    const offset = slideLogic.offsetInSlide;

    // لو ما في مدة أو offset سالب
    if (!duration || offset < 0) return;

    const slideKey = slide.id ?? activeIndex;

    // بداية loop جديدة تقريباً → خليه يبدأ من 0 وامسح آخر seek
    if (offset < 0.25) {
      delete lastSeekPerSlide.current[slideKey];
      return;
    }

    // لو نحن تقريباً في آخر الشريحة، ما في داعي نعمل seek
    if (offset > duration - 0.25) return;

    // امنع spam: لا تعيد الـ seek إذا الفرق صغير جداً
    const clamped = Math.min(
      Math.max(offset, 0),
      Math.max(0, duration - 0.25)
    );
    const last = lastSeekPerSlide.current[slideKey];
    if (last != null && Math.abs(last - clamped) < 0.4) {
      return;
    }

    const vids = videoRefs.current[slide.id] || [];

    vids.forEach((v) => {
      const applySeek = () => {
        try {
          let target = clamped;
          // لو الفيديو أقصر من duration اللي عندنا، نزبطها
          if (v.duration && isFinite(v.duration)) {
            target = Math.min(clamped, Math.max(0, v.duration - 0.25));
          }
          v.currentTime = target;
        } catch {
          // ignore
        }
      };

      if (v.readyState >= 1) {
        // metadata جاهزة → فينا نعمل seek فوراً
        applySeek();
      } else {
        // استنى metadata
        const onMeta = () => {
          v.removeEventListener("loadedmetadata", onMeta);
          applySeek();
        };
        v.addEventListener("loadedmetadata", onMeta);
      }
    });

    lastSeekPerSlide.current[slideKey] = clamped;
  }, [slideLogic.enabled, slideLogic.offsetInSlide, activeIndex, slides]);

  // external "skip once" event
  useEffect(() => {
    const onSkip = () => next();
    window.addEventListener("playlist:skip-once", onSkip);
    return () => window.removeEventListener("playlist:skip-once", onSkip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, slides.length]);

  // حافظ على activeIndex ضمن حدود length لو تغيّر عدد الشرائح فجأة
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
    const cancelWindow = prefetchWindowSmart(
      slides as any,
      activeIndex,
      netMode
    );
    return () => {
      cancelCurrent();
      cancelWindow();
    };
  }, [activeIndex, slides, netMode]);

  // 🔁 تشغيل الشريحة الفعّالة (فيديوهات + loop event) بدون أي تايمر next
  useEffect(() => {
    const slide = slides[activeIndex] as PlaylistSlide | undefined;
    if (!slide) return;

    const prev = prevIndexRef.current;
    if (slides.length > 0 && prev === slides.length - 1 && activeIndex === 0) {
      // ✅ نهاية loop كاملة → خلي الحارس يقرّر إذا كانت نظيفة أو لا
      health.notifyLoopEnd();
    }
    prevIndexRef.current = activeIndex;

    // أوقف بقية الفيديوهات
    Object.entries(videoRefs.current).forEach(([sid, list]) => {
      if (Number(sid) !== slide.id) list.forEach((v) => v.pause());
    });

    // شغّل فيديوهات الشريحة الحالية (للعرض فقط)
    const vids = videoRefs.current[slide.id] || [];
    vids.forEach((v) => {
      try {
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = "anonymous";
        v.style.willChange = "transform, opacity";
        // ربط الفيديو مع حارس الـhealth
        health.registerVideoGuard(v, slide.id);
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch {}
    });

    // 🔔 مافي setTimeout هنا أبداً – الانتقال للـ slide اللي بعدها
  }, [activeIndex, slides, health]);

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

    // نسجل الفيديو مع الحارس مباشرة
    health.registerVideoGuard(el, slideId);
  };

  // Reverb للتحكم عن بعد
  useEffect(() => {
    if (!screenId && !resolvedScheduleId) return;

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
        const sid = e?.scheduleId ?? e?.schedule_id ?? resolvedScheduleId;
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
    if (resolvedScheduleId) unsubs.push(attach(`schedule.${resolvedScheduleId}`));

    const off = ReverbConnection.onStatus((s) => {
      if (s === "connected") {
        unsubs.forEach((u) => u && u());
        unsubs.length = 0;
        if (screenId) unsubs.push(attach(`screens.${screenId}`));
        if (resolvedScheduleId)
          unsubs.push(attach(`schedule.${resolvedScheduleId}`));
      }
    });

    return () => {
      off();
      unsubs.forEach((u) => u && u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, resolvedScheduleId, activeIndex, onRequestRefetch, qc]);

  if (!slides.length) return null;

  return (
    <div className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden">
      {/* Debug Panel: يعرض وقت السيرفر + مدة الشريحة + كل تفاصيل التوقيت */}
      <PlaylistDebugPanel
        slides={slides as PlaylistSlide[]}
        activeIndex={activeIndex}
        scheduleId={resolvedScheduleId}
        slideElapsed={slideElapsed}
        localElapsed={localSlideElapsed}
        logicIndex={slideLogic.slideIndex}
        logicOffset={slideLogic.offsetInSlide}
        logicEnabled={slideLogic.enabled}
        logicMsUntilNext={slideLogic.msUntilNextSlide}
        childStartTime={childStartTime ?? null}
        scheduleTimeline={scheduleTimeline}
      />

      {/* Overlay لتغطية أي فجوة وجيزة أثناء الانتقال */}
      <div
        className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-150 ${
          showOverlay ? "opacity-30" : "opacity-0"
        }`}
      />

      <Swiper
        modules={[EffectFade]}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        speed={320}
        onSwiper={(sw) => {
          swiperRef.current = sw;
          sw.slideTo(initialIndex);
        }}
        onSlideChange={(sw) => setActiveIndex(sw.activeIndex)}
        onSlideChangeTransitionStart={async (sw) => {
          // هذا الجزء فقط للـoverlay وسلاسة الانتقال — لا يلمس التايمر
          const target = sw.activeIndex;
          const slideEl = sw.slides?.[target] as HTMLElement | undefined;
          setShowOverlay(true);

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

          if (vidsTarget.length) {
            await waitForPrimaryVideoReady(slideEl || null, 700);
          } else {
            await new Promise((r) => setTimeout(r, 120));
          }

          Object.entries(videoRefs.current).forEach(([sid, list]) => {
            if (Number(sid) !== targetSlide?.id)
              list.forEach((v) => {
                try {
                  v.pause();
                } catch {}
              });
          });

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
