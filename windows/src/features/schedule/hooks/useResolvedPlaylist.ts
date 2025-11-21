// src/features/schedule/hooks/useResolvedPlaylist.ts
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import {
  useChildPlaylist,
  fetchChildPlaylist,
} from "../../../ReactQuery/schedule/useChildPlaylist";
import {
  useDefaultPlaylist,
  fetchDefaultPlaylist,
} from "../../../ReactQuery/schedule/useDefaultPlaylist";
import {
  // ما عاد نستخدم saveLastGoodChild هون – الحارس موجود في HomeScreen loop
  saveLastGoodDefault,
  loadLastGoodChild,
  loadLastGoodDefault,
  getNowPlaying,
} from "../../../utils/playlistCache";
import { prefetchWindow } from "../../../utils/mediaPrefetcher";
import { qk } from "../../../ReactQuery/queryKeys";
import { useServerClockStrict } from "../../../utils/useServerClockStrict";

type Decision =
  | { source: "child"; playlist: any; reason: string }
  | { source: "default"; playlist: any; reason: string }
  | { source: "cache"; playlist: any; reason: string }
  | { source: "empty"; playlist: null; reason: string };

const hasSlides = (pl?: any) => Array.isArray(pl?.slides) && pl.slides.length > 0;

/* ---------- Safe access helpers ---------- */
function pickStr(obj: unknown, key: string): string | undefined {
  const v = (obj as any)?.[key];
  return typeof v === "string" ? v : undefined;
}
function pickFirstDefined<T = any>(obj: unknown, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = (obj as any)?.[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

export function useResolvedPlaylist(screenId?: string) {
  const qc = useQueryClient();
  const clock = useServerClockStrict();
  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);

  /* ── Live queries ─────────────────────────────────────────── */
  const child = useChildPlaylist(activeScheduleId, screenId);

  // نفعل استعلام الـDefault فقط عند الحاجة (لا يوجد child صالح أو لا يوجد schedule)
  const wantDefault =
    !activeScheduleId || child.isError || !hasSlides(child.data?.playlist);

  const defaultQ = useDefaultPlaylist(screenId, wantDefault as any);

  /* ── Persist آخر نسخة ناجحة للـ Default فقط ─────────────── */
  useEffect(() => {
    if (hasSlides(defaultQ.data?.playlist)) {
      saveLastGoodDefault(defaultQ.data!.playlist);
    }
  }, [defaultQ.data?.playlist]);

  /* ── Prefetch default أثناء الفجوات ───────────────────────── */
  useEffect(() => {
    if (!screenId) return;
    if (!activeScheduleId) {
      qc
        .prefetchQuery({
          queryKey: qk.def(screenId),
          queryFn: () => fetchDefaultPlaylist(screenId),
          staleTime: 5 * 60_000,
        })
        .catch(() => {});
    }
  }, [screenId, activeScheduleId, qc]);

  /* ── Prefetch child عند تغيّر الـschedule الفعّال ─────────── */
  useEffect(() => {
    if (!activeScheduleId) return;
    qc
      .prefetchQuery({
        queryKey: qk.child(activeScheduleId, screenId),
        queryFn: () => fetchChildPlaylist(activeScheduleId, screenId),
        staleTime: 0,
      })
      .catch(() => {});
  }, [activeScheduleId, screenId, qc]);

  /* ── تأخيرات مبنية على ساعة السيرفر فقط (لـ prewarm/debug) ── */
  const activeEndDelayMs = useMemo(() => {
    const endTime = pickStr(active, "end_time"); // HH:mm:ss
    return endTime ? clock.msUntil(endTime) : undefined;
  }, [active, clock]);

  const nextStartDelayMs = useMemo(() => {
    const startTime = pickStr(next, "start_time"); // HH:mm:ss
    return startTime ? clock.msUntil(startTime) : undefined;
  }, [next, clock]);

  const upcomingPlaylist = useMemo(() => {
    return pickFirstDefined<any>(next, ["playlist", "child"]) ?? null;
  }, [next]);

  /* ── Decision logic: نثق بالسيرفر/Reverb عند وجود schedule ── */
  const decision: Decision = useMemo(() => {
    const running = getNowPlaying() ?? null;

    const cachedChild = loadLastGoodChild();
    const cachedDefault = loadLastGoodDefault();

    const liveChild = child.data?.playlist;
    const liveDefault = defaultQ.data?.playlist;

    // وجود activeScheduleId يعني أن السيرفر قرر وجود schedule فعّال
    const hasActiveSchedule = activeScheduleId != null;

    /* (A) لا يوجد schedule حالياً → نرجّح الـ Default دائماً */
    if (!hasActiveSchedule) {
      // 1) أحدث Default من السيرفر
      if (hasSlides(liveDefault)) {
        return {
          source: "default",
          playlist: liveDefault,
          reason: "no schedule → fresh default",
        };
      }
      // 2) Default من الكاش
      if (hasSlides(cachedDefault?.playlist)) {
        return {
          source: "cache",
          playlist: cachedDefault!.playlist,
          reason: "no schedule → cached default",
        };
      }
      // 3) لو الـrunning الحالي كان Default، خليه (ريفريش أو رجوع من أوفلاين)
      if (
        running &&
        hasSlides(running.playlist) &&
        running.source === "default"
      ) {
        return {
          source: "cache",
          playlist: running.playlist,
          reason: "no schedule → keep running default",
        };
      }
      // 4) لا شيء
      return {
        source: "empty",
        playlist: null,
        reason: "no schedule → no default available",
      };
    }

    /* (B) يوجد schedule (السيرفر هو اللي قرر) */
    // أولوية: Child من السيرفر
    if (hasSlides(liveChild)) {
      return {
        source: "child",
        playlist: liveChild,
        reason: "active schedule → live child",
      };
    }

    // ثم Child من الكاش (مرّت playlist لفة كاملة سابقاً)
    if (hasSlides(cachedChild?.playlist)) {
      return {
        source: "cache",
        playlist: cachedChild!.playlist,
        reason: "active schedule → cached child",
      };
    }

    // Fallback: Default (live ثم cached)
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

    // آخر محاولة: لو في running playlist خلّيه
    if (running && hasSlides(running.playlist)) {
      return {
        source: "cache",
        playlist: running.playlist,
        reason: "active schedule → keep running playlist",
      };
    }

    // لا شيء متاح رغم وجود schedule
    return {
      source: "empty",
      playlist: null,
      reason: "active schedule → nothing available",
    };
  }, [activeScheduleId, child.data?.playlist, defaultQ.data?.playlist]);

  /* ── Prefetch نافذة مبكّرة من القرار الحالي ─────────────── */
  useEffect(() => {
    if (!hasSlides(decision.playlist)) return;
    const cancel = prefetchWindow(decision.playlist.slides, 0, 2);
    return () => cancel();
  }, [decision.playlist]);

  /* ── Quiet refresh helper ────────────────────────────────── */
  const quietRefreshAll = async (overrideScheduleId?: number | string | null) => {
    const sid = overrideScheduleId ?? activeScheduleId ?? undefined;
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

  // isLoading ما لازم يطفي الشاشة إذا معنا Playlist جاهزة للعرض
  const anyLoading = parent.isLoading || child.isLoading || defaultQ.isLoading;
  const isLoadingSafe = anyLoading && !hasSlides(decision.playlist);

  return {
    parent,
    active,
    next,
    activeScheduleId,
    decision,
    isLoading: isLoadingSafe,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,
    activeEndDelayMs,
    nextStartDelayMs,
    upcomingPlaylist,
  };
}
