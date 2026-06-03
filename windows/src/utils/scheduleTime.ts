// src/utils/scheduleTime.ts
import type { ParentScheduleItem } from "../types/schedule";

/* HH:mm:ss -> seconds of day */
export function toSecs(hms?: string | null) {
  if (!hms) return 0;
  const [h = "0", m = "0", s = "0"] = String(hms).split(":");
  return (+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0);
}

/* YYYY-MM-DD lexicographic compare (works for ISO dates) */
function cmpDate(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Is this schedule active at the given server date + server seconds-of-day? */
export function isScheduleActiveAtDateTime(
  item: ParentScheduleItem,
  today: string,
  nowSec: number
): boolean {
  const sd = item.start_date ?? item.start_day;
  const ed = item.end_date ?? sd;
  if (!sd || !ed) return false;

  const startSec = toSecs(item.start_time);
  const endSec = toSecs(item.end_time);
  const crossesMidnight = endSec <= startSec;

  if (crossesMidnight && sd === ed) {
    if (today === sd) return nowSec >= startSec;
    if (today === addDays(sd, 1)) return nowSec < endSec;
    return false;
  }

  if (cmpDate(today, sd) < 0) return false;
  if (cmpDate(today, ed) > 0) return false;

  if (today === sd && nowSec < startSec) return false;
  if (today === ed && nowSec >= endSec) return false;

  return true;
}

/** resolve active + next using server date + time */
export function resolveActiveAndNext(
  items: ParentScheduleItem[],
  today: string,
  nowSec: number
): { active: ParentScheduleItem | undefined; next: ParentScheduleItem | null } {
  let active: ParentScheduleItem | undefined;
  let next: ParentScheduleItem | null = null;

  for (const it of items) {
    if (isScheduleActiveAtDateTime(it, today, nowSec)) {
      active = it;
      continue;
    }

    const sd = it.start_date ?? it.start_day;
    if (!sd) continue;

    const isFuture =
      cmpDate(sd, today) > 0 ||
      (sd === today && toSecs(it.start_time) > nowSec);

    if (!isFuture) continue;

    if (!next) {
      next = it;
      continue;
    }

    const nDate = next.start_date ?? next.start_day!;
    const better =
      cmpDate(sd, nDate) < 0 ||
      (sd === nDate && toSecs(it.start_time) < toSecs(next.start_time));

    if (better) next = it;
  }

  return { active, next };
}
