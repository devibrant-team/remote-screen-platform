// src/features/schedule/hooks/useTimedScheduleData.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist } from "../../../ReactQuery/schedule/useChildPlaylist";
import { prefetchNextPlaylist } from "../../../ReactQuery/schedule/prefetchNextPlaylist";
import type { ParentScheduleItem } from "../../../types/schedule";
import { qk } from "../../../ReactQuery/queryKeys";
import { fetchDefaultPlaylist } from "../../../ReactQuery/schedule/useDefaultPlaylist";

export const LS_SCREEN_ID = "screenId";

// ⏱️ Prefetch thresholds (tweak here: 3 or 5 minutes)
const PREFETCH_NEXT_CHILD_MS = 5 * 60_000; // 5 min before next schedule starts
const PREFETCH_DEFAULT_BEFORE_END_MS = 5 * 60_000; // 5 min before current window ends

function timeToStartMs(
  item: ParentScheduleItem,
  dayDate: string,
  now = new Date()
) {
  const t = new Date(`${dayDate}T${item.start_time}`).getTime();
  return t - now.getTime();
}

function timeToEndMs(
  item: ParentScheduleItem,
  dayDate: string,
  now = new Date()
) {
  const t = new Date(`${dayDate}T${item.end_time}`).getTime();
  return t - now.getTime();
}

export function useTimedScheduleData() {
  const screenId =
    (typeof window !== "undefined" && localStorage.getItem(LS_SCREEN_ID)) ||
    undefined;

  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);
  const qc = useQueryClient();

  // Prefetch the NEXT schedule's child playlist ahead of time (5 minutes)
  useEffect(() => {
    if (!next || !parent.data?.date) return;

    const ms = timeToStartMs(next, parent.data.date, new Date());
    const delay = Math.max(0, ms - PREFETCH_NEXT_CHILD_MS);

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
  }, [next?.scheduleId, parent.data?.date, screenId, qc, next]);

  // Prefetch the DEFAULT playlist shortly before the current window ends (5 minutes).
  // This ensures when we hit a gap, default is ready and shows instantly.
  useEffect(() => {
    if (!active || !parent.data?.date || !screenId) return;

    const ms = timeToEndMs(active, parent.data.date, new Date());
    const delay = Math.max(0, ms - PREFETCH_DEFAULT_BEFORE_END_MS);

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
  }, [active?.scheduleId, parent.data?.date, screenId, qc, active]);

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
