// src/features/schedule/hooks/useTimedSchedule.ts
import { useEffect, useMemo, useState } from "react";
import {
  useParentSchedules,
  pickScheduleId,
} from "../../ReactQuery/schedule/useParentSchedules";
import type { ParentScheduleItem } from "../../types/schedule";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import { resolveActiveAndNext } from "../../utils/scheduleTime";

export function useTimedSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const clock = useServerClockStrict();

  // day = server date (YYYY-MM-DD)
  const day = parent.data?.date;
  const items: ParentScheduleItem[] = useMemo(
    () => parent.data?.data ?? [],
    [parent.data?.data]
  );

  const [activeScheduleId, setActiveScheduleId] = useState<number | undefined>(
    undefined
  );
  const [active, setActive] = useState<ParentScheduleItem | undefined>(
    undefined
  );
  const [next, setNext] = useState<ParentScheduleItem | null>(null);

  // 🔹 إعادة حساب أولية: فقط لما تكون البيانات جاهزة والساعة جاهزة من السيرفر
  useEffect(() => {
    if (!day || items.length === 0) {
      setActiveScheduleId(undefined);
      setActive(undefined);
      setNext(null);
      return;
    }

    // ❗ لو السيرفر مش جاهز → ممنوع نعتمد على وقت الجهاز
    if (!clock.isReady()) {
      return;
    }

    const nowSec = clock.nowSecs();
    const { active: a, next: n } = resolveActiveAndNext(items, day, nowSec);

    setActive(a);
    setNext(n);
    setActiveScheduleId(pickScheduleId(a) ?? undefined);

    // eslint-disable-next-line no-console
    console.log("[SCHEDULE_DEBUG] useTimedSchedule(init)", {
      day,
      nowSec,
      items: items.map((it) => ({
        scheduleId: pickScheduleId(it),
        start_date: it.start_date ?? it.start_day,
        end_date: it.end_date ?? it.start_date ?? it.start_day,
        start: it.start_time,
        end: it.end_time,
      })),
      activeScheduleId: pickScheduleId(a),
      nextScheduleId: n ? pickScheduleId(n) : null,
    });
  }, [day, items, clock]);

  // 🔹 Interval كل ثانية: يمشي مع ساعة السيرفر ويحدّث الـ active على الثانية
  useEffect(() => {
    if (!day || items.length === 0) return;

    const id = window.setInterval(() => {
      if (!clock.isReady()) return;

      const nowSec = clock.nowSecs();
      const { active: a, next: n } = resolveActiveAndNext(items, day, nowSec);
      const newId = pickScheduleId(a) ?? undefined;

      // eslint-disable-next-line no-console
      console.log("[SCHEDULE_TICK]", {
        day,
        nowSec,
        activeScheduleId: pickScheduleId(a),
        nextScheduleId: n ? pickScheduleId(n) : null,
      });

      setActive((prev) => (prev === a ? prev : a));
      setNext((prev) => (prev === n ? prev : n));

      setActiveScheduleId((oldId) => {
        if (oldId !== newId) {
          // eslint-disable-next-line no-console
          console.log("[SCHEDULE_DEBUG] boundary hit", {
            day,
            nowSec,
            newActiveId: newId,
            oldActiveId: oldId,
          });
        }
        return newId;
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [day, items, clock]);

  return {
    parent,
    activeScheduleId,
    active,
    next,
  };
}
