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

type Decision =
  | { source: "child"; playlist: any; reason: string }
  | { source: "default"; playlist: any; reason: string }
  | { source: "cache"; playlist: any; reason: string }
  | { source: "empty"; playlist: null; reason: string };

const hasSlides = (pl?: any) => Array.isArray(pl?.slides) && pl.slides.length > 0;

/** يحوّل "HH:mm[:ss]" إلى توقيت اليوم بالملّي ثانية */
function todayTimeToMs(hms?: string | null): number | undefined {
  if (!hms) return undefined;
  const [hh, mm = "0", ss = "0"] = String(hms).split(":");
  const now = new Date();
  const dt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(hh) || 0,
    Number(mm) || 0,
    Number(ss) || 0,
    0
  );
  return dt.getTime();
}

/** يحسب وقت نهاية النافذة النشطة من كائن active */
function computeActiveEndAtMs(active: any | undefined): number | undefined {
  if (typeof active?.end_at_ms === "number") return active.end_at_ms;
  if (active?.end_time) return todayTimeToMs(active.end_time);
  return undefined;
}

/** يستخرج معلومات "التالي" من useTimedSchedule.next (إن وجدت) */
function getUpcomingFromNext(next: any | undefined) {
  const nextStartAt: number | undefined =
    typeof next?.start_at_ms === "number"
      ? next.start_at_ms
      : next?.startAtMs ?? todayTimeToMs(next?.start_time);

  const upcomingPlaylist = next?.playlist ?? next?.child ?? null;
  return { nextStartAt, upcomingPlaylist };
}

export function useResolvedPlaylist(screenId?: string) {
  const qc = useQueryClient();
  const online = useOnline();
  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);

  // Live queries
  const child = useChildPlaylist(activeScheduleId, screenId);

  // فعّل default فقط عند الحاجة
  const wantDefault =
    !activeScheduleId ||
    child.isError ||
    !hasSlides(child.data?.playlist);

  const defaultQ = useDefaultPlaylist(screenId, wantDefault);

  // حفظ آخر حالات سليمة
  useEffect(() => {
    if (hasSlides(child.data?.playlist)) saveLastGoodChild(child.data!.playlist);
  }, [child.data?.playlist]);

  useEffect(() => {
    if (hasSlides(defaultQ.data?.playlist)) saveLastGoodDefault(defaultQ.data!.playlist);
  }, [defaultQ.data?.playlist]);

  // في الفجوات (لا يوجد schedule) سخّن default مسبقًا
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

  // عند تغيّر الـactive schedule سخّن child الخاص به فورًا
  useEffect(() => {
    if (!activeScheduleId) return;
    qc.prefetchQuery({
      queryKey: qk.child(activeScheduleId, screenId),
      queryFn: () => fetchChildPlaylist(activeScheduleId, screenId),
      staleTime: 0,
    }).catch(() => {});
  }, [activeScheduleId, screenId, qc]);

  // --- قرار ما نعرض ---
  const decision: Decision = useMemo(() => {
    // ✅ أونلاين + لا يوجد activeSchedule → اعرض Default مباشرة إن وُجد
    if (online && !activeScheduleId) {
      if (hasSlides(defaultQ.data?.playlist)) {
        return { source: "default", playlist: defaultQ.data!.playlist, reason: "online + no schedule → default" };
      }
      const cachedDef = loadLastGoodDefault();
      if (hasSlides(cachedDef?.playlist)) {
        return { source: "cache", playlist: cachedDef!.playlist, reason: "online + no schedule → cached default" };
      }
      // نكمل بقية الفروع لو لم يتوفر أي شيء
    }

    // 1) Child (fresh) wins
    if (hasSlides(child.data?.playlist)) {
      return { source: "child", playlist: child.data!.playlist, reason: "active child ok" };
    }

    // 2) Offline
    if (!online) {
      const running = getNowPlaying();
      if (!hasSlides(running?.playlist)) {
        const cachedDef = loadLastGoodDefault();
        if (hasSlides(cachedDef?.playlist)) {
          return { source: "cache", playlist: cachedDef!.playlist, reason: "offline, cached default" };
        }
        const cachedChild = loadLastGoodChild();
        if (hasSlides(cachedChild?.playlist)) {
          return { source: "cache", playlist: cachedChild!.playlist, reason: "offline, cached child" };
        }
      } else {
        return { source: "cache", playlist: running!.playlist, reason: "offline, keep running" };
      }
    }

    // 3) Default (fresh)
    if (hasSlides(defaultQ.data?.playlist)) {
      return { source: "default", playlist: defaultQ.data!.playlist, reason: "default ok" };
    }

    // 4) Cached last-good (prefer child then default)
    const cachedChild = loadLastGoodChild();
    if (hasSlides(cachedChild?.playlist)) {
      return { source: "cache", playlist: cachedChild!.playlist, reason: "cached last child" };
    }
    const cachedDefault = loadLastGoodDefault();
    if (hasSlides(cachedDefault?.playlist)) {
      return { source: "cache", playlist: cachedDefault!.playlist, reason: "cached last default" };
    }

    // 5) Nothing
    return { source: "empty", playlist: null, reason: "no slides anywhere" };
  }, [online, activeScheduleId, child.data?.playlist, defaultQ.data?.playlist]);

  // Prefetch خفيف للأولى/النافذة القادمة
  useEffect(() => {
    if (!hasSlides(decision.playlist)) return;
    const cancel = prefetchWindow(decision.playlist.slides, 0, 2);
    return () => cancel();
  }, [decision.playlist]);

  // Quiet refresh helper
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

  // قيم صريحة للـUI
  const activeEndAtMs = computeActiveEndAtMs(active);
  const { nextStartAt, upcomingPlaylist } = getUpcomingFromNext(next);

  return {
    parent, active, next, activeScheduleId,
    decision,
    isLoading: parent.isLoading || child.isLoading || defaultQ.isLoading,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,

    // إضافات
    activeEndAtMs,
    nextStartAt,
    upcomingPlaylist,
  };
}
