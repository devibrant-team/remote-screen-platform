// src/features/schedule/hooks/useTimedScheduleData.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist } from "../../ReactQuery/schedule/useChildPlaylist";
import { prefetchNextPlaylist } from "../../ReactQuery/schedule/prefetchNextPlaylist";
import { qk } from "../../ReactQuery/queryKeys";
import { fetchDefaultPlaylist } from "../../ReactQuery/schedule/useDefaultPlaylist";
import { useServerClockStrict } from "../../utils/useServerClockStrict";

export const LS_SCREEN_ID = "screenId";

// ⏱️ Prefetch thresholds
const PREFETCH_NEXT_CHILD_MS = 5 * 60_000; // 5 دقائق قبل بداية الـ child القادم
const PREFETCH_DEFAULT_BEFORE_END_MS = 5 * 60_000; // 5 دقائق قبل نهاية الـ window الحالية

// نفس فكرة msUntilSmart عشان ما نضيع prefetch لو في انحراف صغير
function msUntilSmart(
  clock: ReturnType<typeof useServerClockStrict>,
  hms?: string | null
): number | null {
  if (!hms) return null;
  const raw = clock.msUntil(hms);
  if (raw == null) return null;
  if (raw < 0 && raw > -300) return 0;
  return raw;
}

export function useTimedScheduleData() {
  const screenId =
    (typeof window !== "undefined" && localStorage.getItem(LS_SCREEN_ID)) ||
    undefined;

  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);
  const qc = useQueryClient();
  const clock = useServerClockStrict();

  // ⏭️ Prefetch child للـ next schedule بناءً على ساعة السيرفر (HH:mm:ss)
  useEffect(() => {
    if (!next) return;
    const scheduleId = next.scheduleId;
    const startTime = next.start_time;

    const rawMs = msUntilSmart(clock, startTime);
    if (rawMs == null) return;

    // نبلّش prefetch قبل 5 دقائق من بداية الـ child
    const delay = Math.max(0, rawMs - PREFETCH_NEXT_CHILD_MS);

    let timer: number | undefined;
    const arm = () => {
      prefetchNextPlaylist(qc, scheduleId, screenId).catch(() => {});
    };

    if (delay === 0) {
      arm();
    } else {
      timer = window.setTimeout(arm, delay);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [next, screenId, qc, clock]);

  // 🅾️ Prefetch للـ DEFAULT playlist قبل نهاية الـ window الحالية حسب ساعة السيرفر
  useEffect(() => {
    if (!active || !screenId) return;

    const endTime = active.end_time;
    const rawMs = msUntilSmart(clock, endTime);
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
  }, [active, screenId, qc, clock]);

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
