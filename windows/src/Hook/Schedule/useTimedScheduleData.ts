// src/features/schedule/hooks/useTimedScheduleData.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist } from "../../ReactQuery/schedule/useChildPlaylist";
import { prefetchNextPlaylist } from "../../ReactQuery/schedule/prefetchNextPlaylist";
import { qk } from "../../ReactQuery/queryKeys";
import { fetchDefaultPlaylist } from "../../ReactQuery/schedule/useDefaultPlaylist";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import { toSecs } from "../../utils/scheduleTime";

export const LS_SCREEN_ID = "screenId";

// ⏱️ Prefetch thresholds
const PREFETCH_NEXT_CHILD_MS = 5 * 60_000; // 5 دقائق قبل بداية الـ child القادم
const PREFETCH_DEFAULT_BEFORE_END_MS = 5 * 60_000; // 5 دقائق قبل نهاية الـ window الحالية

function daysBetween(a: string, b: string) {
  // ISO date → UTC midnight diff (stable + timezone-proof)
  const A = new Date(a + "T00:00:00Z").getTime();
  const B = new Date(b + "T00:00:00Z").getTime();
  return Math.round((B - A) / 86400000);
}

// Date+Time msUntil (مبني على ساعة السيرفر) + نفس smart window للـ drift
function msUntilDateTimeSmart(
  clock: ReturnType<typeof useServerClockStrict>,
  today: string | undefined,
  targetDate?: string | null,
  targetTime?: string | null
): number | null {
  if (!today || !targetDate || !targetTime) return null;
  if (!clock.isReady()) return null;

  const nowSec = clock.nowSecs();
  const targetSec = toSecs(targetTime);

  const dayDiff = daysBetween(today, targetDate);
  const rawMs = dayDiff * 86400000 + (targetSec - nowSec) * 1000;

  // لو الفرق سلبي بسيط (مثلاً -100ms) نعتبرها 0
  if (rawMs < 0 && rawMs > -300) return 0;

  return rawMs;
}

export function useTimedScheduleData() {
  const screenId =
    (typeof window !== "undefined" && localStorage.getItem(LS_SCREEN_ID)) ||
    undefined;

  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);
  const qc = useQueryClient();
  const clock = useServerClockStrict();

  const today = parent.data?.date;

  // ⏭️ Prefetch child للـ next schedule بناءً على (start_date + start_time)
  useEffect(() => {
    if (!next) return;
    if (!screenId) return;

    const startDate = next.start_date ?? next.start_day;
    const rawMs = msUntilDateTimeSmart(clock, today, startDate, next.start_time);
    if (rawMs == null) return;

    const delay = Math.max(0, rawMs - PREFETCH_NEXT_CHILD_MS);

    let timer: number | undefined;
    const arm = () => {
      prefetchNextPlaylist(qc, next.scheduleId, screenId).catch(() => {});
    };

    if (delay === 0) arm();
    else timer = window.setTimeout(arm, delay);

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [
    next?.scheduleId,
    next?.start_time,
    next?.start_date,
    next?.start_day,
    screenId,
    qc,
    clock,
    today,
  ]);

  // 🅾️ Prefetch للـ DEFAULT playlist قبل نهاية window حسب (end_date + end_time)
  useEffect(() => {
    if (!active || !screenId) return;

    const endDate = active.end_date ?? active.start_date ?? active.start_day;
    const rawMs = msUntilDateTimeSmart(clock, today, endDate, active.end_time);
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

    if (delay === 0) arm();
    else timer = window.setTimeout(arm, delay);

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [
    active?.scheduleId,
    active?.end_time,
    active?.end_date,
    active?.start_date,
    active?.start_day,
    screenId,
    qc,
    clock,
    today,
  ]);

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
