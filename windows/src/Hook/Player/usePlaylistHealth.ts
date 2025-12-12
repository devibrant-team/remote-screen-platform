// src/features/schedule/hooks/usePlaylistHealth.ts
import { useEffect, useRef } from "react";

type SourceKind = "child" | "default" | undefined;

export type PlaylistLoopHealthDetail = {
  ok: boolean;              // loop نظيف (ما فيه تقطيع)؟
  hadGlitch: boolean;       // صار فيه تقطيع داخل هالـloop؟
  loopIndex: number;        // رقم اللفة (1, 2, 3, ...)
  scheduleId?: string | number;
  source?: SourceKind;
};

type Options = {
  scheduleId?: string | number;
  source?: SourceKind;
};

/**
 * حارس للصحة (health) على مستوى الـ playlist:
 * - نجمع أي glitches داخل اللفة الحالية (waiting / stalled / error).
 * - نوفر registerVideoGuard ليركب listeners على الفيديو تلقائيًا.
 * - عند نهاية اللفة، نرمي event: "playlist:loop-health" مع detail فيه ok / hadGlitch.
 * - HomeScreen يستمع للـevent ويقرر إذا بيحفظ lastGoodChild أو لأ.
 */
export function usePlaylistHealth(opts: Options) {
  const hasGlitchInLoop = useRef(false);
  const loopIndexRef = useRef(0);

  // نخزن cleanups للفيديوهات
  const videoCleanupMap = useRef<Map<HTMLVideoElement, () => void>>(
    new Map()
  );

  // لما يتغيّر schedule أو نوع الـsource نعتبرها دورة جديدة بالكامل
  useEffect(() => {
    hasGlitchInLoop.current = false;
    loopIndexRef.current = 0;
  }, [opts.scheduleId, opts.source]);

  const reportGlitch = (slideId?: string | number, reason?: string) => {
    hasGlitchInLoop.current = true;

    if (process.env.NODE_ENV !== "production") {
      console.log("[PlaylistHealth] glitch detected", {
        slideId,
        reason,
        scheduleId: opts.scheduleId,
        source: opts.source,
      });
    }
  };

  /**
   * يربط waiting / stalled / error على فيديو معيّن
   * ويعلِم الحارس بأي glitch
   */
  const registerVideoGuard = (
    videoEl: HTMLVideoElement | null,
    slideId?: string | number
  ) => {
    if (!videoEl) return;

    // لو عنده listeners قديمة → نظّفها
    const prevCleanup = videoCleanupMap.current.get(videoEl);
    if (prevCleanup) {
      try {
        prevCleanup();
      } catch {}
    }

    const onWaiting = () => reportGlitch(slideId, "waiting");
    const onStalled = () => reportGlitch(slideId, "stalled");
    const onError = () => reportGlitch(slideId, "error");

    videoEl.addEventListener("waiting", onWaiting);
    videoEl.addEventListener("stalled", onStalled);
    videoEl.addEventListener("error", onError);

    const cleanup = () => {
      videoEl.removeEventListener("waiting", onWaiting);
      videoEl.removeEventListener("stalled", onStalled);
      videoEl.removeEventListener("error", onError);
    };

    videoCleanupMap.current.set(videoEl, cleanup);
  };

  const notifyLoopEnd = () => {
    loopIndexRef.current += 1;
    const hadGlitch = hasGlitchInLoop.current;
    const ok = !hadGlitch;

    const detail: PlaylistLoopHealthDetail = {
      ok,
      hadGlitch,
      loopIndex: loopIndexRef.current,
      scheduleId: opts.scheduleId,
      source: opts.source,
    };

    // event رئيسي يستعمله HomeScreen
    window.dispatchEvent(
      new CustomEvent<PlaylistLoopHealthDetail>("playlist:loop-health", {
        detail,
      } as any)
    );

    // لو حابب تحتفظ بالـevent القديم
    window.dispatchEvent(new CustomEvent("playlist:loop"));

    if (process.env.NODE_ENV !== "production") {
    //   console.log("[PlaylistHealth] loop end", detail);
    }

    // نرجّع العداد لهاللفة الجديدة
    hasGlitchInLoop.current = false;
  };

  // تنظيف كل الفيديوهات عند unmount
  useEffect(() => {
    return () => {
      videoCleanupMap.current.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      videoCleanupMap.current.clear();
    };
  }, []);

  return { reportGlitch, notifyLoopEnd, registerVideoGuard };
}
