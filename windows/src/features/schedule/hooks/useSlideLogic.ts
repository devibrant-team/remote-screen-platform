// src/features/schedule/hooks/useSlideLogic.ts
import { useEffect, useMemo, useState } from "react";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

function toSecs(hms: string) {
  const [h = "0", m = "0", s = "0"] = String(hms).split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

type SlideLike = { duration: number };

export type SlideLogicState = {
  enabled: boolean;
  slideIndex: number;
  offsetInSlide: number;
  msUntilNextSlide: number | null;
};

export function useSlideLogic(
  slides: SlideLike[],
  childStartTime?: string | null
): SlideLogicState {
  const clock = useServerClockStrict();

  const totalDuration = useMemo(() => {
    return slides.reduce((sum, s) => sum + (s.duration || 0), 0);
  }, [slides]);

  const [baseStartSec, setBaseStartSec] = useState<number | null>(null);

  useEffect(() => {
    if (!slides.length || !totalDuration) {
      setBaseStartSec(null);
      return;
    }

    // 🧷 حالة child schedule: البداية من start_time القادم من السيرفر
    if (childStartTime) {
      const startSec = toSecs(childStartTime);
      setBaseStartSec(startSec);
      return;
    }

    // 🎬 default playlist:
    // ممنوع نستخدم وقت جهاز كـ "ثواني اليوم" قبل ما يجهز السيرفر
    if (!clock.isReady()) {
      setBaseStartSec(null); // نخلي المنطق disabled → الـ Player يستخدم التايمر المحلي
      return;
    }

    setBaseStartSec((prev) => {
      if (prev != null) return prev;
      const now = clock.nowSecs(); // ثواني اليوم من السيرفر
      return now;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childStartTime, slides.length, totalDuration, clock]);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!slides.length || !totalDuration || baseStartSec == null) return;

    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, 250);

    return () => window.clearInterval(id);
  }, [slides.length, totalDuration, baseStartSec]);

  const state = useMemo<SlideLogicState>(() => {
    if (!slides.length || !totalDuration || baseStartSec == null) {
      return {
        enabled: false,
        slideIndex: 0,
        offsetInSlide: 0,
        msUntilNextSlide: null,
      };
    }

    // ❗ هون بنستخدم فقط وقت السيرفر (clock.nowSecs) اللي انت حاميّه أصلاً
    const now = clock.nowSecs();
    let elapsed = now - baseStartSec;
    if (elapsed < 0) elapsed = 0;

    const loopElapsed = totalDuration > 0 ? elapsed % totalDuration : 0;

    let acc = 0;
    for (let i = 0; i < slides.length; i++) {
      const d = slides[i].duration || 0;
      const endOfThisSlide = acc + d;

      if (loopElapsed < endOfThisSlide) {
        const offsetInSlide = loopElapsed - acc;
        const remainingSec = Math.max(0, d - offsetInSlide);

        const msUntilNextSlide =
          Number.isFinite(remainingSec) && remainingSec > 0
            ? Math.floor(remainingSec * 1000)
            : 0;

        return {
          enabled: true,
          slideIndex: i,
          offsetInSlide,
          msUntilNextSlide,
        };
      }
      acc += d;
    }

    return {
      enabled: true,
      slideIndex: slides.length - 1,
      offsetInSlide: 0,
      msUntilNextSlide: null,
    };
  }, [slides, totalDuration, baseStartSec, clock, tick]);

  return state;
}
