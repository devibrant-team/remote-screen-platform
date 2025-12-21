// src/features/schedule/components/InteractivePlayer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { EffectFade } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import { useQueryClient } from "@tanstack/react-query";
import { echo, ReverbConnection, persistAuthTokenFromEvent } from "../../echo";
import InteractiveSlide from "../interactive/InteractiveSlide";
import { buttonsFor, type ButtonAction } from "../interactive/buttonRegistry";
import type { InteractivePlaylistDTO } from "../../types/interactive";

export default function InteractivePlayer({
  playlist,
  initialIndex = 0,
  screenId,
  scheduleId,
  onRequestRefetch,
}: {
  playlist: InteractivePlaylistDTO;
  initialIndex?: number;
  screenId?: string | number;
  scheduleId?: string | number;
  onRequestRefetch?: () => void;
}) {
  const qc = useQueryClient();

  const slides = useMemo(
    () =>
      [...(playlist?.slides ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      ),
    [playlist?.slides]
  );

  // ✅ safe initial index
  const safeInitial = useMemo(() => {
    if (!slides.length) return 0;
    const n = Number(initialIndex);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(0, n), slides.length - 1);
  }, [initialIndex, slides.length]);

  const [activeIndex, setActiveIndex] = useState(safeInitial);
  const activeIndexRef = useRef(safeInitial);
  const swiperRef = useRef<SwiperClass | null>(null);

  useEffect(() => {
    setActiveIndex(safeInitial);
    activeIndexRef.current = safeInitial;
    swiperRef.current?.slideTo?.(safeInitial, 0);
  }, [safeInitial]);

  const slideTo = (idx: number) => {
    if (!slides.length) return;
    const target = (idx + slides.length) % slides.length;
    activeIndexRef.current = target;
    setActiveIndex(target);
    swiperRef.current?.slideTo(target);
  };

  const next = () => slideTo(activeIndexRef.current + 1);
  const prev = () => slideTo(activeIndexRef.current - 1);

  // keep index safe when slides change
  useEffect(() => {
    if (!slides.length) return;
    if (activeIndex >= slides.length) {
      const safe = Math.max(0, slides.length - 1);
      activeIndexRef.current = safe;
      setActiveIndex(safe);
      swiperRef.current?.slideTo(safe, 0);
    } else {
      swiperRef.current?.update?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  // Prefetch current + next 2 images
  useEffect(() => {
    if (!slides.length) return;
    const len = slides.length;
    const need = Math.min(2, Math.max(0, len - 1));
    const loaders: HTMLImageElement[] = [];

    const load = (url?: string) => {
      if (!url) return;
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = url;
      loaders.push(img);
    };

    load(slides[activeIndex]?.media);
    for (let i = 1; i <= need; i++) {
      const idx = (activeIndex + i) % len;
      load(slides[idx]?.media);
    }
    return () => {
      loaders.length = 0;
    };
  }, [activeIndex, slides]);

  // Actions
  const runAction = (a: ButtonAction) => {
    if (a === "next") return next();
    if (a === "prev") return prev();

    if (typeof a === "string" && a.startsWith("index:")) {
      const n = Number(a.split(":")[1]);
      if (Number.isFinite(n)) slideTo(n);
      return;
    }
    if (typeof a === "string" && a.startsWith("goto:")) {
      const tok = a.split(":")[1];
      const n = Number(tok);
      if (Number.isFinite(n)) slideTo(n);
      return;
    }
    if (typeof a === "string" && a.startsWith("open:")) {
      const url = a.slice("open:".length);
      try {
        window.open(url, "_blank");
      } catch {}
      return;
    }
    if (a === "playVideo") return;
  };

  // ✅ Reverb: لا تربطها بـ activeIndex حتى ما تعمل re-subscribe كل مرة
  useEffect(() => {
    if (!screenId && !scheduleId) return;

    const attach = (channelName: string) => {
      const channel = echo.channel(channelName);

      const handleGoto = (e: any) => {
        const idx = Number(e?.index ?? e?.slide);
        if (Number.isFinite(idx)) slideTo(idx);
      };
      const handleNext = () => next();
      const handlePrev = () => prev();

      const handleReload = (e: any) => {
        persistAuthTokenFromEvent(e);
        if (onRequestRefetch) return onRequestRefetch();

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

      return () => {
        try {
          channel.stopListening(".SlideGoto", handleGoto);
          channel.stopListening(".SlideNext", handleNext);
          channel.stopListening(".SlidePrev", handlePrev);
          channel.stopListening(".PlaylistReload", handleReload);
          channel.stopListening(".ScheduleUpdate", handleReload);
          echo.leave(channelName);
        } catch {}
      };
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
  }, [screenId, scheduleId, onRequestRefetch, qc]);

  if (!slides.length) return null;

  // ✅ Fallback للـ style / ids حتى ما buttonsFor تفجّر
  const safeStyle = (playlist as any)?.style ?? "default";
  const safePlaylistId = (playlist as any)?.id ?? 0;

  return (
    <div className="w-screen h-[100dvh] bg-white text-white overflow-hidden">
      <Swiper
        modules={[EffectFade]}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        onSwiper={(sw) => {
          swiperRef.current = sw;
          sw.slideTo(safeInitial, 0);
        }}
        onSlideChange={(sw) => {
          activeIndexRef.current = sw.activeIndex;
          setActiveIndex(sw.activeIndex);
        }}
        allowTouchMove={false}
        keyboard={{ enabled: false }}
        speed={400}
        initialSlide={safeInitial}
        observer
        observeParents
        resizeObserver={true as any}
        className="w-full h-full"
      >
        {slides.map((s) => {
          let buttons: any[] = [];
          try {
            buttons = buttonsFor({
              style: safeStyle as any,
              index: Number(s.index ?? 0),
              playlistId: safePlaylistId,
              mediaId: s.media_id ?? 0,
            });
          } catch (err) {
            console.error("[InteractivePlayer] buttonsFor crash:", err, {
              style: safeStyle,
              index: s.index,
              playlistId: safePlaylistId,
              mediaId: s.media_id,
            });
            buttons = [];
          }

          return (
            <SwiperSlide key={s.id} className="!w-full !h-full">
              <InteractiveSlide
                slide={{
                  id: s.id,
                  index: s.index,
                  url: s.media,
                  mediaId: s.media_id,
                }}
                buttons={buttons}
                onAction={runAction}
              />
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
}
