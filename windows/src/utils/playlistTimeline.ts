// src/utils/playlistTimeline.ts
import { toSecs } from "./scheduleTime";

const DAY_SEC = 86400;

function clampDay(s: number) {
  return ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

// HH:MM:SS.mmm مع دعم absolute秒
export function secsToHHMMSSmmm(s: number) {
  const totalInt = Math.floor(s);
  const daySec = clampDay(totalInt);

  const hh = Math.floor(daySec / 3600);
  const mm = Math.floor((daySec % 3600) / 60);
  const ss = Math.floor(daySec % 60);
  const ms = Math.floor((s - totalInt) * 1000);

  return (
    `${String(hh).padStart(2, "0")}:` +
    `${String(mm).padStart(2, "0")}:` +
    `${String(ss).padStart(2, "0")}.` +
    `${String(ms).padStart(3, "0")}`
  );
}

export type SlideLikeForTimeline = {
  duration?: number | null;
  id?: number | string;
};

export type SlideTimelineItem = {
  index: number;
  slideId: number | string | null;
  duration: number;

  startAbsSec: number;
  endAbsSec: number;

  startDaySec: number;
  endDaySec: number;

  startHHMMSSmmm: string;
  endHHMMSSmmm: string;
};

export type SlideTimeline = {
  baseStartDaySec: number;
  totalDuration: number;
  items: SlideTimelineItem[];
};

/** loop واحد (childStartTime + كل slides مرة) */
export function buildPlaylistTimeline(
  slides: SlideLikeForTimeline[],
  childStartTime?: string | null
): SlideTimeline | null {
  if (!childStartTime || !slides.length) return null;

  const baseStartDaySec = toSecs(childStartTime);
  let acc = 0;

  const items: SlideTimelineItem[] = slides.map((s, idx) => {
    const rawDur =
      typeof s.duration === "number" && Number.isFinite(s.duration)
        ? (s.duration as number)
        : 0;
    const duration = Math.max(0, rawDur);

    const startAbsSec = baseStartDaySec + acc;
    const endAbsSec = startAbsSec + duration;

    const startDaySec = clampDay(startAbsSec);
    const endDaySec = clampDay(endAbsSec);

    const startHHMMSSmmm = secsToHHMMSSmmm(startAbsSec);
    const endHHMMSSmmm = secsToHHMMSSmmm(endAbsSec);

    acc += duration;

    return {
      index: idx,
      slideId: (s.id as any) ?? null,
      duration,
      startAbsSec,
      endAbsSec,
      startDaySec,
      endDaySec,
      startHHMMSSmmm,
      endHHMMSSmmm,
    };
  });

  return {
    baseStartDaySec,
    totalDuration: acc,
    items,
  };
}

/* ====== Timeline على مستوى الـ parent window مع loops ====== */

export type LoopSlideInstance = SlideTimelineItem & {
  loopIndex: number;
};

export type LoopTimeline = {
  loopIndex: number;
  startAbsSec: number;
  endAbsSec: number;
  items: LoopSlideInstance[];
};

export type SchedulePlaylistTimeline = {
  scheduleId: number | string;

  baseStartDaySec: number;   // child start (ثانية اليوم)
  loopDuration: number;      // طول loop واحد

  windowStartAbsSec: number; // بداية window
  windowEndAbsSec: number;   // نهاية window
  windowDuration: number;

  fullLoops: number;
  hasPartialLast: boolean;

  loops: LoopTimeline[];
};

/**
 * Schedule window: من childStartTime → endHms
 * بنقسّمها loops (كاملة + partial) وبنسجّل بداية / نهاية كل slide بكل loop
 */
export function buildSchedulePlaylistTimeline(
  scheduleId: number | string,
  slides: SlideLikeForTimeline[],
  childStartTime: string | null | undefined,
  endHms: string | null | undefined
): SchedulePlaylistTimeline | null {
  if (!childStartTime || !endHms || !slides.length) return null;

  const base = buildPlaylistTimeline(slides, childStartTime);
  if (!base || base.totalDuration <= 0) return null;

  const windowStartDaySec = base.baseStartDaySec;
  const endDaySec = toSecs(endHms);

  // طول ال window مع دعم cross-midnight
  let windowDuration: number;
  if (endDaySec >= windowStartDaySec) {
    windowDuration = endDaySec - windowStartDaySec;
  } else {
    windowDuration = (DAY_SEC - windowStartDaySec) + endDaySec;
  }
  if (windowDuration <= 0) return null;

  const windowStartAbsSec = windowStartDaySec;
  const windowEndAbsSec = windowStartAbsSec + windowDuration;

  const loopDuration = base.totalDuration;
  const fullLoops = Math.floor(windowDuration / loopDuration);
  const remainder = windowDuration - fullLoops * loopDuration;
  const hasPartialLast = remainder > 0.001;
  const totalLoops = fullLoops + (hasPartialLast ? 1 : 0);

  const loops: LoopTimeline[] = [];

  for (let loopIndex = 0; loopIndex < totalLoops; loopIndex++) {
    const loopOffset = loopIndex * loopDuration;
    const loopStartAbsSec = windowStartAbsSec + loopOffset;
    const loopEndAbsSec = Math.min(
      loopStartAbsSec + loopDuration,
      windowEndAbsSec
    );

    const items: LoopSlideInstance[] = [];

    for (const baseItem of base.items) {
      const slideStart = baseItem.startAbsSec + loopOffset;
      const slideEnd = baseItem.endAbsSec + loopOffset;

      const clippedStart = Math.max(slideStart, windowStartAbsSec);
      const clippedEnd = Math.min(slideEnd, windowEndAbsSec);
      if (clippedEnd <= clippedStart) continue;

      items.push({
        ...baseItem,
        loopIndex,
        startAbsSec: clippedStart,
        endAbsSec: clippedEnd,
        startDaySec: clampDay(clippedStart),
        endDaySec: clampDay(clippedEnd),
        startHHMMSSmmm: secsToHHMMSSmmm(clippedStart),
        endHHMMSSmmm: secsToHHMMSSmmm(clippedEnd),
      });
    }

    loops.push({
      loopIndex,
      startAbsSec: loopStartAbsSec,
      endAbsSec: loopEndAbsSec,
      items,
    });
  }

  return {
    scheduleId,
    baseStartDaySec: windowStartDaySec,
    loopDuration,
    windowStartAbsSec,
    windowEndAbsSec,
    windowDuration,
    fullLoops,
    hasPartialLast,
    loops,
  };
}
