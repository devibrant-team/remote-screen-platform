// src/features/schedule/hooks/useTimedScheduleData.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist } from "../../../ReactQuery/schedule/useChildPlaylist";
import { prefetchNextPlaylist } from "../../../ReactQuery/schedule/prefetchNextPlaylist";
import { qk } from "../../../ReactQuery/queryKeys";
import { fetchDefaultPlaylist } from "../../../ReactQuery/schedule/useDefaultPlaylist";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

export const LS_SCREEN_ID = "screenId";

// ⏱️ Prefetch thresholds (تقدر تعدّل من هون)
const PREFETCH_NEXT_CHILD_MS = 5 * 60_000; // 5 دقائق قبل بداية الـ child القادم
const PREFETCH_DEFAULT_BEFORE_END_MS = 5 * 60_000; // 5 دقائق قبل نهاية الـ window الحالية

export function useTimedScheduleData() {
  const screenId =
    (typeof window !== "undefined" && localStorage.getItem(LS_SCREEN_ID)) ||
    undefined;

  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);
  const qc = useQueryClient();
  const clock = useServerClockStrict();

  // Prefetch child للـ next schedule بناءً على ساعة السيرفر (HH:mm:ss)
  useEffect(() => {
    if (!next) return;

    // ms لغاية بداية next.start_time
    const rawMs = clock.msUntil(next.start_time);
    if (rawMs == null) return;

    // بدنا نبلّش prefetch قبل prefetchMs من بداية الـ child
    const delay = Math.max(0, rawMs - PREFETCH_NEXT_CHILD_MS);

    let timer: number | undefined;
    const arm = () => {
      prefetchNextPlaylist(qc, next.scheduleId, screenId).catch(() => {});
    };

    if (delay === 0) {
      arm();
    } else {
      timer = window.setTimeout(arm, delay);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [next?.scheduleId, next?.start_time, screenId, qc, clock]);

  // Prefetch للـ DEFAULT playlist قبل نهاية window الحالية (active) حسب ساعة السيرفر
  useEffect(() => {
    if (!active || !screenId) return;

    const rawMs = clock.msUntil(active.end_time);
    if (rawMs == null) return;

    const delay = Math.max(0, rawMs - PREFETCH_DEFAULT_BEFORE_END_MS);

    let timer: number | undefined;
    const arm = () => {
      qc.prefetchQuery({
        queryKey: qk.def(screenId),
        queryFn: () => fetchDefaultPlaylist(screenId),
        staleTime: 5 * 60_000,
      }).catch(() => {});
    };

    if (delay === 0) {
      arm();
    } else {
      timer = window.setTimeout(arm, delay);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active?.scheduleId, active?.end_time, screenId, qc, clock]);

  return {
    screenId,
    parent,
    activeScheduleId,
    active,
    next,
    child,
    isLoading: parent.isLoading || child.isLoading,
    isError: parent.isError || child.isError,
  };
}
