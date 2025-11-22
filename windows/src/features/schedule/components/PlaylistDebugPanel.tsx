// src/features/schedule/components/PlaylistDebugPanel.tsx

import React, { useEffect, useMemo, useState } from "react";
import type { PlaylistSlide } from "../../../types/schedule";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";
import {
  loadLastGoodChild,
  loadLastGoodDefault,
} from "../../../utils/playlistCache";

type Props = {
  slides: PlaylistSlide[];
  activeIndex: number;
  scheduleId?: string | number;
  // كم مرق على الشريحة الحالية (من PlaylistPlayer)
  slideElapsed: number;
};

const DAY_SEC = 86400;

function clampDay(s: number) {
  return ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

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

// عدّ الميديا داخل الشريحة (للمعلومة فقط)
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
  slideElapsed,
}) => {
  const clock = useServerClockStrict();

  // server time
  const initialSecs = clock.nowSecs();
  const [serverTime, setServerTime] = useState<string>(
    secsToHHMMSSmmm(initialSecs)
  );
  const [serverSecsRaw, setServerSecsRaw] = useState<string>(
    initialSecs.toFixed(3)
  );
  const [driftSec, setDriftSec] = useState<number>(clock.driftSec());
  const [tz, setTz] = useState<string | null>(clock.timezone());

  // cache info
  const [isCached, setIsCached] = useState<boolean | null>(null);

  const slide = slides[activeIndex] ?? null;
  const duration = Number(slide?.duration || 0);

  const mediaCount = useMemo(() => countMediaInSlide(slide), [slide]);

  // server clock تحديث كل ثانية
  useEffect(() => {
    const id = window.setInterval(() => {
      const secs = clock.nowSecs();
      setServerTime(secsToHHMMSSmmm(secs));
      setServerSecsRaw(secs.toFixed(3));
      setDriftSec(clock.driftSec());
      setTz(clock.timezone());
    }, 1000);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // حساب الوقت المتبقي + progress
  const elapsed = slideElapsed;
  const timeLeft = Math.max(0, duration - elapsed);
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  // فحص الكاش (child/default)
  useEffect(() => {
    try {
      const cachedChild = loadLastGoodChild();
      const cachedDefault = loadLastGoodDefault();

      const childHasCached =
        !!cachedChild?.playlist?.slides &&
        Array.isArray(cachedChild.playlist.slides) &&
        cachedChild.playlist.slides.length > 0;

      const defaultHasCached =
        !!cachedDefault?.playlist?.slides &&
        Array.isArray(cachedDefault.playlist.slides) &&
        cachedDefault.playlist.slides.length > 0;

      const hasCached = childHasCached || defaultHasCached;
      setIsCached(hasCached);
    } catch {
      setIsCached(null);
    }
  }, [scheduleId]);

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-50">
      <div className="bg-black/70 border border-white/20 rounded-lg px-3 py-2 text-[11px] leading-snug text-white shadow-lg min-w-[240px] space-y-1 font-mono">
        <div className="font-semibold text-xs text-emerald-300">
          Debug · Playlist
        </div>

        {/* Server clock */}
        <div className="flex justify-between">
          <span className="text-white/60">Server</span>
          <span>{serverTime}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Secs</span>
          <span>{serverSecsRaw}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Drift</span>
          <span>{driftSec.toFixed(3)}s</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">TZ</span>
          <span>{tz ?? "…"}</span>
        </div>

        <div className="mt-1 border-t border-white/10 pt-1" />

        {/* Slide info */}
        <div className="flex justify-between">
          <span className="text-white/60">Schedule</span>
          <span>{scheduleId ?? "none"}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Slide</span>
          <span>
            {slides.length ? `${activeIndex + 1} / ${slides.length}` : "-"}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Duration</span>
          <span>{duration > 0 ? `${duration}s` : "auto / none"}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Elapsed</span>
          <span>{elapsed.toFixed(2)}s</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Left</span>
          <span>{timeLeft.toFixed(2)}s</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Progress</span>
          <span>{progress.toFixed(1)}%</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Media in slide</span>
          <span>{mediaCount}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-white/60">Cached</span>
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
