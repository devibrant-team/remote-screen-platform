// windows/src/features/schedule/hooks/useTimedSchedule.ts

import { useEffect, useMemo, useRef, useState } from "react";
import { useParentSchedules } from "../../../ReactQuery/schedule/useParentSchedules";
import type { ParentScheduleItem } from "../../../types/schedule";
import { pickActiveAndNext, nextBoundaryMs } from "../../../utils/timeWindow";

export function useTimedSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);

  const day = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  const [activeScheduleId, setActiveScheduleId] = useState<number | undefined>(
    undefined
  );

  // Compute current active & next upcoming from fetched data
  const computed = useMemo(() => {
    if (!day)
      return {
        active: undefined as ParentScheduleItem | undefined,
        next: null as ParentScheduleItem | null,
      };
    return pickActiveAndNext(day, items);
  }, [day, items]);

  // Keep activeScheduleId in sync with computed state
  useEffect(() => {
    setActiveScheduleId(computed.active?.scheduleId);
  }, [computed.active?.scheduleId]);

  // Arm a precise timer to switch at the next boundary (start or end)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!day || items.length === 0) return;

    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const nxt = nextBoundaryMs(day, items, new Date());
    if (!nxt) return; // no more changes today

    // Fire a little after the boundary (100ms cushion)
    const delay = Math.max(0, nxt - Date.now() + 100);

    timerRef.current = setTimeout(() => {
      // Recompute from current cache (quick)…
      const { active } = pickActiveAndNext(day, items, new Date());
      setActiveScheduleId(active?.scheduleId);

      // …and also ask React Query to refresh the parent list around the boundary
      // to pick up any last-second server changes:
      parent.refetch();
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [day, items, parent]);

  // Safety guard: very light interval to catch clock drift or missed timers
  useEffect(() => {
    const id = setInterval(() => {
      if (!day) return;
      const { active } = pickActiveAndNext(day, items, new Date());
      if (active?.scheduleId !== activeScheduleId) {
        setActiveScheduleId(active?.scheduleId);
      }
    }, 30_000); // every 30s
    return () => clearInterval(id);
  }, [day, items, activeScheduleId]);

  return {
    parent, // raw parent list (all today's schedules)
    activeScheduleId, // changes exactly at start/end boundaries
    active: computed.active,
    next: computed.next,
  };
}
