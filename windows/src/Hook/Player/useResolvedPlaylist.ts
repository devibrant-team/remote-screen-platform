// src/features/schedule/hooks/useResolvedPlaylist.ts
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useChildPlaylist,
  fetchChildPlaylist,
} from "../../ReactQuery/schedule/useChildPlaylist";
import {
  useDefaultPlaylist,
  fetchDefaultPlaylist,
} from "../../ReactQuery/schedule/useDefaultPlaylist";
import {
  saveLastGoodDefault,
  loadLastGoodChild,
  loadLastGoodDefault,
  getNowPlaying,
} from "../../utils/playlistCache";
import { prefetchWindow } from "../../utils/mediaPrefetcher";
import { qk } from "../../ReactQuery/queryKeys";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import { resolveActiveAndNext, toSecs } from "../../utils/scheduleTime";
import {
  useParentSchedules,
  pickScheduleId,
} from "../../ReactQuery/schedule/useParentSchedules";

type Decision =
  | { source: "child"; playlist: any; reason: string }
  | { source: "default"; playlist: any; reason: string }
  | { source: "cache"; playlist: any; reason: string }
  | { source: "empty"; playlist: null; reason: string };

const hasSlides = (pl?: any) =>
  Array.isArray(pl?.slides) && pl.slides.length > 0;

/* ---------- Safe access helpers ---------- */
function pickStr(obj: unknown, key: string): string | undefined {
  const v = (obj as any)?.[key];
  return typeof v === "string" ? v : undefined;
}
function pickFirstDefined<T = any>(
  obj: unknown,
  keys: string[]
): T | undefined {
  for (const k of keys) {
    const v = (obj as any)?.[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

/* ---------- Date+Time helpers (server-based) ---------- */
function daysBetween(a: string, b: string) {
  const A = new Date(a + "T00:00:00Z").getTime();
  const B = new Date(b + "T00:00:00Z").getTime();
  return Math.round((B - A) / 86400000);
}

// نفس فكرة smart للـ drift
function msUntilDateTimeSmart(
  clock: ReturnType<typeof useServerClockStrict>,
  today: string | undefined,
  targetDate?: string | null,
  targetTime?: string | null
): number | undefined {
  if (!today || !targetDate || !targetTime) return undefined;
  if (!clock.isReady()) return undefined;

  const nowSec = clock.nowSecs();
  const targetSec = toSecs(targetTime);

  const dayDiff = daysBetween(today, targetDate);
  const rawMs = dayDiff * 86400000 + (targetSec - nowSec) * 1000;

  if (rawMs < 0 && rawMs > -300) return 0;
  return rawMs;
}

export function useResolvedPlaylist(screenId?: string) {
  const qc = useQueryClient();
  const clock = useServerClockStrict();

  // 🧠 نجيب parent schedules مباشرة
  const parent = useParentSchedules(screenId);

  const day = parent.data?.date;
  const items = parent.data?.data ?? [];

  // ⏱️ tick محلي سريع (كل 100ms) لنعيد حساب الـ active حسب ساعة السيرفر
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTimeTick((t) => t + 1);
    }, 100); // 0.1 ثانية
    return () => clearInterval(id);
  }, []);

  // active/next حسب (date + time) من السيرفر
  const { active, next } = useMemo(() => {
    if (!day || items.length === 0) {
      return { active: undefined, next: null };
    }

    if (!clock.isReady()) {
      return { active: undefined, next: null };
    }

    const nowSec = clock.nowSecs();
    return resolveActiveAndNext(items, day, nowSec);
  }, [day, items, timeTick, clock]);

  const activeScheduleId = pickScheduleId(active) ?? undefined;
  const nextScheduleId = pickScheduleId(next) ?? undefined;

  /* ── تأخيرات مبنية على ساعة السيرفر فقط (date+time) ── */
  const activeEndDelayMs: number | undefined = (() => {
    if (!active) return undefined;
    const endTime = pickStr(active, "end_time");
    const endDate =
      (active as any).end_date ??
      (active as any).start_date ??
      (active as any).start_day;
    return msUntilDateTimeSmart(clock, day, endDate, endTime);
  })();

  const nextStartDelayMs: number | undefined = (() => {
    if (!next) return undefined;
    const startTime = pickStr(next, "start_time");
    const startDate = (next as any).start_date ?? (next as any).start_day;
    return msUntilDateTimeSmart(clock, day, startDate, startTime);
  })();

  /* ── Live child query (للـ active schedule) ───────────────── */
  const child = useChildPlaylist(activeScheduleId, screenId);

  const wantDefault =
    !active || child.isError || !hasSlides(child.data?.playlist);

  const defaultQ = useDefaultPlaylist(screenId, wantDefault as any);

  /* ── Persist آخر نسخة ناجحة للـ Default ─────────────── */
  useEffect(() => {
    if (hasSlides(defaultQ.data?.playlist)) {
      saveLastGoodDefault(defaultQ.data!.playlist);
    }
  }, [defaultQ.data?.playlist]);

  /* ── Prefetch default أثناء الفجوات ───────────────────────── */
  useEffect(() => {
    if (!screenId) return;
    if (!active) {
      qc
        .prefetchQuery({
          queryKey: qk.def(screenId),
          queryFn: () => fetchDefaultPlaylist(screenId),
          staleTime: 5 * 60_000,
        })
        .catch(() => {});
    }
  }, [screenId, active, qc]);

  /* ── Prefetch child للـ active schedule كـ backup ─────────── */
  useEffect(() => {
    if (!activeScheduleId) return;
    qc
      .prefetchQuery({
        queryKey: qk.child(activeScheduleId, screenId),
        queryFn: () => fetchChildPlaylist(activeScheduleId, screenId),
        staleTime: 60_000,
      })
      .catch(() => {});
  }, [activeScheduleId, screenId, qc]);

  /* ── Prefetch child القادم قبل 30 ثانية من بداية الـ schedule (date+time) ─────────── */
  useEffect(() => {
    if (!next) return;
    if (!screenId) return;
    if (!clock.isReady()) return;

    const sid = nextScheduleId;
    const startTime = pickStr(next, "start_time");
    const startDate = (next as any).start_date ?? (next as any).start_day;
    if (!sid || !startTime || !startDate) return;

    const rawMs = msUntilDateTimeSmart(clock, day, startDate, startTime);
    if (rawMs == null) return;

    const PREFETCH_LEAD_MS = 30_000;
    const delay = Math.max(0, rawMs - PREFETCH_LEAD_MS);

    let timer: number | undefined;

    const arm = () => {
      qc
        .prefetchQuery({
          queryKey: qk.child(sid, screenId),
          queryFn: () => fetchChildPlaylist(sid, screenId),
          staleTime: 60_000,
        })
        .catch(() => {});
    };

    if (delay === 0) arm();
    else timer = window.setTimeout(arm, delay);

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [next, nextScheduleId, screenId, clock, qc, day]);

  const upcomingPlaylist = useMemo(() => {
    return pickFirstDefined<any>(next, ["playlist", "child"]) ?? null;
  }, [next]);

  /* ── Decision logic: Child vs Default ────────────────────── */
  const decision: Decision = useMemo(() => {
    const running = getNowPlaying() ?? null;

    const cachedChild = loadLastGoodChild();
    const cachedDefault = loadLastGoodDefault();

    const liveChild = child.data?.playlist;
    const liveDefault = defaultQ.data?.playlist;

    const hasActiveSchedule = !!active;

    const runningHasSlides = running && hasSlides(running.playlist);
    const runningIsChild =
      running && running.source === "child" && hasSlides(running.playlist);

    if (!hasActiveSchedule) {
      if (hasSlides(liveDefault)) {
        return {
          source: "default",
          playlist: liveDefault,
          reason: "no schedule → fresh default",
        };
      }

      if (hasSlides(cachedDefault?.playlist)) {
        return {
          source: "cache",
          playlist: cachedDefault!.playlist,
          reason: "no schedule → cached default",
        };
      }

      if (running && running.source === "default" && hasSlides(running.playlist)) {
        return {
          source: "cache",
          playlist: running.playlist,
          reason: "no schedule → keep running default",
        };
      }

      return {
        source: "empty",
        playlist: null,
        reason: "no schedule → nothing available",
      };
    }

    // B) في schedule فعّال

    if (hasSlides(liveChild)) {
      return {
        source: "child",
        playlist: liveChild,
        reason: "active schedule → live child",
      };
    }

    if (runningIsChild) {
      return {
        source: "cache",
        playlist: running!.playlist,
        reason: "active schedule → keep running child (server down)",
      };
    }

    if (hasSlides(cachedChild?.playlist)) {
      return {
        source: "cache",
        playlist: cachedChild!.playlist,
        reason: "active schedule → cached child (fallback)",
      };
    }

    if (hasSlides(liveDefault)) {
      return {
        source: "default",
        playlist: liveDefault,
        reason: "active schedule → fallback default (live)",
      };
    }

    if (hasSlides(cachedDefault?.playlist)) {
      return {
        source: "cache",
        playlist: cachedDefault!.playlist,
        reason: "active schedule → fallback default (cached)",
      };
    }

    if (runningHasSlides) {
      return {
        source: "cache",
        playlist: running!.playlist,
        reason: "active schedule → keep running playlist (last resort)",
      };
    }

    return {
      source: "empty",
      playlist: null,
      reason: "active schedule → nothing available",
    };
  }, [
    active,
    child.data?.playlist,
    defaultQ.data?.playlist,
    parent.isLoading,
    child.isError,
    defaultQ.isError,
  ]);

  // Prefetch window من الشرائح للميديا (صور/فيديو) حسب الـ decision
  useEffect(() => {
    if (!hasSlides(decision.playlist)) return;
    const cancel = prefetchWindow(decision.playlist.slides, 0, 2);
    return () => cancel();
  }, [decision.playlist]);

  const activeScheduleIdFinal = activeScheduleId;

  const quietRefreshAll = async (overrideScheduleId?: number | string | null) => {
    const sid = overrideScheduleId ?? activeScheduleIdFinal ?? undefined;
    const parentKey = qk.parent(screenId);
    const childKey = sid != null ? qk.child(sid, screenId) : null;
    const defaultKey = qk.def(screenId);

    await qc.invalidateQueries({ queryKey: parentKey, refetchType: "active" });
    if (childKey)
      await qc.invalidateQueries({ queryKey: childKey, refetchType: "active" });
    await qc.invalidateQueries({ queryKey: defaultKey, refetchType: "active" });

    await qc.refetchQueries({ queryKey: parentKey, type: "active" });
    if (childKey)
      await qc.refetchQueries({ queryKey: childKey, type: "active" });
    await qc.refetchQueries({ queryKey: defaultKey, type: "active" });
  };

  const anyLoading = parent.isLoading || child.isLoading || defaultQ.isLoading;
  const isLoadingSafe = anyLoading && !hasSlides(decision.playlist);

  return {
    parent,
    active,
    next,
    activeScheduleId: activeScheduleIdFinal,
    decision,
    isLoading: isLoadingSafe,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,
    activeEndDelayMs,
    nextStartDelayMs,
    upcomingPlaylist,
  };
}
