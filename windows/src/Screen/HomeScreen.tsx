// src/pages/HomeScreen.tsx
import "swiper/css";
import "swiper/css/effect-fade";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SmartPlayer from "../components/Player/SmartPlayer";
import { useScreenId } from "../Hook/Device/useScreenId";
import { echo, persistAuthTokenFromEvent } from "../echo";
import { useResolvedPlaylist } from "../Hook/Player/useResolvedPlaylist";
import {
  setNowPlaying,
  loadLastGoodDefault,
  saveLastGoodChild,
} from "../utils/playlistCache";
import { hashPlaylist } from "../utils/playlistHash";
import {
  prefetchWholePlaylist,
  setAdaptiveVideoWarmRange,
  probeBandwidth,
} from "../utils/mediaPrefetcher";
import type { ChildPlaylistResponse } from "../types/schedule";
import { currentNetMode, type NetMode } from "../utils/netHealth";
import HeadlessWarmup from "../components/Player/HeadlessWarmup";
import type { PlaylistLoopHealthDetail } from "../Hook/Player/usePlaylistHealth";
import { useScreenDeletedGuardReverb } from "../Hook/Device/useScreenDeletedGuardReverb";
import NoSchedule from "../components/NoSchedule/NoSchedule";
import LoadingScreen from "../components/Loading/LoadingScreen";

type PlaylistT = ChildPlaylistResponse["playlist"];
type ScheduleUpdatePayload = {
  scheduleId?: number | string;
  schedule_id?: number | string;
} & Record<string, unknown>;

const hasSlides = (pl?: PlaylistT | null): pl is PlaylistT =>
  !!pl && Array.isArray(pl.slides) && pl.slides.length > 0;

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function warmPlaylistLight(
  pl: PlaylistT | null,
  windowCount = 2,
  timeoutMs = 800
) {
  if (!hasSlides(pl)) return;
  const cancels: Array<() => void> = [];
  try {
    const slides = pl.slides as any[];
    const { prefetchSlideMedia, prefetchWindow } = await import(
      "../utils/mediaPrefetcher"
    );
    cancels.push(prefetchSlideMedia(slides[0]));
    cancels.push(prefetchWindow(slides, 0, windowCount));
    await new Promise<void>((r) => setTimeout(r, timeoutMs));
  } catch {
    // ignore
  } finally {
    cancels.forEach((c) => c());
  }
}

const PREWARM_LEAD_MS = 10 * 60 * 1000;

const HomeScreen: React.FC = () => {
  const qc = useQueryClient();
  const { screenId } = useScreenId();
  // 👇 هنا نستدعي الـ hook الجديد
  useScreenDeletedGuardReverb(screenId);

  const {
    parent,
    active,
    next,
    activeScheduleId,
    decision,
    isLoading,
    quietRefreshAll,
    activeEndDelayMs,
    nextStartDelayMs,
    upcomingPlaylist,
  } = useResolvedPlaylist(screenId);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [netMode, setNetMode] = useState<NetMode>(currentNetMode());
const canWriteNowPlaying = () => {
  const linked = localStorage.getItem("linked") === "1";
  const token = localStorage.getItem("authToken");
  return linked && !!token;
};


  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const tick = () => {
      const m = currentNetMode();
      setNetMode(m);
      setAdaptiveVideoWarmRange(m);
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Probe bandwidth
  useEffect(() => {
    const pl =
      (decision?.playlist as PlaylistT | null) ||
      (upcomingPlaylist as PlaylistT | null) ||
      null;

    const sample =
      pl?.slides
        ?.flatMap((s: any) => s?.slots || [])
        ?.find(
          (slot: any) => String(slot?.mediaType || "").toLowerCase() === "video"
        )?.ImageFile || null;

    if (sample) probeBandwidth(sample).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashPlaylist((decision?.playlist as any) || null)]);

  const latest = useRef<{
    screenId?: string | number;
    scheduleId?: string | number;
  }>({});

  useEffect(() => {
    latest.current = { screenId, scheduleId: activeScheduleId };
  }, [screenId, activeScheduleId]);

  const cachedDefault: PlaylistT | null = useMemo(() => {
    const cached = loadLastGoodDefault();
    const pl = (cached?.playlist as PlaylistT | undefined) || null;
    return pl || null;
  }, []);

  const targetPlaylist: PlaylistT | null = useMemo(() => {
    const serverPl = (decision.playlist as PlaylistT | undefined) || null;
    const target = hasSlides(serverPl) ? serverPl : cachedDefault;
    return target || null;
  }, [decision.playlist, cachedDefault]);

  const childStartTime: string | null = useMemo(() => {
    if (!active) return null;
    return (active as any)?.start_time ?? null;
  }, [active]);

  // -------- Double Buffering --------
  const [current, setCurrent] = useState<PlaylistT | null>(
    () => targetPlaylist
  );
  const [nextPl, setNextPl] = useState<PlaylistT | null>(null);
  const [nextReady, setNextReady] = useState(false);

  const currentHash = useRef<string>(hashPlaylist(current as any));
  const swapAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const blockTargetUntil = useRef<number>(0);

  useEffect(() => {
    const targetHash = hashPlaylist(targetPlaylist as any);
    if (Date.now() < blockTargetUntil.current) return;
    if (!targetPlaylist || targetHash === currentHash.current) return;

    swapAbortRef.current.aborted = true;
    swapAbortRef.current = { aborted: false };

    setNextPl(targetPlaylist);
    setNextReady(false);

    (async () => {
      const winCount = netMode === "ONLINE_SLOW" ? 3 : 2;
      await warmPlaylistLight(targetPlaylist, winCount, 800);
      if (swapAbortRef.current.aborted) return;
      setNextReady(true);

      setTimeout(() => {
        if (swapAbortRef.current.aborted) return;
        setCurrent(targetPlaylist);
        currentHash.current = targetHash;
        setNextPl(null);
        setNextReady(false);
      }, 250);
    })();

    return () => {
      swapAbortRef.current.aborted = true;
    };
  }, [targetPlaylist, netMode]);

  useEffect(() => {
    if (!canWriteNowPlaying()) return;
    if (!hasSlides(current)) return;
    const sameAsDecision =
      hasSlides(decision.playlist as any) &&
      hashPlaylist(decision.playlist as any) === hashPlaylist(current as any);
    const source: "child" | "default" =
      sameAsDecision && (decision as any).source === "child"
        ? "child"
        : "default";
    setNowPlaying(source, current);
  }, [current, decision.playlist, (decision as any).source]);

  const quietRefresh = async (overrideScheduleId?: number | string | null) => {
    const sid = overrideScheduleId ?? latest.current.scheduleId ?? null;

    console.log("[Reverb] 🔄 quietRefresh (by event)", {
      screenId,
      scheduleId: sid,
    });

    try {
      await quietRefreshAll(sid);
      console.log("[Reverb] ✅ quietRefreshAll done", {
        screenId,
        scheduleId: sid,
      });
    } catch (err) {
      console.log("[Reverb] ❌ quietRefreshAll error", {
        screenId,
        scheduleId: sid,
        err,
      });
    }
  };

  useEffect(() => {
    if (!screenId) return;

    const channelName = `screens.${screenId}`;
    const channel = echo.channel(channelName);

    const handleEvent = (label: string) => (payload: ScheduleUpdatePayload) => {
      const sid = (payload?.scheduleId ??
        payload?.schedule_id ??
        latest.current.scheduleId ??
        null) as number | string | null;

      console.log("[Reverb] 📩 Event", {
        label,
        channelName,
        screenId,
        scheduleId: sid,
      });

      try {
        persistAuthTokenFromEvent?.(payload);
      } catch {}

      void quietRefresh(sid);
    };

    channel.listen(".ScheduleUpdate", handleEvent("ScheduleUpdate"));
    channel.listen(".PlaylistReload", handleEvent("PlaylistReload"));

    return () => {
      try {
        channel.stopListening(".ScheduleUpdate");
        channel.stopListening(".PlaylistReload");
        echo.leave(channelName);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, quietRefreshAll]);

  useEffect(() => {
    const handler = (ev: Event) => {
      if (!hasSlides(current)) return;

      const detail = (ev as CustomEvent<PlaylistLoopHealthDetail>).detail;
      if (!detail) return;
      if ((decision as any)?.source !== "child") return;

      if (!detail.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[PlaylistHealth] loop had glitch, skip save", detail);
        }
        return;
      }

      try {
        saveLastGoodChild(current as any);
        if (process.env.NODE_ENV !== "production") {
          // console.log(
          //   "[PlaylistHealth] ✅ saved lastGoodChild from clean loop",
          //   {
          //     loopIndex: detail.loopIndex,
          //     scheduleId: detail.scheduleId,
          //   }
          // );
        }
      } catch (e) {
        console.log("[PlaylistHealth] saveLastGoodChild error", e);
      }
    };

    window.addEventListener("playlist:loop-health", handler as any);
    return () => {
      window.removeEventListener("playlist:loop-health", handler as any);
    };
  }, [current, (decision as any)?.source]);

  useEffect(() => {
    if (typeof activeEndDelayMs !== "number") return;
    if (isOnline) return;
    if (activeEndDelayMs > 0) return;

    (async () => {
      const def = loadLastGoodDefault()?.playlist as PlaylistT | undefined;
      if (!hasSlides(def)) return;
      const winCount = netMode === "ONLINE_SLOW" ? 3 : 2;
      await warmPlaylistLight(def!, winCount, 500);
      setCurrent(def!);
      currentHash.current = hashPlaylist(def as any);
        if (canWriteNowPlaying()) {
      setNowPlaying("default", def!); // ✅ guarded
    }
    })();
  }, [activeEndDelayMs, isOnline, netMode]);

  useEffect(() => {
    if (!isOnline) return;
    (async () => {
      try {
        await quietRefresh(null);
        blockTargetUntil.current = 0;
      } catch (e) {
        console.log("[Reverb] resume refresh error", e);
      }
    })();
  }, [isOnline, netMode, activeScheduleId]);

  const [enableUpcomingWarm, setEnableUpcomingWarm] = useState(false);

  useEffect(() => {
    if (typeof nextStartDelayMs !== "number" || !hasSlides(upcomingPlaylist)) {
      setEnableUpcomingWarm(false);
      return;
    }

    if (nextStartDelayMs <= PREWARM_LEAD_MS) {
      setEnableUpcomingWarm(true);
    } else {
      setEnableUpcomingWarm(false);
    }
  }, [nextStartDelayMs, upcomingPlaylist]);

  useEffect(() => {
    if (enableUpcomingWarm) return;
    if (!hasSlides(targetPlaylist)) return;
    const cancel = prefetchWholePlaylist(targetPlaylist as any);
    return () => cancel();
  }, [enableUpcomingWarm, targetPlaylist]);

  if (!hasSlides(current) && isLoading) {
    return (
      <main className="w-screen h-[100dvh] grid place-items-center  text-white">
        <LoadingScreen />
      </main>
    );
  }

  const noRenderable =
    !hasSlides(current) && (!hasSlides(nextPl) || !nextReady);

  return (
    <main className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden">
      {enableUpcomingWarm && hasSlides(upcomingPlaylist) && (
        <HeadlessWarmup
          playlist={upcomingPlaylist as any}
          maxMs={3 * 60_000}
          aggressive={true}
        />
      )}

      {!enableUpcomingWarm && hasSlides(targetPlaylist) && (
        <HeadlessWarmup
          playlist={targetPlaylist as any}
          maxMs={2 * 60_000}
          aggressive={false}
        />
      )}

      {hasSlides(current) && (
        <div className="absolute inset-0">
          <SmartPlayer
            key={`current-${hashPlaylist(current as any)}`}
            playlist={current as PlaylistT}
            screenId={screenId}
            scheduleId={activeScheduleId}
            childStartTime={childStartTime}
            activeSchedule={active as any}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {hasSlides(nextPl) && (
        <div
          className={classNames(
            "absolute inset-0 transition-opacity duration-300",
            nextReady ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <SmartPlayer
            key={`next-${hashPlaylist(nextPl as any)}`}
            playlist={nextPl as PlaylistT}
            screenId={screenId}
            scheduleId={activeScheduleId}
            childStartTime={childStartTime}
            activeSchedule={active as any}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {noRenderable && (
        <div className="absolute inset-0 grid place-items-center bg-black text-white">
          <NoSchedule />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-black/0" />
    </main>
  );
};

export default HomeScreen;
