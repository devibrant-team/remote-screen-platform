// src/features/schedule/hooks/useSlideLogic.ts
import { useEffect, useMemo, useState } from "react";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

const DAY_SEC = 86400;

function clampDay(s: number) {
  return ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

function toSecs(hms: string) {
  const [h = "0", m = "0", s = "0"] = String(hms).split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

type SlideLike = { duration: number };

export type SlideLogicState = {
  /** مفعّل يعني منطق السيرفر شغّال (childStartTime + clock ready) */
  enabled: boolean;
  /** أي index منطقي للشريحة حالياً (0-based) */
  slideIndex: number;
  /** كم ثانية مرقت داخل الشريحة الحالية (من بداية الشريحة) */
  offsetInSlide: number;
};

/**
 * هوك يحسب:
 * - أي شريحة منطقياً المفروض تكون الآن (slideIndex)
 * - كم ثانية قطعت داخل الشريحة (offsetInSlide)
 *
 * مبني على:
 * - ساعة السيرفر (useServerClockStrict)
 * - start_time تبع schedule (childStartTime: "HH:mm:ss")
 * - مجموع مدة الشرائح (loop)
 */
export function useSlideLogic(
  slides: SlideLike[],
  childStartTime?: string | null
): SlideLogicState {
  const clock = useServerClockStrict();

  const totalDuration = useMemo(() => {
    return slides.reduce((sum, s) => sum + (s.duration || 0), 0);
  }, [slides]);

  // tick بسيط لتحديث الحالة كل 250ms لما يكون الـ hook مفعّل
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // لو ما في childStartTime أو ما في slides أو ما في durations → الهوموك off
    if (!childStartTime || !slides.length || !totalDuration) return;
    // لو السيرفر clock لسا مش جاهز → خليك على التايمر المحلي مؤقتاً
    if (!clock.isReady()) return;

    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, 250);

    return () => window.clearInterval(id);
  }, [childStartTime, slides.length, totalDuration, clock]);

  const state = useMemo<SlideLogicState>(() => {
    // شروط إلغاء المنطق المنطقي
    if (!childStartTime || !slides.length || !totalDuration) {
      return { enabled: false, slideIndex: 0, offsetInSlide: 0 };
    }

    // لو clock مش جاهز → لا نفعّل sync
    if (!clock.isReady()) {
      return { enabled: false, slideIndex: 0, offsetInSlide: 0 };
    }

    const now = clock.nowSecs(); // ثواني اليوم من ساعة السيرفر
    const startSec = toSecs(childStartTime);

    let elapsed = now - startSec;
    if (elapsed < 0) elapsed = 0;

    // الزمن اللي مرق داخل loop playlist (يلفّ بعد totalDuration)
    const loopElapsed = totalDuration > 0 ? elapsed % totalDuration : 0;

    let acc = 0;
    for (let i = 0; i < slides.length; i++) {
      const d = slides[i].duration || 0;
      if (loopElapsed < acc + d) {
        return {
          enabled: true,
          slideIndex: i,
          offsetInSlide: loopElapsed - acc,
        };
      }
      acc += d;
    }

    // fallback نظرياً ما نوصل له، بس safety:
    return {
      enabled: true,
      slideIndex: slides.length - 1,
      offsetInSlide: 0,
    };
    // tick داخل deps عشان نعيد الحساب كل 250ms
  }, [childStartTime, slides, totalDuration, clock, tick]);

  return state;
}
