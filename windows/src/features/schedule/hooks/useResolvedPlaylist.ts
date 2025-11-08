// src/features/schedule/hooks/useResolvedPlaylist.ts
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimedSchedule } from "./useTimedSchedule";
import { useChildPlaylist, fetchChildPlaylist } from "../../../ReactQuery/schedule/useChildPlaylist";
import { useDefaultPlaylist, fetchDefaultPlaylist } from "../../../ReactQuery/schedule/useDefaultPlaylist";
import {
  saveLastGoodChild,
  saveLastGoodDefault,
  loadLastGoodChild,
  loadLastGoodDefault,
  getNowPlaying,
} from "../../../utils/playlistCache";
import { prefetchWindow } from "../../../utils/mediaPrefetcher";
import { useOnline } from "./useOnline";
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
  const online = useOnline();
  const clock = useServerClockStrict();
  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);

  /* ── Live queries ─────────────────────────────────────────── */
  const child = useChildPlaylist(activeScheduleId, screenId);

  // نفعل استعلام الـDefault فقط عند الحاجة (لا يوجد child صالح أو لا يوجد schedule)
  const wantDefault =
    !activeScheduleId ||
    child.isError ||
    !hasSlides(child.data?.playlist);

  const defaultQ = useDefaultPlaylist(screenId, wantDefault as any);

  /* ── Persist آخر نسخة ناجحة ──────────────────────────────── */
  useEffect(() => {
    if (hasSlides(child.data?.playlist)) saveLastGoodChild(child.data!.playlist);
  }, [child.data?.playlist]);

  useEffect(() => {
    if (hasSlides(defaultQ.data?.playlist)) saveLastGoodDefault(defaultQ.data!.playlist);
  }, [defaultQ.data?.playlist]);

  /* ── Prefetch default أثناء الفجوات ───────────────────────── */
  useEffect(() => {
    if (!screenId) return;
    if (!activeScheduleId) {
      qc.prefetchQuery({
        queryKey: qk.def(screenId),
        queryFn: () => fetchDefaultPlaylist(screenId),
        staleTime: 5 * 60_000,
      }).catch(() => {});
    }
  }, [screenId, activeScheduleId, qc]);

  /* ── Prefetch child عند تغيّر الـschedule الفعّال ─────────── */
  useEffect(() => {
    if (!activeScheduleId) return;
    qc.prefetchQuery({
      queryKey: qk.child(activeScheduleId, screenId),
      queryFn: () => fetchChildPlaylist(activeScheduleId, screenId),
      staleTime: 0,
    }).catch(() => {});
  }, [activeScheduleId, screenId, qc]);

  /* ── تأخيرات مبنية على ساعة السيرفر فقط ─────────────────── */
  const activeEndDelayMs = useMemo(() => {
    const endTime = pickStr(active, "end_time"); // HH:mm:ss
    return endTime ? clock.msUntil(endTime) : undefined; // قد تكون <= 0 عند الحافة
  }, [active, clock]);

  const nextStartDelayMs = useMemo(() => {
    const startTime = pickStr(next, "start_time"); // HH:mm:ss
    return startTime ? clock.msUntil(startTime) : undefined;
  }, [next, clock]);

  const upcomingPlaylist = useMemo(() => {
    return pickFirstDefined<any>(next, ["playlist", "child"]) ?? null;
  }, [next]);

  /* ── Decision (إذا ما في schedule → دائمًا Default) ───────── */
  const decision: Decision = useMemo(() => {
    const running = getNowPlaying();
    const runningIsChild = running?.source === "child";

    // <= 0 بدل === 0 لالتقاط اللحظة الحدّية
    const childExpiredOnline =
      online &&
      (activeScheduleId == null ||
        (typeof activeEndDelayMs === "number" && activeEndDelayMs <= 0));

    // (A) لا يوجد schedule حالياً → افضّل default مهما كانت حالة الشبكة
    if (!activeScheduleId) {
      // 1) أحدث Default من السيرفر لو متوفّر
      if (hasSlides(defaultQ.data?.playlist)) {
        return { source: "default", playlist: defaultQ.data!.playlist, reason: "no schedule → fresh default" };
      }
      // 2) الكاش المحلي للـDefault
      const cachedDef = loadLastGoodDefault();
      if (hasSlides(cachedDef?.playlist)) {
        return { source: "cache", playlist: cachedDef!.playlist, reason: "no schedule → cached default" };
      }
      // 3) لو الـrunning الحالي كان Default، خليه
      if (hasSlides(running?.playlist) && running?.source === "default") {
        return { source: "cache", playlist: running!.playlist, reason: "no schedule → keep running default" };
      }
      // 4) لا شيء متاح
      return { source: "empty", playlist: null, reason: "no schedule → no default available" };
    }

    // (B) يوجد schedule: لو الـchild متوفر من السيرفر خُذْه
    if (hasSlides(child.data?.playlist)) {
      return { source: "child", playlist: child.data!.playlist, reason: "active child ok" };
    }

    // (C) Offline: اعرض الكاش (Default أولاً ثم Child)
    if (!online) {
      const cachedDef = loadLastGoodDefault();
      if (hasSlides(cachedDef?.playlist)) {
        return { source: "cache", playlist: cachedDef!.playlist, reason: "offline, cached default" };
      }
      const cachedChild = loadLastGoodChild();
      if (hasSlides(cachedChild?.playlist)) {
        return { source: "cache", playlist: cachedChild!.playlist, reason: "offline, cached child" };
      }
    }

    // (D) Default من السيرفر لو موجود
    if (hasSlides(defaultQ.data?.playlist)) {
      return { source: "default", playlist: defaultQ.data!.playlist, reason: "default ok" };
    }

    // (E) Cached child/default (كآخر محاولة)
    const cachedChild = loadLastGoodChild();
    if (hasSlides(cachedChild?.playlist)) {
      return { source: "cache", playlist: cachedChild!.playlist, reason: "cached last child" };
    }
    const cachedDefault = loadLastGoodDefault();
    if (hasSlides(cachedDefault?.playlist)) {
      return { source: "cache", playlist: cachedDefault!.playlist, reason: "cached last default" };
    }

    // (F) لا شيء
    return { source: "empty", playlist: null, reason: "no slides anywhere" };
  }, [
    online,
    activeScheduleId,
    activeEndDelayMs,
    child.data?.playlist,
    defaultQ.data?.playlist,
  ]);

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
    if (childKey) await qc.invalidateQueries({ queryKey: childKey, refetchType: "active" });
    await qc.invalidateQueries({ queryKey: defaultKey, refetchType: "active" });

    await qc.refetchQueries({ queryKey: parentKey, type: "active" });
    if (childKey) await qc.refetchQueries({ queryKey: childKey, type: "active" });
    await qc.refetchQueries({ queryKey: defaultKey, type: "active" });
  };

  // isLoading ما لازم يطفي الشاشة إذا معنا Playlist جاهزة للعرض
  const anyLoading = parent.isLoading || child.isLoading || defaultQ.isLoading;
  const isLoadingSafe = anyLoading && !hasSlides(decision.playlist);

  return {
    parent, active, next, activeScheduleId,
    decision,
    isLoading: isLoadingSafe,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,
    activeEndDelayMs,
    nextStartDelayMs,
    upcomingPlaylist,
  };
}
