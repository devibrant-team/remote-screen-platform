// src/features/schedule/hooks/useTimedSchedule.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { useParentSchedules } from "../../../ReactQuery/schedule/useParentSchedules";
import type { ParentScheduleItem } from "../../../types/schedule";
import { pickScheduleId } from "../../../ReactQuery/schedule/useParentSchedules";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

/* Helpers: تحويل HH:mm:ss → ثواني اليوم */
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

  // نشتغل على نسخة مرتبة حسب وقت البداية
  const sorted = [...items].sort(
    (a, b) => toSecs(a.start_time) - toSecs(b.start_time)
  );

  let active: ParentScheduleItem | undefined;
  let next: ParentScheduleItem | null = null;

  for (const it of sorted) {
    const start = toSecs(it.start_time);
    const end = toSecs(it.end_time);

    // نتجاهل الـ inactive قدر الإمكان
    const isInactive = (it as any).status === "inactive";

    // active: الآن بين البداية والنهاية
    if (!isInactive && nowSec >= start && nowSec < end) {
      active = it;
      continue; // نكمل ممكن نلاقي next أبكر بعده
    }

    // next: أول بداية مستقبلية بعد الآن
    if (!isInactive && start > nowSec && next == null) {
      next = it;
    }
  }

  return { active, next };
}

/** حساب ms حتى أول boundary (نهاية active أو بداية next) */
function nextBoundaryDelayMs(
  items: ParentScheduleItem[],
  nowSec: number
): number | null {
  if (!items.length) return null;

  const startEndCandidates: number[] = [];

  for (const it of items) {
    const isInactive = (it as any).status === "inactive";
    if (isInactive) continue;

    const start = toSecs(it.start_time);
    const end = toSecs(it.end_time);

    if (start > nowSec) startEndCandidates.push(start);
    if (end > nowSec) startEndCandidates.push(end);
  }

  if (!startEndCandidates.length) return null;

  const nextSec = Math.min(...startEndCandidates);
  const deltaSec = Math.max(0, nextSec - nowSec);
  return deltaSec * 1000;
}

export function useTimedSchedule(screenId?: string) {
  const parent = useParentSchedules(screenId);
  const clock = useServerClockStrict();

  const day = parent.data?.date;
  const items: ParentScheduleItem[] = parent.data?.data ?? [];

  const [activeScheduleId, setActiveScheduleId] = useState<number | undefined>(
    undefined
  );

  // snapshot الوقت الحالي من السيرفر عند آخر render
  const nowSec = clock.nowSecs();

  // Compute active & next من اللقطة الحالية لساعة السيرفر
  const computed = useMemo(() => {
    if (!day) {
      return {
        active: undefined as ParentScheduleItem | undefined,
        next: null as ParentScheduleItem | null,
      };
    }
    return resolveActiveAndNext(items, nowSec);
  }, [day, items, nowSec]);

  // Keep activeScheduleId in sync
  useEffect(() => {
    setActiveScheduleId(pickScheduleId(computed.active) ?? undefined);
  }, [computed.active]);

  // Arm a precise timer to switch at the next boundary (start or end) حسب ساعة السيرفر
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!day || items.length === 0) return;

    // Clear previous timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const now = clock.nowSecs();
    const delay = nextBoundaryDelayMs(items, now);
    if (delay == null) return; // no more changes today

    // نضيف 100ms كـ cushion صغير
    const fireDelay = delay + 100;

    timerRef.current = setTimeout(() => {
      const nowAfter = clock.nowSecs();
      const { active } = resolveActiveAndNext(items, nowAfter);
      setActiveScheduleId(pickScheduleId(active) ?? undefined);

      // ونعمل refetch للـ parent لنتأكد من أي تغييرات جديدة من السيرفر
      parent.refetch();
    }, fireDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [day, items, parent, clock]);

  // Safety guard: interval خفيف يعتمد برضو على ساعة السيرفر
  useEffect(() => {
    const id = setInterval(() => {
      if (!day) return;
      const now = clock.nowSecs();
      const { active } = resolveActiveAndNext(items, now);
      const newId = pickScheduleId(active) ?? undefined;
      if (newId !== activeScheduleId) {
        setActiveScheduleId(newId);
      }
    }, 30_000); // كل 30 ثانية
    return () => clearInterval(id);
  }, [day, items, activeScheduleId, clock]);

  return {
    parent, // raw parent list (all today's schedules)
    activeScheduleId, // يتغيّر عند boundaries حسب ساعة السيرفر
    active: computed.active,
    next: computed.next,
  };
}
