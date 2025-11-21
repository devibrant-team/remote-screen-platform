// src/features/schedule/hooks/useTimedSchedule.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { useParentSchedules } from "../../../ReactQuery/schedule/useParentSchedules";
import type { ParentScheduleItem } from "../../../types/schedule";
import { pickScheduleId } from "../../../ReactQuery/schedule/useParentSchedules";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

/* Helpers: HH:mm:ss → ثواني اليوم (بس لمقارنة الـ active/next) */
function toSecs(hms?: string | null) {
  const [h = "0", m = "0", s = "0"] = String(hms ?? "").split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

/** تحديد الـ active و next بناءً على ثواني اليوم حسب السيرفر */
function resolveActiveAndNext(
  items: ParentScheduleItem[],
  nowSec: number
): { active: ParentScheduleItem | undefined; next: ParentScheduleItem | null } {
  if (!items.length) return { active: undefined, next: null };

  const sorted = [...items].sort(
    (a, b) => toSecs(a.start_time) - toSecs(b.start_time)
  );

  let active: ParentScheduleItem | undefined;
  let next: ParentScheduleItem | null = null;

  for (const it of sorted) {
    const start = toSecs(it.start_time);
    const end = toSecs(it.end_time);
    const isInactive = (it as any).status === "inactive";

    if (!isInactive && nowSec >= start && nowSec < end) {
      active = it;
      continue;
    }

    if (!isInactive && start > nowSec && next == null) {
      next = it;
    }
  }

  return { active, next };
}

/** حساب ms حتى أول boundary (start أو end) باستخدام ساعة السيرفر */
function nextBoundaryDelayMsServer(
  items: ParentScheduleItem[],
  clock: ReturnType<typeof useServerClockStrict>
): number | null {
  if (!items.length) return null;

  const candidates: number[] = [];

  for (const it of items) {
    const isInactive = (it as any).status === "inactive";
    if (isInactive) continue;

    // كم باقي بالميلي ثانية لبداية الـ schedule
    const startMs = clock.msUntil(it.start_time);
    if (startMs != null && startMs > 0) candidates.push(startMs);

    // وكم باقي لنهايته
    const endMs = clock.msUntil(it.end_time);
    if (endMs != null && endMs > 0) candidates.push(endMs);
  }

  if (!candidates.length) return null;
  return Math.min(...candidates); // أقرب boundary
}

export function useTimedSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const clock = useServerClockStrict();

  const day = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  const [activeScheduleId, setActiveScheduleId] = useState<number | undefined>(
    undefined
  );

  // snapshot الوقت الحالي من السيرفر عند آخر render (ثواني اليوم)
  const nowSec = clock.nowSecs();

  // active & next من لقطة الوقت الحالية
  const computed = useMemo(() => {
    if (!day) {
      return {
        active: undefined as ParentScheduleItem | undefined,
        next: null as ParentScheduleItem | null,
      };
    }
    return resolveActiveAndNext(items, nowSec);
  }, [day, items, nowSec]);

  // keep activeScheduleId in sync
  useEffect(() => {
    setActiveScheduleId(pickScheduleId(computed.active) ?? undefined);
  }, [computed.active]);

  // timer دقيق عند أقرب boundary (start أو end) حسب ساعة السيرفر (ثانية / ميلي ثانية)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!day || items.length === 0) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const delay = nextBoundaryDelayMsServer(items, clock);
    if (delay == null) return;

    // cushion صغير 50ms لتجنب مشكلة jitter
    const fireDelay = Math.max(0, delay + 50);

    timerRef.current = setTimeout(() => {
      const nowAfter = clock.nowSecs();
      const { active } = resolveActiveAndNext(items, nowAfter);
      setActiveScheduleId(pickScheduleId(active) ?? undefined);

      // refetch parent schedule من السيرفر للتأكد
      parent.refetch();
    }, fireDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [day, items, parent, clock]);

  // Safety guard: check كل 10 ثواني بناءً على ساعة السيرفر
  useEffect(() => {
    const id = setInterval(() => {
      if (!day) return;
      const now = clock.nowSecs();
      const { active } = resolveActiveAndNext(items, now);
      const newId = pickScheduleId(active) ?? undefined;
      if (newId !== activeScheduleId) {
        setActiveScheduleId(newId);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [day, items, activeScheduleId, clock]);

  return {
    parent,
    activeScheduleId,
    active: computed.active,
    next: computed.next,
  };
}
