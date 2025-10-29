// src/pages/HomeScreen.tsx
import "swiper/css";
import "swiper/css/effect-fade";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
// ⬇️ Use SmartPlayer (auto-picks Normal vs Interactive)
import SmartPlayer from "../features/schedule/components/SmartPlayer";
import { useScreenId } from "../features/schedule/hooks/useScreenId";
import { echo, ReverbConnection } from "../echo";
import { useResolvedPlaylist } from "../features/schedule/hooks/useResolvedPlaylist";
import { setNowPlaying, loadLastGoodDefault } from "../utils/playlistCache";
import { hashPlaylist } from "../utils/playlistHash";
import { prefetchSlideMedia, prefetchWindow } from "../utils/mediaPrefetcher";

type ScheduleUpdatePayload = { scheduleId?: number | string } & Record<string, unknown>;
const hasSlides = (pl?: any) => Array.isArray(pl?.slides) && pl.slides.length > 0;
const isInteractive = (pl?: any) =>
  Array.isArray(pl?.slides) &&
  pl.slides.length > 0 &&
  !!pl.slides[0]?.media &&        // interactive slides have `media`
  !pl.slides[0]?.slots;           // and do not have `slots`

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

// ---- logging helpers ----
const describePlaylist = (pl: any) => ({
  slides: Array.isArray(pl?.slides) ? pl.slides.length : 0,
  hash: hashPlaylist(pl),
  kind: isInteractive(pl) ? "interactive" : "normal",
});
const log = (tag: string, info: Record<string, any>) => {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[HomeScreen] ${tag} @ ${ts}`);
  // eslint-disable-next-line no-console
  console.log(info);
  // eslint-disable-next-line no-console
  console.groupEnd();
};

// ---- warming helper: handles both normal (slots) & interactive (media) ----
async function warmPlaylist(pl: any, windowCount = 2, timeoutMs = 1200): Promise<void> {
  if (!hasSlides(pl)) return;

  const cancels: Array<() => void> = [];
  try {
    if (isInteractive(pl)) {
      // Interactive: each slide has a single background image URL in `media`
      const slides: Array<{ media?: string }> = pl.slides ?? [];
      // Prefetch current (index 0) + window ahead
      const loaders: HTMLImageElement[] = [];
      const preload = (url?: string) => {
        if (!url) return;
        const img = new Image();
        img.decoding = "async";
        img.loading = "eager";
        img.src = url;
        loaders.push(img);
      };
      if (slides[0]?.media) preload(slides[0].media);
      const len = slides.length;
      const ahead = Math.min(windowCount, Math.max(0, len - 1));
      for (let i = 1; i <= ahead; i++) {
        const s = slides[i % len];
        if (s?.media) preload(s.media);
      }
      // nothing to cancel for <img>; keep interface parity
      cancels.push(() => {});
    } else {
      // Normal: use your existing prefetchers for slots
      const slides = pl.slides;
      cancels.push(prefetchSlideMedia(slides[0]));
      cancels.push(prefetchWindow(slides, 0, windowCount));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  } finally {
    cancels.forEach((c) => c());
  }
}

const HomeScreen: React.FC = () => {
  const qc = useQueryClient();
  const { screenId } = useScreenId();
  const { activeScheduleId, decision, isLoading, quietRefreshAll } = useResolvedPlaylist(screenId);

  // Keep latest IDs to avoid stale closures
  const latest = useRef<{ screenId?: string | number; scheduleId?: string | number }>({});
  useEffect(() => {
    latest.current = { screenId, scheduleId: activeScheduleId };
    log("STATE", { screenId, activeScheduleId });
  }, [screenId, activeScheduleId]);

  // Cached default (for gaps / offline)
  const cachedDefault = useMemo(() => {
    const cached = loadLastGoodDefault();
    const pl = cached?.playlist && hasSlides(cached.playlist) ? cached.playlist : null;
    if (pl) log("CACHED_DEFAULT", describePlaylist(pl));
    return pl;
  }, []);

  // Decide what we *want* to show (prefer server decision, else cached default)
  const targetPlaylist = useMemo(() => {
    const target =
      (hasSlides(decision.playlist) && decision.playlist) ||
      cachedDefault ||
      null;
    const reason = hasSlides(decision.playlist)
      ? `decision:${decision.source}`
      : cachedDefault
      ? "cached-default"
      : "none";
    log("TARGET", { reason, ...describePlaylist(target) });
    return target;
  }, [decision.playlist, decision.source, cachedDefault]);

  // -------- DOUBLE BUFFERING STATE --------
  const [current, setCurrent] = useState<any | null>(() => targetPlaylist);
  const [next, setNext] = useState<any | null>(null);
  const [nextReady, setNextReady] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  const currentHash = useRef<string>(hashPlaylist(current));
  const swapAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // When target changes to a different hash, stage it as "next", warm it, then swap.
  useEffect(() => {
    const targetHash = hashPlaylist(targetPlaylist);
    if (!targetPlaylist || targetHash === currentHash.current) return;

    // cancel any previous staging
    swapAbortRef.current.aborted = true;
    swapAbortRef.current = { aborted: false };

    setNext(targetPlaylist);
    setNextReady(false);
    log("STAGE_NEXT", { target: describePlaylist(targetPlaylist) });

    (async () => {
      await warmPlaylist(targetPlaylist, 2, 800);
      if (swapAbortRef.current.aborted) return;
      setNextReady(true);
      log("NEXT_READY", describePlaylist(targetPlaylist));

      // crossfade swap
      setIsSwapping(true);
      setTimeout(() => {
        if (swapAbortRef.current.aborted) return;
        setCurrent(targetPlaylist);
        currentHash.current = targetHash;
        setIsSwapping(false);
        setNext(null);
        setNextReady(false);
        log("SWAP_DONE", { current: describePlaylist(targetPlaylist) });
      }, 250);
    })();

    return () => {
      swapAbortRef.current.aborted = true;
    };
  }, [targetPlaylist]);

  // Persist what is actually displayed (for offline "keep running")
  useEffect(() => {
    if (!hasSlides(current)) return;
    const isSameAsDecision =
      hasSlides(decision.playlist) &&
      hashPlaylist(decision.playlist) === hashPlaylist(current);
    const source: "child" | "default" =
      isSameAsDecision && decision.source === "child" ? "child" : "default";
    setNowPlaying(source, current);
    log("DISPLAY_NOW", { source, ...describePlaylist(current) });
  }, [current, decision.playlist, decision.source]);

  const quietRefresh = async (overrideScheduleId?: number | string | null) => {
    await quietRefreshAll(overrideScheduleId ?? latest.current.scheduleId ?? null);
  };

  // Reverb events — background refresh without interrupting display
  useEffect(() => {
    if (!screenId) return;
    const channelName = `screens.${screenId}`;
    const channel = echo.channel(channelName);

    let refreshTimer: number | undefined;
    const triggerRefresh = (sid: number | string | null) => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        try {
          log("SERVER_PUSH", { channelName, sid, note: "quietRefresh start" });
          await quietRefresh(sid);
          log("REFRESH_DONE", { channelName, sid });
        } catch (err) {
          log("REFRESH_ERR", { err: String(err) });
        }
      }, 75);
    };

    const on = (label: string) => (payload: ScheduleUpdatePayload) => {
      const sid = (payload?.scheduleId ?? latest.current.scheduleId ?? null) as number | string | null;
      log("SERVER_EVENT", { label, payload, sid });
      triggerRefresh(sid);
    };

    channel.listen(".ScheduleUpdate", on("ScheduleUpdate"));
    channel.listen(".PlaylistReload", on("PlaylistReload"));

    const off = ReverbConnection.onStatus((s) => {
      if (s === "connected") {
        try { echo.leave(channelName); } catch {}
        const c = echo.channel(channelName);
        c.listen(".ScheduleUpdate", on("ScheduleUpdate(reconnect)"));
        c.listen(".PlaylistReload", on("PlaylistReload(reconnect)"));
      }
    });

    return () => {
      try {
        channel.stopListening(".ScheduleUpdate");
        channel.stopListening(".PlaylistReload");
        echo.leave(channelName);
      } catch {}
      off();
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, qc]);

  // ---- UI branching ----
  if (!screenId) {
    return (
      <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">
        Device not linked.
      </main>
    );
  }

  // If we truly have nothing yet (first boot, no cache)
  if (!hasSlides(current) && isLoading) {
    return (
      <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">
        Loading…
      </main>
    );
  }

  // Render double-buffered players: current beneath, next on top faded in when ready
  return (
    <main className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden">
      {/* Current player (always visible during swap) */}
      {hasSlides(current) && (
        <div className="absolute inset-0">
          <SmartPlayer
            key={`current-${hashPlaylist(current)}`}
            playlist={current}
            screenId={screenId}
            scheduleId={activeScheduleId}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {/* Next player (mounted, warmed, then crossfades in) */}
      {hasSlides(next) && (
        <div
          className={classNames(
            "absolute inset-0 transition-opacity duration-300",
            nextReady ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <SmartPlayer
            key={`next-${hashPlaylist(next)}`}
            playlist={next}
            screenId={screenId}
            scheduleId={activeScheduleId}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {/* Optional subtle overlay during swap (kept transparent here) */}
      <div
        className={classNames(
          "pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300",
          isSwapping ? "bg-black/0" : "bg-black/0"
        )}
      />
    </main>
  );
};

export default HomeScreen;
