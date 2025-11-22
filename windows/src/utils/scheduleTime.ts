// src/utils/scheduleTime.ts
import type { ParentScheduleItem } from "../types/schedule";

/* HH:mm:ss → seconds of day (0–86399) */
export function toSecs(hms?: string | null) {
  const [h = "0", m = "0", s = "0"] = String(hms ?? "").split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

function secsToHHMMSS(s: number) {
  const v = Math.floor(s);
  const hh = Math.floor(v / 3600);
  const mm = Math.floor((v % 3600) / 60);
  const ss = Math.floor(v % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(
    2,
    "0"
  )}:${String(ss).padStart(2, "0")}`;
}

/** Does this schedule cover nowSec, including cross-midnight windows? */
export function isScheduleActiveAt(
  item: ParentScheduleItem,
  nowSec: number
): boolean {
  const start = toSecs(item.start_time);
  const end = toSecs(item.end_time);

  const crossesMidnight = end < start;

  if (crossesMidnight) {
    // Example: 20:00 → 02:00
    // Active if now >= 20:00 OR now < 02:00
    return nowSec >= start || nowSec < end;
  }

  // Normal same-day window
  return nowSec >= start && nowSec < end;
}

/** Compute active + next based on server seconds-of-day (IGNORING status) */
export function resolveActiveAndNext(
  items: ParentScheduleItem[],
  nowSec: number
): { active: ParentScheduleItem | undefined; next: ParentScheduleItem | null } {
  if (!items.length) return { active: undefined, next: null };

  const sorted = [...items].sort(
    (a, b) => toSecs(a.start_time) - toSecs(b.start_time)
  );

  // 🔍 DEBUG مهم: شوف كل schedule كيف ينقرأ (بدون status)
  try {
    // console.log("[SCHEDULE_SCAN]", {
    //   nowSec,
    //   nowHHMMSS: secsToHHMMSS(nowSec),
    //   items: sorted.map((it) => {
    //     const start = toSecs(it.start_time);
    //     const end = toSecs(it.end_time);
    //     const activeNow = isScheduleActiveAt(it, nowSec);
    //     return {
    //       scheduleId: (it as any).scheduleId ?? (it as any).id,
    //       startRaw: it.start_time,
    //       endRaw: it.end_time,
    //       startSec: start,
    //       endSec: end,
    //       startHHMMSS: secsToHHMMSS(start),
    //       endHHMMSS: secsToHHMMSS(end),
    //       activeNow,
    //     };
    //   }),
    // });
  } catch {
    // ignore
  }

  let active: ParentScheduleItem | undefined;
  let next: ParentScheduleItem | null = null;

  for (const it of sorted) {
    const start = toSecs(it.start_time);

    // 1️⃣ Active الآن؟
    if (isScheduleActiveAt(it, nowSec)) {
      active = it;
      continue;
    }

    // 2️⃣ أول window يبدأ بعد الآن = next
    if (start > nowSec && next == null) {
      next = it;
    }
  }

  return { active, next };
}
