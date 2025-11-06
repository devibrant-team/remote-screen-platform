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
import { useServerClockStrict } from "../../../utils/useServerClockStrict"; // ⏱️ مرجع الوقت الوحيد

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
  const clock = useServerClockStrict(); // ← المرجع الزمني الوحيد
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
    }

    // 1) Child (fresh)
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

    // 4) Cached last-good
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

  // ====== حسابات مبنية فقط على ساعة السيرفر الصارمة ======
  // نحسب "تأخير" حتى نهاية نافذة الـChild (ميلي ثانية)
  const activeEndDelayMs = useMemo(() => {
    const endTime = pickStr(active, "end_time"); // HH:mm:ss
    return endTime ? clock.msUntil(endTime) : undefined; // 0..N
  }, [active, clock]);

  // تأخير حتى بداية الـnext (إن وجد)
  const nextStartDelayMs = useMemo(() => {
    const startTime = pickStr(next, "start_time"); // HH:mm:ss
    return startTime ? clock.msUntil(startTime) : undefined;
  }, [next, clock]);

  // Playlist القادم إن وُجد (next.playlist أو next.child)
  const upcomingPlaylist = useMemo(() => {
    return pickFirstDefined<any>(next, ["playlist", "child"]) ?? null;
  }, [next]);

  return {
    parent, active, next, activeScheduleId,
    decision,
    isLoading: parent.isLoading || child.isLoading || defaultQ.isLoading,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,

    // إضافات صريحة للـUI (تأخيرات فقط، بلا Date.now)
    activeEndDelayMs,
    nextStartDelayMs,
    upcomingPlaylist,
  };
}
