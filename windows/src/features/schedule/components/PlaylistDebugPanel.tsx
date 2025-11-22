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
};

const DAY_SEC = 86400;

function clampDay(s: number) {
  return ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

function secsToHHMMSS(s: number) {
  s = clampDay(Math.floor(s));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(
    2,
    "0"
  )}:${String(ss).padStart(2, "0")}`;
}

// ✅ HH:MM:SS.mmm
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

// عدّ الميديا داخل الشريحة
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
  const [isCached, setIsCached] = useState<boolean | null>(null);

  const slide = slides[activeIndex] ?? null;
  const slideDuration = slide?.duration ?? null;

  const mediaCount = useMemo(() => countMediaInSlide(slide), [slide]);

  // ⏱️ تحديث وقت السيرفر كل ثانية — نربطه مرّة واحدة فقط
  useEffect(() => {
    const id = window.setInterval(() => {
      const secs = clock.nowSecs();
      setServerTime(secsToHHMMSSmmm(secs));
      setServerSecsRaw(secs.toFixed(3));
      setDriftSec(clock.driftSec());
      setTz(clock.timezone());
    }, 1000);

    return () => window.clearInterval(id);
    // ما نحط clock بالـ deps عشان ما ينعاد الـ effect
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 👇 فحص الكاش مرّة واحدة (أو لما scheduleId يتغيّر)
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

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-50">
      <div className="bg-black/70 border border-white/20 rounded-lg px-3 py-2 text-[11px] leading-snug text-white shadow-lg min-w-[220px] space-y-1">
        <div className="font-semibold text-xs text-emerald-300">
          Debug · Playlist
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Server time</span>
          <span className="font-mono">{serverTime}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Server secs</span>
          <span className="font-mono">{serverSecsRaw}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Timezone</span>
          <span className="font-mono">
            {tz ?? <span className="text-white/40">…</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Drift</span>
          <span className="font-mono">{driftSec.toFixed(3)}s</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Schedule ID</span>
          <span className="font-mono">
            {scheduleId ?? <span className="text-white/40">none</span>}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Slide index</span>
          <span className="font-mono">
            {slides.length ? `${activeIndex + 1} / ${slides.length}` : "-"}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Slide duration</span>
          <span className="font-mono">
            {slideDuration ? `${slideDuration}s` : "auto / none"}
          </span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Media in slide</span>
          <span className="font-mono">{mediaCount}</span>
        </div>

        <div className="flex justify-between gap-3">
          <span className="text-white/60">Cached playlist</span>
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
