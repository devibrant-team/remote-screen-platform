// src/features/schedule/hooks/useTimedScheduleData.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist } from "../../../ReactQuery/schedule/useChildPlaylist";
import { prefetchNextPlaylist } from "../../../ReactQuery/schedule/prefetchNextPlaylist";
import type { ParentScheduleItem } from "../../../types/schedule";

export const LS_SCREEN_ID = "screenId";

function timeToStartMs(item: ParentScheduleItem, dayDate: string, now = new Date()) {
  const t = new Date(`${dayDate}T${item.start_time}`).getTime();
  return t - now.getTime();
}

export function useTimedScheduleData() {
  const screenId =
    (typeof window !== "undefined" && localStorage.getItem(LS_SCREEN_ID)) || undefined;

  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);
  const child = useChildPlaylist(activeScheduleId, screenId);
  const qc = useQueryClient();

  // Prefetch logic: when we’re close to the next window, warm its playlist
  useEffect(() => {
    if (!next || !parent.data?.date) return;

    const ms = timeToStartMs(next, parent.data.date, new Date());
    // Prefetch threshold (2 minutes before start; never negative)
    const THRESHOLD = 2 * 60_000;
    const delay = Math.max(0, ms - THRESHOLD);

    let timer: number | undefined;
    const arm = () => {
      prefetchNextPlaylist(qc, next.scheduleId, screenId).catch(() => {});
    };

    // If already within threshold → prefetch now, else schedule it.
    if (delay === 0) {
      arm();
    } else {
      timer = window.setTimeout(arm, delay);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [next?.scheduleId, parent.data?.date, screenId, qc, next]);
  
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
