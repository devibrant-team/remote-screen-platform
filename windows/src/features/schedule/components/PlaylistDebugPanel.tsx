// src/features/schedule/components/PlaylistDebugPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { PlaylistSlide } from "../../../types/schedule";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";
import {
  loadLastGoodChild,
  loadLastGoodDefault,
} from "../../../utils/playlistCache";
import { buildPlaylistTimeline, type SchedulePlaylistTimeline } from "../../../utils/playlistTimeline";

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

  scheduleTimeline?: SchedulePlaylistTimeline | null
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

  // 🧵 Timeline كامل مبني على childStartTime + durations
  const timeline = useMemo(() => {
    return buildPlaylistTimeline(slides as any, childStartTime ?? undefined);
  }, [slides, childStartTime]);

  // أي صف من الـ timeline نعرضه؟ منطقي لو مفعّل، وإلا UI index
  const timelineRow =
    timeline &&
    (logicEnabled
      ? timeline.items[logicIndex] ?? timeline.items[activeIndex]
      : timeline.items[activeIndex]);

  const timelineStart = timelineRow?.startHHMMSSmmm ?? null;
  const timelineEnd = timelineRow?.endHHMMSSmmm ?? null;

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

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-50">
      <div className="bg-black/70 border border-emerald-500/40 rounded-lg px-3 py-2 text-[11px] leading-snug text-white shadow-lg min-w-[260px] space-y-1">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-xs text-emerald-300">
            Debug · Playlist
          </div>
          <div className="text-[10px] text-emerald-200">{syncModeLabel}</div>
        </div>

        {/* Server clock */}
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Server</span>
          <span className="font-mono">{serverTime}</span>
        </div>
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Secs</span>
          <span className="font-mono">{serverSecsRaw}</span>
        </div>
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Drift</span>
          <span className="font-mono">{driftSec.toFixed(3)}s</span>
        </div>
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">RTT</span>
          <span className="font-mono">{rtt.toFixed(1)}ms</span>
        </div>
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Sync count</span>
          <span className="font-mono">{syncCount}</span>
        </div>
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">TZ</span>
          <span className="font-mono">
            {tz ?? <span className="text-white/40">…</span>}
          </span>
        </div>

        {/* Schedule / slide info */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Schedule</span>
          <span className="font-mono">
            {scheduleId ?? <span className="text-white/40">none</span>}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Child start</span>
          <span className="font-mono">
            {childStartTime ?? <span className="text-white/40">none</span>}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Slide (UI)</span>
          <span className="font-mono">
            {totalSlides ? `${activeIndex + 1} / ${totalSlides}` : "-"}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Slide (logic)</span>
          <span className="font-mono">{logicSlideHuman}</span>
        </div>

        {/* Timeline start/end على السيرفر */}
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Start @server</span>
          <span className="font-mono">
            {timelineStart ?? <span className="text-white/40">—</span>}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">End @server</span>
          <span className="font-mono">
            {timelineEnd ?? <span className="text-white/40">—</span>}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Next slide in</span>
          <span className="font-mono">{nextMsLabel}</span>
        </div>

        {/* Duration / elapsed / left / progress */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Duration</span>
          <span className="font-mono">
            {duration ? `${duration.toFixed(3)}s` : "auto / none"}
          </span>
        </div>

        {/* Elapsed (effective / local / server) */}
        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Elapsed (effective)</span>
          <span className="font-mono">{effectiveElapsed.toFixed(3)}s</span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Elapsed (local)</span>
          <span className="font-mono">{localElapsed.toFixed(3)}s</span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Elapsed (server)</span>
          <span className="font-mono">
            {logicEnabled ? `${logicOffset.toFixed(3)}s` : "—"}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Left</span>
          <span className="font-mono">
            {left != null ? `${left.toFixed(3)}s` : "—"}
          </span>
        </div>

        <div className="flex  justify-between gap-3">
          <span className="text-white/60">Progress</span>
          <span className="font-mono">
            {progress != null ? `${progress.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* Media + cache */}
        <div className="h-px bg-white/10 my-1" />

        <div className="flex  justify-between gap-3">
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
