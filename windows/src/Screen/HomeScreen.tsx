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

/* ========== Debug Utilities (fluent) ========== */
type DebugGroup = {
  log: (obj: Record<string, any>) => DebugGroup;
  end: () => void;
};
const DEBUG = true as const;
const dGroup = (label: string): DebugGroup => {
  if (!DEBUG) {
    const noop: DebugGroup = { log: () => noop, end: () => {} };
    return noop;
  }
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[HomeScreen] ${label} @ ${ts}`);
  const api: DebugGroup = {
    log: (obj) => {
      /* eslint-disable no-console */ console.log(obj);
      /* eslint-enable */ return api;
    },
    end: () => {
      /* eslint-disable no-console */ console.groupEnd(); /* eslint-enable */
    },
  };
  return api;
};

const describePlaylist = (pl: PlaylistT | null) => ({
  slides: hasSlides(pl) ? pl.slides.length : 0,
  hash: hashPlaylist(pl as any),
});

async function snapshotCacheStorage() {
  if (!("caches" in window)) return { supported: false } as const;
  try {
    const names = await caches.keys();
    const details: Record<string, { count: number; sample?: string[] }> = {};
    for (const name of names) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      details[name] = {
        count: reqs.length,
        sample: reqs.slice(0, 5).map((r) => r.url),
      };
    }
    return { supported: true, names, details } as const;
  } catch (e) {
    return { supported: true, error: String(e) } as const;
  }
}

function snapshotLocalCache() {
  const lastDefault = loadLastGoodDefault();
  const lastChild = loadLastGoodChild();
  const now = getNowPlaying();
  return {
    lastDefault: lastDefault
      ? {
          savedAt: lastDefault.savedAt,
          slides: lastDefault.playlist?.slides?.length ?? 0,
          source: lastDefault.source,
        }
      : null,
    lastChild: lastChild
      ? {
          savedAt: lastChild.savedAt,
          slides: lastChild.playlist?.slides?.length ?? 0,
          source: lastChild.source,
        }
      : null,
    nowPlaying: now
      ? {
          savedAt: now.savedAt,
          slides: now.playlist?.slides?.length ?? 0,
          source: now.source,
        }
      : null,
  };
}

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

  let cancelFetch = prefetchWholePlaylist(playlist as any);

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
    const on = () => {
      setIsOnline(true);
      dGroup("NET_ONLINE").end();
    };
    const off = () => {
      setIsOnline(false);
      dGroup("NET_OFFLINE").end();
    };
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
    dGroup("STATE")
      .log({
        screenId,
        activeScheduleId,
        isOnline,
        netMode,
        activeEndDelayMs,
        nextStartDelayMs,
      })
      .end();
  }, [
    screenId,
    activeScheduleId,
    isOnline,
    netMode,
    activeEndDelayMs,
    nextStartDelayMs,
  ]);

  const cachedDefault: PlaylistT | null = useMemo(() => {
    const cached = loadLastGoodDefault();
    const pl = (cached?.playlist as PlaylistT | undefined) || null;
    if (hasSlides(pl)) dGroup("CACHED_DEFAULT").log(describePlaylist(pl)).end();
    return pl || null;
  }, []);

  const targetPlaylist: PlaylistT | null = useMemo(() => {
    const serverPl = (decision.playlist as PlaylistT | undefined) || null;
    const target = hasSlides(serverPl) ? serverPl : cachedDefault;
    const reason = hasSlides(serverPl)
      ? `decision:${(decision as any)?.source}`
      : cachedDefault
      ? "cached-default"
      : "none";
    dGroup("TARGET")
      .log({ reason, ...describePlaylist(target || null) })
      .end();
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

  const degradedLockUntil = useRef<number>(0);
  const blockTargetUntil = useRef<number>(0);

  const forcedDefaultDueToExpiryRef = useRef<boolean>(false);

  // Swap when target changes
  useEffect(() => {
    const targetHash = hashPlaylist(targetPlaylist as any);
    if (Date.now() < blockTargetUntil.current) return;
    if (!targetPlaylist || targetHash === currentHash.current) return;

    swapAbortRef.current.aborted = true;
    swapAbortRef.current = { aborted: false };

    setNext(targetPlaylist);
    setNextReady(false);
    dGroup("STAGE_NEXT")
      .log({ target: describePlaylist(targetPlaylist) })
      .end();

    (async () => {
      const winCount = netMode === "ONLINE_SLOW" ? 3 : 2;
      await warmPlaylistLight(targetPlaylist, winCount, 800);
      if (swapAbortRef.current.aborted) return;
      setNextReady(true);
      dGroup("NEXT_READY").log(describePlaylist(targetPlaylist)).end();

      setIsSwapping(true);
      setTimeout(() => {
        if (swapAbortRef.current.aborted) return;
        setCurrent(targetPlaylist);
        currentHash.current = targetHash;
        setIsSwapping(false);
        setNext(null);
        setNextReady(false);
        dGroup("SWAP_DONE")
          .log({ current: describePlaylist(targetPlaylist) })
          .end();
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
    dGroup("DISPLAY_NOW")
      .log({ source, ...describePlaylist(current) })
      .end();
  }, [current, decision.playlist, (decision as any).source]);

  const quietRefresh = async (overrideScheduleId?: number | string | null) => {
    if (Date.now() < blockTargetUntil.current) return;
    await quietRefreshAll(
      overrideScheduleId ?? latest.current.scheduleId ?? null
    );
  };

  // Server push — quiet refresh (فكّ الأقفال + التقاط snake/camel + حفظ التوكن)
  useEffect(() => {
    if (!screenId) return;
    const channelName = `screens.${screenId}`;
    const channel = echo.channel(channelName);

    let refreshTimer: number | undefined;

    const triggerRefresh = (sid: number | string | null, payload?: any) => {
      try {
        persistAuthTokenFromEvent?.(payload);
      } catch {}

      // فكّ الأقفال: اسمح بالتبديل فورًا بعد أي Push
      blockTargetUntil.current = 0;
      forcedDefaultDueToExpiryRef.current = false;

      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(async () => {
        dGroup("SERVER_PUSH")
          .log({ channelName, sid, note: "quietRefresh start" })
          .end();
        try {
          await quietRefresh(sid);
          dGroup("REFRESH_DONE").log({ channelName, sid }).end();
        } catch (err) {
          dGroup("REFRESH_ERR")
            .log({ err: String(err) })
            .end();
        }
      }, 100);
    };

    const on = (label: string) => (payload: ScheduleUpdatePayload) => {
      const sid = (payload?.scheduleId ??
        payload?.schedule_id ??
        latest.current.scheduleId ??
        null) as number | string | null;
      dGroup("SERVER_EVENT").log({ label, payload, sid }).end();
      triggerRefresh(sid, payload);
    };

    channel.listen(".ScheduleUpdate", on("ScheduleUpdate"));
    channel.listen(".PlaylistReload", on("PlaylistReload"));

    const off = ReverbConnection.onStatus((s) => {
      if (s === "connected") {
        try {
          echo.leave(channelName);
        } catch {}
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

  // Save child after loop
  useEffect(() => {
    const onLoop = () => {
      if (!hasSlides(current)) return;
      if ((decision as any)?.source === "child") {
        saveLastGoodChild(current);
        dGroup("LOOP_SAVED_CHILD").log(describePlaylist(current)).end();
      }
    };
    window.addEventListener("playlist:loop", onLoop);
    return () => window.removeEventListener("playlist:loop", onLoop);
  }, [current, (decision as any)?.source]);

  // عندما نكون أوفلاين لفترة طويلة ممكن نرجّع Default كـ fallback
  useEffect(() => {
    if (typeof activeEndDelayMs !== "number") return;
    if (isOnline) return; // 🔁 لا تعمل أي شيء أونلاين – Reverb هو الحَكَم
    if (activeEndDelayMs > 0) return;

    forcedDefaultDueToExpiryRef.current = true;

    (async () => {
      const def = loadLastGoodDefault()?.playlist as PlaylistT | undefined;
      if (!hasSlides(def)) return;
      const winCount = netMode === "ONLINE_SLOW" ? 3 : 2;
      await warmPlaylistLight(def!, winCount, 500);
      setCurrent(def!);
      currentHash.current = hashPlaylist(def as any);
      setNowPlaying("default", def!);
      dGroup("FORCED_DEFAULT_ON_EXPIRY_OFFLINE")
        .log({ def: describePlaylist(def!) })
        .end();
    })();
  }, [activeEndDelayMs, isOnline, netMode]);

  // بعد عودة النت: لا ترجع child من الكاش إذا انتهت نافذته (لكن افتح الطريق)
  useEffect(() => {
    if (!isOnline) return;
    (async () => {
      try {
        await quietRefresh(null);

        if (!activeScheduleId) {
          dGroup("RESUME_SKIP_NO_SCHEDULE")
            .log({ note: "online + no schedule → keep default" })
            .end();
          blockTargetUntil.current = 0;
          const swSnap = await snapshotCacheStorage();
          dGroup("CACHE_SNAPSHOT_AFTER_RESUME")
            .log({ local: snapshotLocalCache(), cacheStorage: swSnap })
            .end();
          return;
        }

        // لا نرجّع child من الكاش إذا كان Expired — ننتظر قرار السيرفر
        blockTargetUntil.current = 0;

        const localSnap = snapshotLocalCache();
        const swSnap = await snapshotCacheStorage();
        dGroup("CACHE_SNAPSHOT_AFTER_RESUME")
          .log({ local: localSnap, cacheStorage: swSnap })
          .end();
      } catch (e) {
        dGroup("RESUME_CHILD_ERR")
          .log({ e: String(e) })
          .end();
      }
    })();
  }, [isOnline, netMode, activeScheduleId]);

  // تنظيف forced flag عند Child جديد بهاش مختلف
  useEffect(() => {
    if (!hasSlides(decision.playlist)) return;
    if ((decision as any).source === "child") {
      if (hashPlaylist(decision.playlist) !== currentHash.current) {
        forcedDefaultDueToExpiryRef.current = false;
        dGroup("CLEAR_FORCED_FLAG_ON_NEW_CHILD")
          .log({ note: "new child arrived with different hash" })
          .end();
      }
    }
  }, [decision.playlist, (decision as any)?.source]);

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
      dGroup("SCHEDULE_PREWARM")
        .log({
          inMs: ms,
          nextDelayMs: nextStartDelayMs,
          upcoming: describePlaylist(upcomingPlaylist),
        })
        .end();

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
      dGroup("HEADLESS_WARM_NOW").log(describePlaylist(targetPlaylist)).end();
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

  // Heartbeat
  const didSnapshotOnce = useRef(false);
  useEffect(() => {
    const id = window.setInterval(async () => {
      const g = dGroup("HEARTBEAT");
      g.log({
        isOnline,
        netMode,
        current: describePlaylist(current),
        next: describePlaylist(next),
        nextReady,
        isSwapping,
        locks: {
          degradedLockUntil: degradedLockUntil.current,
          blockTargetUntil: blockTargetUntil.current,
        },
        flags: {
          forcedDefaultDueToExpiry: forcedDefaultDueToExpiryRef.current,
        },
        nowPlaying: getNowPlaying(),
      });
      if (!didSnapshotOnce.current) {
        didSnapshotOnce.current = true;
        g.log({ localCache: snapshotLocalCache() });
        const swSnap = await snapshotCacheStorage();
        g.log({ cacheStorage: swSnap });
      }
      g.end();
    }, 15000);
    return () => window.clearInterval(id);
  }, [isOnline, netMode, current, next, nextReady, isSwapping]);

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

  // حزام أمان: Splash بدل السواد لو لا current ولا next جاهز
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
