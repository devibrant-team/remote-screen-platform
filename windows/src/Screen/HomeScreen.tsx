import "swiper/css";
import "swiper/css/effect-fade";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SmartPlayer from "../features/schedule/components/SmartPlayer";
import { useScreenId } from "../features/schedule/hooks/useScreenId";
import { echo, ReverbConnection, persistAuthTokenFromEvent } from "../echo";
import { useResolvedPlaylist } from "../features/schedule/hooks/useResolvedPlaylist";
import {
  setNowPlaying,
  loadLastGoodDefault,
  loadLastGoodChild,
  saveLastGoodChild,
  getNowPlaying,
} from "../utils/playlistCache";
import { hashPlaylist } from "../utils/playlistHash";
import {
  prefetchSlideMedia,
  prefetchWindow,
  prefetchWholePlaylist,
  setAdaptiveVideoWarmRange,
  probeBandwidth,
} from "../utils/mediaPrefetcher";
import type { ChildPlaylistResponse } from "../types/schedule";
import { currentNetMode, type NetMode } from "../utils/netHealth";

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

const describePlaylist = (pl: PlaylistT | null) => ({
  slides: hasSlides(pl) ? pl.slides.length : 0,
  hash: hashPlaylist(pl as any),
});

/* ────────────────────────────────────────────
   Prefetch helpers
────────────────────────────────────────────── */

async function warmPlaylistLight(
  pl: PlaylistT | null,
  windowCount = 2,
  timeoutMs = 800
) {
  if (!hasSlides(pl)) return;
  const cancels: Array<() => void> = [];
  try {
    const slides = pl.slides as any[];
    cancels.push(prefetchSlideMedia(slides[0]));
    cancels.push(prefetchWindow(slides, 0, windowCount));
    await new Promise<void>((r) => setTimeout(r, timeoutMs));
  } finally {
    cancels.forEach((c) => c());
  }
}

function headlessWarmDOM(playlist: PlaylistT | null, maxMs = 180000) {
  if (!hasSlides(playlist)) return () => {};

  const cancelFetch = prefetchWholePlaylist(playlist as any);

  const holder = document.createElement("div");
  holder.style.position = "absolute";
  holder.style.width = "0px";
  holder.style.height = "0px";
  holder.style.overflow = "hidden";
  holder.style.opacity = "0";
  holder.style.pointerEvents = "none";
  document.body.appendChild(holder);

  const created: Array<HTMLImageElement | HTMLVideoElement> = [];
  for (const slide of (playlist!.slides as any[]) ?? []) {
    for (const slot of slide.slots || []) {
      const url = slot?.ImageFile as string | undefined;
      const type = String(slot?.mediaType || "").toLowerCase();
      if (!url) continue;
      if (type === "video") {
        const v = document.createElement("video");
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = "anonymous";
        v.src = url;
        v.style.position = "absolute";
        v.style.width = "1px";
        v.style.height = "1px";
        v.style.opacity = "0";
        holder.appendChild(v);
        created.push(v);
      } else {
        const img = new Image();
        img.decoding = "async";
        img.loading = "eager";
        img.src = url;
        created.push(img as any);
      }
    }
  }

  const timer = window.setTimeout(() => {}, maxMs);

  return () => {
    try {
      window.clearTimeout(timer);
    } catch {}
    try {
      created.forEach((el) => {
        if (el instanceof HTMLVideoElement) {
          try {
            el.pause();
            el.src = "";
          } catch {}
        }
      });
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    } catch {}
    cancelFetch();
  };
}

/* ────────────────────────────────────────────
   Component
────────────────────────────────────────────── */

const PREWARM_LEAD_MS = 10 * 60 * 1000;

const HomeScreen: React.FC = () => {
  const qc = useQueryClient();
  const { screenId } = useScreenId();

  const {
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

  // Probe bandwidth once when we know a candidate video URL
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
  }, [decision.playlist, (decision as any)?.source, cachedDefault]);

  // -------- Double Buffering --------
  const [current, setCurrent] = useState<PlaylistT | null>(
    () => targetPlaylist
  );
  const [next, setNext] = useState<PlaylistT | null>(null);
  const [nextReady, setNextReady] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  const currentHash = useRef<string>(hashPlaylist(current as any));
  const swapAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const blockTargetUntil = useRef<number>(0);

  // Swap when target changes
  useEffect(() => {
    const targetHash = hashPlaylist(targetPlaylist as any);
    if (Date.now() < blockTargetUntil.current) return;
    if (!targetPlaylist || targetHash === currentHash.current) return;

    swapAbortRef.current.aborted = true;
    swapAbortRef.current = { aborted: false };

    setNext(targetPlaylist);
    setNextReady(false);

    (async () => {
      const winCount = netMode === "ONLINE_SLOW" ? 3 : 2;
      await warmPlaylistLight(targetPlaylist, winCount, 800);
      if (swapAbortRef.current.aborted) return;
      setNextReady(true);

      setIsSwapping(true);
      setTimeout(() => {
        if (swapAbortRef.current.aborted) return;
        setCurrent(targetPlaylist);
        currentHash.current = targetHash;
        setIsSwapping(false);
        setNext(null);
        setNextReady(false);
      }, 250);
    })();

    return () => {
      swapAbortRef.current.aborted = true;
    };
  }, [targetPlaylist, netMode]);

  // Save what is displayed
  useEffect(() => {
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

  const quietRefresh = async (
    overrideScheduleId?: number | string | null
  ) => {
    const sid = overrideScheduleId ?? latest.current.scheduleId ?? null;

    // ✅ log فقط عند محاولة الـrefresh
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


  // Server push — refresh + log ONLY when events are received
  useEffect(() => {
    if (!screenId) return;

    const channelName = `screens.${screenId}`;
    const channel = echo.channel(channelName);

    const handleEvent =
      (label: string) => (payload: ScheduleUpdatePayload) => {
        const sid = (payload?.scheduleId ??
          payload?.schedule_id ??
          latest.current.scheduleId ??
          null) as number | string | null;

        // ✅ log فقط عند استقبال event
        console.log("[Reverb] 📩 Event", {
          label,
          channelName,
          screenId,
          scheduleId: sid,
        });

        try {
          persistAuthTokenFromEvent?.(payload);
        } catch {}

        // ⬅ هنا نعمل الـrefresh
        void quietRefresh(sid);
      };

    channel.listen(".ScheduleUpdate", handleEvent("ScheduleUpdate"));
    channel.listen(".PlaylistReload", handleEvent("PlaylistReload"));

    return () => {
      try {
        channel.stopListening(".ScheduleUpdate");
        channel.stopListening(".PlaylistReload");
        echo.leave(channelName);
      } catch {
        // no logs هنا
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, quietRefreshAll]);



  // Save child after loop
  useEffect(() => {
    const onLoop = () => {
      if (!hasSlides(current)) return;
      if ((decision as any)?.source === "child") {
        saveLastGoodChild(current);
      }
    };
    window.addEventListener("playlist:loop", onLoop);
    return () => window.removeEventListener("playlist:loop", onLoop);
  }, [current, (decision as any)?.source]);

  // أوفلاين: لو window انتهت نرجّع آخر Default
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
      setNowPlaying("default", def!);
    })();
  }, [activeEndDelayMs, isOnline, netMode]);

  // بعد عودة النت: اعمل refresh بسيط
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

  // Prewarm قبل الجدولة القادمة
  const prewarmTimerRef = useRef<number | null>(null);
  const stopHeadlessRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (prewarmTimerRef.current) {
      window.clearTimeout(prewarmTimerRef.current);
      prewarmTimerRef.current = null;
    }
    try {
      stopHeadlessRef.current();
    } catch {}
    stopHeadlessRef.current = () => {};

    if (typeof nextStartDelayMs === "number" && hasSlides(upcomingPlaylist)) {
      const ms = Math.max(0, nextStartDelayMs - PREWARM_LEAD_MS);

      prewarmTimerRef.current = window.setTimeout(() => {
        stopHeadlessRef.current = headlessWarmDOM(
          upcomingPlaylist,
          3 * 60 * 1000
        );
      }, ms);
    }
    return () => {
      if (prewarmTimerRef.current) {
        window.clearTimeout(prewarmTimerRef.current);
        prewarmTimerRef.current = null;
      }
      try {
        stopHeadlessRef.current();
      } catch {}
      stopHeadlessRef.current = () => {};
    };
  }, [nextStartDelayMs, upcomingPlaylist]);

  // Headless warm عند تغيير target بدون جدولة
  useEffect(() => {
    if (typeof nextStartDelayMs === "number" && upcomingPlaylist) return;

    try {
      stopHeadlessRef.current();
    } catch {}
    stopHeadlessRef.current = () => {};

    if (Date.now() < blockTargetUntil.current) return;
    if (hasSlides(targetPlaylist)) {
      stopHeadlessRef.current = headlessWarmDOM(targetPlaylist, 2 * 60 * 1000);
    }

    return () => {
      try {
        stopHeadlessRef.current();
      } catch {}
      stopHeadlessRef.current = () => {};
    };
  }, [targetPlaylist, nextStartDelayMs, upcomingPlaylist]);

  // Idle full prefetch لما الظروف ممتازة
  useEffect(() => {
    if (!hasSlides(current)) return;
    if (netMode !== "ONLINE_GOOD") return;
    if (nextReady || isSwapping) return;
    const cancel = prefetchWholePlaylist(current as any);
    return () => cancel();
  }, [current, netMode, nextReady, isSwapping]);

  // UI

  if (!screenId) {
    return (
      <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">
        Device not linked.
      </main>
    );
  }

  if (!hasSlides(current) && isLoading) {
    return (
      <main className="w-screen h-[100dvh] grid place-items-center bg-black text-white">
        Loading…
      </main>
    );
  }

  const noRenderable = !hasSlides(current) && (!hasSlides(next) || !nextReady);

  return (
    <main className="relative w-screen h-[100dvh] bg-black text-white overflow-hidden">
      {hasSlides(current) && (
        <div className="absolute inset-0">
          <SmartPlayer
            key={`current-${hashPlaylist(current as any)}`}
            playlist={current as PlaylistT}
            screenId={screenId}
            scheduleId={activeScheduleId}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {hasSlides(next) && (
        <div
          className={classNames(
            "absolute inset-0 transition-opacity duration-300",
            nextReady ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <SmartPlayer
            key={`next-${hashPlaylist(next as any)}`}
            playlist={next as PlaylistT}
            screenId={screenId}
            scheduleId={activeScheduleId}
            onRequestRefetch={() => void quietRefresh(null)}
          />
        </div>
      )}

      {noRenderable && (
        <div className="absolute inset-0 grid place-items-center bg-black text-white">
          <div className="text-center opacity-70">
            <div className="text-2xl font-semibold">Devibrant Player</div>
            <div className="text-sm mt-1">Preparing content…</div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-black/0" />
    </main>
  );
};

export default HomeScreen;
