// src/features/schedule/hooks/useTimedSchedule.ts
import { useEffect, useState } from "react";
import {
  useParentSchedules,
  pickScheduleId,
} from "../../../ReactQuery/schedule/useParentSchedules";
import type { ParentScheduleItem } from "../../../types/schedule";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";
import { resolveActiveAndNext } from "../../../utils/scheduleTime";

export function useTimedSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const clock = useServerClockStrict();

  const day = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  const [activeScheduleId, setActiveScheduleId] = useState<number | undefined>(
    undefined
  );
  const [active, setActive] = useState<ParentScheduleItem | undefined>(
    undefined
  );
  const [next, setNext] = useState<ParentScheduleItem | null>(null);

  // 🔹 إعادة حساب مباشرة أول ما تجي البيانات أو تتغيّر
  useEffect(() => {
    if (!day || items.length === 0) {
      setActiveScheduleId(undefined);
      setActive(undefined);
      setNext(null);
      return;
    }

    const nowSec = clock.nowSecs();
    const { active: a, next: n } = resolveActiveAndNext(items, nowSec);

    setActive(a);
    setNext(n);
    setActiveScheduleId(pickScheduleId(a) ?? undefined);

    // Debug اختياري
    // eslint-disable-next-line no-console
    console.log("[SCHEDULE_DEBUG] useTimedSchedule(init)", {
      day,
      nowSec,
      items: items.map((it) => ({
        scheduleId: pickScheduleId(it),
        start: it.start_time,
        end: it.end_time,
      })),
      activeScheduleId: pickScheduleId(a),
      nextScheduleId: n ? pickScheduleId(n) : null,
    });
  }, [day, items, clock]);

  // 🔹 Interval كل ثانية: يمشي مع ساعة السيرفر ويحدّث الـ active على الثانية تقريباً
  useEffect(() => {
    if (!day || items.length === 0) return;

    const id = setInterval(() => {
      const nowSec = clock.nowSecs();
      const { active: a, next: n } = resolveActiveAndNext(items, nowSec);
      const newId = pickScheduleId(a) ?? undefined;

      // 🔍 Tick Debug: نشوف كل ثانية أي schedule المفروض يكون active
      console.log("[SCHEDULE_TICK]", {
        day,
        nowSec,
        items: items.map((it) => ({
          scheduleId: pickScheduleId(it),
          start: it.start_time,
          end: it.end_time,
        })),
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
    }, 1_000); // تقدر تنزلها 500ms لو بدك دقة أعلى

    return () => clearInterval(id);
  }, [day, items, clock]);

  return {
    parent,
    activeScheduleId,
    active,
    next,
  };
}
