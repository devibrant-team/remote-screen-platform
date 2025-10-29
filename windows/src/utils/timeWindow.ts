// windows/src/utils/timeWindow.ts
import type { ParentScheduleItem } from "../types/schedule";

function toLocalDateAt(dateStr: string, timeStr: string) {
  return new Date(`${dateStr}T${timeStr}`);
}

export function isNowWithinWindow(dateStr: string, startTime: string, endTime: string, now = new Date()) {
  const start = toLocalDateAt(dateStr, startTime);
  const end = toLocalDateAt(dateStr, endTime);
  return now >= start && now <= end;
}

export function pickActiveAndNext(dayDateStr: string, items: ParentScheduleItem[], now = new Date()) {
  const todays = items.filter((i) => i.start_day === dayDateStr);

  const active = todays.find((i) => isNowWithinWindow(i.start_day, i.start_time, i.end_time, now));

  const upcoming = todays
    .filter((i) => toLocalDateAt(i.start_day, i.start_time) > now)
    .sort((a, b) =>
      toLocalDateAt(a.start_day, a.start_time).getTime() -
      toLocalDateAt(b.start_day, b.start_time).getTime()
    )[0] || null;

  return { active, next: upcoming };
}

/** When does the state next change? (either current end, or next start) */
export function nextBoundaryMs(dayDateStr: string, items: ParentScheduleItem[], now = new Date()) {
  const boundaries: number[] = [];
  for (const i of items) {
    const start = toLocalDateAt(i.start_day, i.start_time).getTime();
    const end = toLocalDateAt(i.start_day, i.end_time).getTime();
    if (start > now.getTime()) boundaries.push(start);
    if (end > now.getTime()) boundaries.push(end);
  }
  boundaries.sort((a, b) => a - b);
  return boundaries[0] ?? null;
}
