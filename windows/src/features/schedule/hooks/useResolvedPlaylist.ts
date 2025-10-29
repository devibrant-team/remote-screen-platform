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

export function useResolvedPlaylist(screenId?: string) {
  const qc = useQueryClient();
  const online = useOnline(); 
  const { parent, activeScheduleId, active, next } = useTimedSchedule(screenId);

  // Live queries
  const child = useChildPlaylist(activeScheduleId, screenId);

  // Only enable default if we might need it (prevents races)
  const wantDefault =
    !activeScheduleId ||
    child.isError ||
    !hasSlides(child.data?.playlist);

  const defaultQ = useDefaultPlaylist(screenId, wantDefault);

  // Persist last-good caches
  useEffect(() => {
    if (hasSlides(child.data?.playlist)) saveLastGoodChild(child.data!.playlist);
  }, [child.data?.playlist]);

  useEffect(() => {
    if (hasSlides(defaultQ.data?.playlist)) saveLastGoodDefault(defaultQ.data!.playlist);
  }, [defaultQ.data?.playlist]);

  // In gaps (no active schedule) proactively warm default
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

  // 🔔 When the active schedule changes, proactively prefetch its child playlist fresh
  useEffect(() => {
    if (!activeScheduleId) return;
    qc.prefetchQuery({
      queryKey: qk.child(activeScheduleId, screenId),
      queryFn: () => fetchChildPlaylist(activeScheduleId, screenId),
      staleTime: 0, // ensure immediate freshness at boundary
    }).catch(() => {});
  }, [activeScheduleId, screenId, qc]);

  // Decide what to show
  const decision: Decision = useMemo(() => {
    // 1) Child (fresh) wins
    if (hasSlides(child.data?.playlist)) {
      return { source: "child", playlist: child.data!.playlist, reason: "active child ok" };
    }

    // 2) Offline: if nothing running yet, prefer cached default/child
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
        // keep showing what is already running
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
  }, [child.data?.playlist, defaultQ.data?.playlist, online]);

  // Light prefetch for upcoming slides in whichever playlist we decided
  useEffect(() => {
    if (!hasSlides(decision.playlist)) return;
    const cancel = prefetchWindow(decision.playlist.slides, 0, 2);
    return () => cancel();
  }, [decision.playlist]);

  // Quiet refresh helper (parent + child + default)
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

  return {
    parent, active, next, activeScheduleId,
    decision,
    isLoading: parent.isLoading || child.isLoading || defaultQ.isLoading,
    isError: parent.isError && child.isError && defaultQ.isError,
    quietRefreshAll,
  };
}
