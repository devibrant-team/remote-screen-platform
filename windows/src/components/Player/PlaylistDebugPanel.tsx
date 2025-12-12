// src/features/schedule/components/PlaylistDebugPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { PlaylistSlide } from "../../types/schedule";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import {
  loadLastGoodChild,
  loadLastGoodDefault,
} from "../../utils/playlistCache";
import {
  buildPlaylistTimeline,
  type SchedulePlaylistTimeline,
} from "../../utils/playlistTimeline";

type Props = {
  slides: PlaylistSlide[];
  activeIndex: number;
  scheduleId?: string | number;

  /** التوقيت الفعّال المستخدم داخل الـ Player (local أو server) */
  slideElapsed?: number;

  /** التايمر المحلي داخل PlaylistPlayer (للمقارنة) */
  localElapsed?: number;

  /** index المنطقي من useSlideLogic (0-based) */
  logicIndex?: number;

  /** كم ثانية مرقت داخل الشريحة حسب useSlideLogic */
  logicOffset?: number;

  /** هل sync المنطقي مفعّل؟ */
  logicEnabled?: boolean;

  /** بداية الـ child schedule من السيرفر "HH:mm:ss" */
  childStartTime?: string | null;

  /** كم ms باقي للـ next slide حسب useSlideLogic */
  logicMsUntilNext?: number | null;

  /** Timeline كامل للـ schedule (loops) */
  scheduleTimeline?: SchedulePlaylistTimeline | null;
};

const DAY_SEC = 86400;

function clampDay(s: number) {
  return ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

// HH:MM:SS.mmm
function secsToHHMMSSmmm(s: number) {
  s = clampDay(s);
  const totalInt = Math.floor(s);
  const hh = Math.floor(totalInt / 3600);
  const mm = Math.floor((totalInt % 3600) / 60);
  const ss = Math.floor(totalInt % 60);
  const ms = Math.floor((s - totalInt) * 1000);

  return (
    `${String(hh).padStart(2, "0")}:` +
    `${String(mm).padStart(2, "0")}:` +
    `${String(ss).padStart(2, "0")}.` +
    `${String(ms).padStart(3, "0")}`
  );
}

// "23:00:10.000" -> seconds of day
function timeStrToSec(str?: string | null): number | null {
  if (!str) return null;
  const [hms, msPart] = str.split(".");
  const parts = (hms || "").split(":");
  if (parts.length < 2) return null;
  const hh = parseInt(parts[0] || "0", 10);
  const mm = parseInt(parts[1] || "0", 10);
  const ss = parseInt(parts[2] || "0", 10);
  const ms = msPart ? parseInt(msPart.padEnd(3, "0").slice(0, 3), 10) : 0;
  if ([hh, mm, ss, ms].some((n) => Number.isNaN(n))) return null;
  return hh * 3600 + mm * 60 + ss + ms / 1000;
}

// نستخرج startSec / endSec من item سواء كانت أرقام أو سترنغ وقت
function getItemSecs(item: any): { startSec: number | null; endSec: number | null } {
  const rawStart =
    item.startSec ??
    item.startSeconds ??
    item.start ??
    item.startHHMMSSmmm;

  const rawEnd =
    item.endSec ??
    item.endSeconds ??
    item.end ??
    item.endHHMMSSmmm;

  const startSec =
    typeof rawStart === "number" && Number.isFinite(rawStart)
      ? rawStart
      : typeof rawStart === "string"
      ? timeStrToSec(rawStart)
      : null;

  const endSec =
    typeof rawEnd === "number" && Number.isFinite(rawEnd)
      ? rawEnd
      : typeof rawEnd === "string"
      ? timeStrToSec(rawEnd)
      : null;

  return {
    startSec: startSec ?? null,
    endSec: endSec ?? null,
  };
}

// محاولة عامة لعدّ الميديا داخل الشريحة
function countMediaInSlide(slide?: PlaylistSlide | null): number {
  if (!slide) return 0;
  const anySlide = slide as any;

  if (Array.isArray(anySlide.media)) {
    return anySlide.media.length;
  }

  if (Array.isArray(anySlide.slots)) {
    return anySlide.slots.filter((slot: any) => {
      const type = String(slot?.mediaType || "").toLowerCase();
      const hasUrl =
        !!slot?.ImageFile || !!slot?.image_url || !!slot?.video_url;
      return type === "image" || type === "video" || hasUrl;
    }).length;
  }

  if (Array.isArray(anySlide.zones)) {
    return anySlide.zones.filter(
      (z: any) =>
        z?.type === "image" ||
        z?.type === "video" ||
        !!z?.media_url ||
        !!z?.image_url ||
        !!z?.video_url
    ).length;
  }

  if (Array.isArray(anySlide.widgets)) {
    return anySlide.widgets.filter(
      (w: any) =>
        w?.type === "image" ||
        w?.type === "video" ||
        !!w?.media_url ||
        !!w?.image_url ||
        !!w?.video_url
    ).length;
  }

  return 0;
}

const PlaylistDebugPanel: React.FC<Props> = ({
  slides,
  activeIndex,
  scheduleId,
  slideElapsed = 0,
  localElapsed = 0,
  logicIndex = 0,
  logicOffset = 0,
  logicEnabled = false,
  childStartTime = null,
  logicMsUntilNext = null,
  scheduleTimeline = null,
}) => {
  const clock = useServerClockStrict();

  // 🧠 نقرأ قيم البداية فوراً من الـ clock
  const initialSecs = clock.nowSecs();
  const [serverTime, setServerTime] = useState<string>(() =>
    secsToHHMMSSmmm(initialSecs)
  );
  const [serverSecsRaw, setServerSecsRaw] = useState<string>(() =>
    initialSecs.toFixed(3)
  );
  const [driftSec, setDriftSec] = useState<number>(() => clock.driftSec());
  const [tz, setTz] = useState<string | null>(() => clock.timezone());
  const [rtt, setRtt] = useState<number>(() => clock.lastRttMs());
  const [syncCount, setSyncCount] = useState<number>(() => clock.syncCount());
  const [isCached, setIsCached] = useState<boolean | null>(null);

  const [currentLoopIndex, setCurrentLoopIndex] = useState<number | null>(null);

  const slide = slides[activeIndex] ?? null;
  const totalSlides = slides.length;

  const rawDuration =
    typeof slide?.duration === "number" && Number.isFinite(slide.duration)
      ? (slide.duration as number)
      : null;

  // ⏱️ duration / elapsed / left / progress باستخدام elapsed الفعّال
  const { duration, effectiveElapsed, left, progress } = useMemo(() => {
    if (!rawDuration || rawDuration <= 0) {
      return {
        duration: null as number | null,
        effectiveElapsed: slideElapsed,
        left: null as number | null,
        progress: null as number | null,
      };
    }
    const e = Math.max(0, Math.min(slideElapsed, rawDuration));
    const l = Math.max(0, rawDuration - e);
    const p = Math.max(0, Math.min(100, (e / rawDuration) * 100));
    return {
      duration: rawDuration,
      effectiveElapsed: e,
      left: l,
      progress: p,
    };
  }, [rawDuration, slideElapsed]);

  const mediaCount = useMemo(() => countMediaInSlide(slide), [slide]);

  // 🧵 Timeline loop واحد مبني على childStartTime + durations (fallback)
  const baseTimeline = useMemo(() => {
    return buildPlaylistTimeline(slides as any, childStartTime ?? undefined);
  }, [slides, childStartTime]);

  // 🌀 معلومات الـ schedule (start/end + loopsCount إن وجدت)
  const scheduleInfo = useMemo(() => {
    if (!scheduleTimeline) return null;
    const st: any = scheduleTimeline;

    const scheduleStart =
      st.scheduleStartHHMMSS ??
      st.scheduleStart ??
      st.startHHMMSS ??
      st.start ??
      null;

    const scheduleEnd =
      st.scheduleEndHHMMSS ?? st.scheduleEnd ?? st.endHHMMSS ?? st.end ?? null;

    const playlistStart = st.playlistStartHHMMSS ?? st.playlistStart ?? null;
    const playlistEnd = st.playlistEndHHMMSS ?? st.playlistEnd ?? null;

    const loopsCount =
      typeof st.loopsCount === "number"
        ? st.loopsCount
        : typeof st.loopCount === "number"
        ? st.loopCount
        : null;

    return { scheduleStart, scheduleEnd, playlistStart, playlistEnd, loopsCount };
  }, [scheduleTimeline]);

  // 📏 نحسب baseLoopStartSec + loopDurationSec من baseTimeline
  const loopMeta = useMemo(() => {
    if (!baseTimeline || !Array.isArray(baseTimeline.items) || !baseTimeline.items.length) {
      return null;
    }

    const items: any[] = baseTimeline.items;
    const first = items[0];
    const last = items[items.length - 1];

    const { startSec: start0 } = getItemSecs(first);
    const { endSec: endLast } = getItemSecs(last);

    if (
      start0 == null ||
      endLast == null ||
      !Number.isFinite(start0) ||
      !Number.isFinite(endLast) ||
      endLast <= start0
    ) {
      return null;
    }

    const loopDurationSec = endLast - start0;

    return {
      baseLoopStartSec: start0,
      loopDurationSec,
    };
  }, [baseTimeline]);

  // 🔁 نحدّد loop index الحالي من وقت السيرفر + طول الـ loop
  useEffect(() => {
    if (!loopMeta) {
      setCurrentLoopIndex(null);
      return;
    }

    const { baseLoopStartSec, loopDurationSec } = loopMeta;
    if (loopDurationSec <= 0) {
      setCurrentLoopIndex(null);
      return;
    }

    const compute = () => {
      const nowSec = clock.nowSecs();
      const delta = nowSec - baseLoopStartSec;

      if (delta < 0) {
        setCurrentLoopIndex(0);
        return;
      }

      const idx = Math.floor(delta / loopDurationSec);
      setCurrentLoopIndex(idx); // ممكن يزيد بدون حد أعلى
    };

    compute();
    const id = window.setInterval(compute, 500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopMeta]);

  // ❗ slide timeline للـ loop الحالي: start/end يتحركوا مع كل loop
  const slideRows = useMemo(() => {
    if (!baseTimeline || !Array.isArray(baseTimeline.items)) return [];
    const items: any[] = baseTimeline.items;

    // لا يوجد معلومات عن loop (نرجّع الـ loop الأول كما هو)
    if (!loopMeta || currentLoopIndex == null) {
      return items.map((item, idx) => {
        const sl = slides[idx];
        const d =
          typeof sl?.duration === "number" && Number.isFinite(sl.duration)
            ? sl.duration
            : null;

        const { startSec, endSec } = getItemSecs(item);

        const startStr =
          item.startHHMMSSmmm ??
          (startSec != null ? secsToHHMMSSmmm(startSec) : "—");

        const endStr =
          item.endHHMMSSmmm ??
          (endSec != null ? secsToHHMMSSmmm(endSec) : "—");

        return {
          idx,
          loopIndex: null as number | null,
          start: startStr,
          end: endStr,
          duration: d,
        };
      });
    }

    // عندنا loopIndex + loopDuration → نضيف offset على كل slide
    const offsetSec = loopMeta.loopDurationSec * currentLoopIndex;

    return items.map((item, idx) => {
      const sl = slides[idx];
      const d =
        typeof sl?.duration === "number" && Number.isFinite(sl?.duration)
          ? sl.duration
          : null;

      const { startSec, endSec } = getItemSecs(item);

      const startStr =
        startSec != null ? secsToHHMMSSmmm(startSec + offsetSec) : "—";

      const endStr =
        endSec != null ? secsToHHMMSSmmm(endSec + offsetSec) : "—";

      return {
        idx,
        loopIndex: currentLoopIndex,
        start: startStr,
        end: endStr,
        duration: d,
      };
    });
  }, [baseTimeline, slides, loopMeta, currentLoopIndex]);

  // 🧩 Start/End @server للـ slide الحالية (من slideRows مع offset)
  const timelineStartEnd = useMemo(() => {
    if (slideRows.length) {
      const currentRow = slideRows.find((r) => r.idx === activeIndex);
      if (currentRow) {
        return {
          start: currentRow.start,
          end: currentRow.end,
        };
      }
    }

    // fallback: baseTimeline من غير offset
    if (!baseTimeline)
      return { start: null as string | null, end: null as string | null };

    const item =
      baseTimeline.items[logicEnabled ? logicIndex : activeIndex] ??
      baseTimeline.items[activeIndex];

    const { startSec, endSec } = getItemSecs(item);

    return {
      start:
        item?.startHHMMSSmmm ??
        (startSec != null ? secsToHHMMSSmmm(startSec) : null),
      end:
        item?.endHHMMSSmmm ??
        (endSec != null ? secsToHHMMSSmmm(endSec) : null),
    };
  }, [slideRows, activeIndex, baseTimeline, logicEnabled, logicIndex]);

  const timelineStart = timelineStartEnd.start;
  const timelineEnd = timelineStartEnd.end;

  // ⏱️ تحديث وقت السيرفر وكل إحصائياته كل 500ms
  useEffect(() => {
    const id = window.setInterval(() => {
      const secs = clock.nowSecs();
      setServerTime(secsToHHMMSSmmm(secs));
      setServerSecsRaw(secs.toFixed(3));
      setDriftSec(clock.driftSec());
      setTz(clock.timezone());
      setRtt(clock.lastRttMs());
      setSyncCount(clock.syncCount());
    }, 500);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ما نحط clock بالـ deps عشان ما ينعاد الـ effect

  // 👇 فحص وجود أي كاش child/default (مرة لكل schedule)
  useEffect(() => {
    try {
      const cachedChild = loadLastGoodChild();
      const cachedDefault = loadLastGoodDefault();

      const childHasCached =
        !!cachedChild?.playlist &&
        Array.isArray(cachedChild.playlist.slides) &&
        cachedChild.playlist.slides.length > 0;

      const defaultHasCached =
        !!cachedDefault?.playlist &&
        Array.isArray(cachedDefault.playlist.slides) &&
        cachedDefault.playlist.slides.length > 0;

      const hasCached = childHasCached || defaultHasCached;
      setIsCached(hasCached);
    } catch {
      setIsCached(null);
    }
  }, [scheduleId]);

  const syncModeLabel = logicEnabled ? "SERVER / TIMELINE" : "LOCAL / FALLBACK";

  const logicSlideHuman =
    logicEnabled && totalSlides
      ? `${logicIndex + 1} / ${totalSlides}`
      : logicEnabled
      ? `${logicIndex + 1} / ?`
      : "—";

  const nextMsLabel =
    logicEnabled && logicMsUntilNext != null
      ? `${(logicMsUntilNext / 1000).toFixed(3)}s`
      : "—";

  // Playlist loops label (لو في loopsCount من السيرفر نعرضه)
  const loopsLabel = useMemo(() => {
    const loopsCount = scheduleInfo?.loopsCount;
    if (currentLoopIndex == null && !loopsCount) return "—";
    if (currentLoopIndex != null && !loopsCount) {
      return `${currentLoopIndex + 1}`;
    }
    if (currentLoopIndex == null && loopsCount) {
      return `${loopsCount}`;
    }
    return `${(currentLoopIndex ?? 0) + 1} / ${loopsCount}`;
  }, [scheduleInfo, currentLoopIndex]);

const scheduleStartLabel =
  scheduleInfo?.scheduleStart ??
  scheduleInfo?.playlistStart ??   // 👈 لو الـ hook يرجّع playlistStart
  childStartTime ??
  (scheduleTimeline ? "—" : "—");

const scheduleEndLabel =
  scheduleInfo?.scheduleEnd ??
  scheduleInfo?.playlistEnd ??     // 👈 fallback على playlistEnd
  (scheduleTimeline ? "—" : "—");


  return (
    <div className="pointer-events-none absolute top-3 right-3 z-50">
      <div className="bg-black/70 border border-emerald-500/40 rounded-lg px-3 py-2 text-[11px] leading-snug text-white shadow-lg min-w-[260px] max-w-[320px] space-y-1">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-xs text-emerald-300">
            Debug · Playlist
          </div>
          <div className="text-[10px] text-emerald-200">{syncModeLabel}</div>
        </div>

        {/* Server clock */}
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Server</span>
          <span className="font-mono">{serverTime}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Secs</span>
          <span className="font-mono">{serverSecsRaw}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Drift</span>
          <span className="font-mono">{driftSec.toFixed(3)}s</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-white/60">RTT</span>
          <span className="font-mono">{rtt.toFixed(1)}ms</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Sync count</span>
          <span className="font-mono">{syncCount}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-white/60">TZ</span>
          <span className="font-mono">
            {tz ?? <span className="text-white/40">…</span>}
          </span>
        </div>

        {/* Schedule / slide info */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Schedule</span>
          <span className="font-mono">
            {scheduleId ?? <span className="text-white/40">none</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Child start</span>
          <span className="font-mono">
            {childStartTime ?? <span className="text-white/40">none</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Slide (UI)</span>
          <span className="font-mono">
            {totalSlides ? `${activeIndex + 1} / ${totalSlides}` : "-"}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Slide (logic)</span>
          <span className="font-mono">{logicSlideHuman}</span>
        </div>

        {/* Timeline start/end على السيرفر للـ slide الحالية */}
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Start @server</span>
          <span className="font-mono">
            {timelineStart ?? <span className="text-white/40">—</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">End @server</span>
          <span className="font-mono">
            {timelineEnd ?? <span className="text-white/40">—</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Next slide in</span>
          <span className="font-mono">{nextMsLabel}</span>
        </div>

        {/* Duration / elapsed / left / progress */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Duration</span>
          <span className="font-mono">
            {duration ? `${duration.toFixed(3)}s` : "auto / none"}
          </span>
        </div>

        {/* Elapsed (effective / local / server) */}
        <div className="flex justify-between gap-3">
          <span className="text-white/60">Elapsed (effective)</span>
          <span className="font-mono">{effectiveElapsed.toFixed(3)}s</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Elapsed (local)</span>
          <span className="font-mono">{localElapsed.toFixed(3)}s</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Elapsed (server)</span>
          <span className="font-mono">
            {logicEnabled ? `${logicOffset.toFixed(3)}s` : "—"}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Left</span>
          <span className="font-mono">
            {left != null ? `${left.toFixed(3)}s` : "—"}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Progress</span>
          <span className="font-mono">
            {progress != null ? `${progress.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* 🔁 معلومات عن schedule loops */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Schedule start</span>
          <span className="font-mono">{scheduleStartLabel}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Schedule end</span>
          <span className="font-mono">{scheduleEndLabel}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Playlist loops</span>
          <span className="font-mono">{loopsLabel}</span>
        </div>

        {/* 🧾 جدول لكل slides: start/end للـ loop الحالي */}
        <div className="h-px bg-white/10 my-1" />

        <div className="text-[10px] text-emerald-300 mb-0.5">
          Slides timeline{" "}
          {currentLoopIndex != null
            ? `(loop ${currentLoopIndex + 1}${
                scheduleInfo?.loopsCount ? ` / ${scheduleInfo.loopsCount}` : ""
              })`
            : "(1 loop)"}
        </div>

        {slideRows.length ? (
          <div className="max-h-32 overflow-y-auto mt-1 space-y-0.5 pr-1">
            {slideRows.map((row) => (
              <div
                key={`${row.loopIndex ?? "base"}-${row.idx}`}
                className="flex justify-between gap-2 font-mono"
              >
                <div className="flex flex-col text-white/70">
                  <span>
                    #{row.idx + 1}
                    {row.duration != null
                      ? ` · ${row.duration.toFixed(3)}s`
                      : ""}
                  </span>
                </div>
                <div className="text-right text-white/80">
                  <div className="text-[10px]">{row.start}</div>
                  <div className="text-[10px]">{row.end}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-white/40 text-[10px] mt-0.5">
            No timeline available.
          </div>
        )}

        {/* Media + cache */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Media in slide</span>
          <span className="font-mono">{mediaCount}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Cached (any)</span>
          <span
            className={
              isCached === null
                ? "text-yellow-300"
                : isCached
                ? "text-emerald-400"
                : "text-red-400"
            }
          >
            {isCached === null ? "unknown" : isCached ? "yes" : "no"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default PlaylistDebugPanel;
