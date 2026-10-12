// src/features/schedule/hooks/useSlideLogic.ts
import { useEffect, useMemo, useState } from "react";
import { useServerClockStrict } from "../../utils/useServerClockStrict";
import {
  positiveModulo,
  normalizeSlideDurationMs,
  resolveDeterministicPlaylistPhase,
} from "../../utils/playlistTimeline";

function toSecs(hms: string) {
  const [h = "0", m = "0", s = "0"] = String(hms).split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m) || 0));
  const ss = Math.max(0, Math.min(59, parseInt(s) || 0));
  return hh * 3600 + mm * 60 + ss;
}

type SlideLike = { duration: number; [k: string]: any };

export type SlideLogicState = {
  enabled: boolean;
  slideIndex: number;
  offsetInSlide: number;
  msUntilNextSlide: number | null;
};

function daysBetween(a: string, b: string) {
  const A = new Date(a + "T00:00:00Z").getTime();
  const B = new Date(b + "T00:00:00Z").getTime();
  return Math.round((B - A) / 86400000);
}

export function useSlideLogic(
  slides: SlideLike[],
  childStartTime?: string | null,
  scheduleStartDate?: string | null,
  serverDate?: string | null,
  playlistSyncAnchorMs?: number | null
): SlideLogicState {
  const clock = useServerClockStrict();

  const slideDurationsMs = useMemo(() => {
    return (slides ?? []).map((s) => normalizeSlideDurationMs(s.duration));
  }, [slides]);

  const totalDurationMs = useMemo(() => {
    return slideDurationsMs.reduce((sum, d) => sum + d, 0);
  }, [slideDurationsMs]);

  const isClockReady = clock.canSchedule() || clock.nowEpochMs() !== null;

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!slides.length || !totalDurationMs) return;

    // Fast heartbeat for offset tracking & video synchronization
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, 200);

    return () => window.clearInterval(id);
  }, [slides.length, totalDurationMs]);

  const state = useMemo<SlideLogicState>(() => {
    if (!slides.length || !totalDurationMs) {
      return {
        enabled: false,
        slideIndex: 0,
        offsetInSlide: 0,
        msUntilNextSlide: null,
      };
    }

    if (!isClockReady) {
      // Safe local continuity fallback when clock is UNTRUSTED (no cross-device sync claimed)
      const localElapsedMs = Math.round(performance.now());
      const phase = resolveDeterministicPlaylistPhase(slideDurationsMs, localElapsedMs);
      return {
        enabled: true,
        slideIndex: phase.slideIndex,
        offsetInSlide: phase.offsetInSlideSec,
        msUntilNextSlide: phase.msUntilNextSlide,
      };
    }

    // 🧷 Case 1: Scheduled Child Playlist (deterministic start from childStartTime)
    if (childStartTime) {
      const startSec = toSecs(childStartTime);
      const now = clock.nowSecs();
      const dayOffset =
        scheduleStartDate && serverDate
          ? daysBetween(scheduleStartDate, serverDate) * 86400
          : 0;
      let elapsedSec = dayOffset + now - startSec;
      if (elapsedSec < 0) elapsedSec = 0;

      const elapsedMs = Math.floor(elapsedSec * 1000);
      const phase = resolveDeterministicPlaylistPhase(slideDurationsMs, elapsedMs);

      return {
        enabled: true,
        slideIndex: phase.slideIndex,
        offsetInSlide: phase.offsetInSlideSec,
        msUntilNextSlide: phase.msUntilNextSlide,
      };
    }

    // 🎬 Case 2: Default Playlist (deterministic shared server epoch anchor)
    // Formula: elapsedMs = positiveModulo(serverNowEpochMs - sharedAnchorEpochMs, totalDurationMs)
    const serverNowEpochMs =
      clock.nowEpochMs() ?? Math.round(clock.nowSecs() * 1000);
    const sharedAnchorEpochMs =
      typeof playlistSyncAnchorMs === "number" && Number.isFinite(playlistSyncAnchorMs)
        ? playlistSyncAnchorMs
        : 0;

    const elapsedMs = positiveModulo(
      serverNowEpochMs - sharedAnchorEpochMs,
      totalDurationMs
    );

    const phase = resolveDeterministicPlaylistPhase(slideDurationsMs, elapsedMs);

    return {
      enabled: true,
      slideIndex: phase.slideIndex,
      offsetInSlide: phase.offsetInSlideSec,
      msUntilNextSlide: phase.msUntilNextSlide,
    };
  }, [
    slides,
    slideDurationsMs,
    totalDurationMs,
    isClockReady,
    childStartTime,
    scheduleStartDate,
    serverDate,
    playlistSyncAnchorMs,
    clock,
    tick,
  ]);

  // Exact slide boundary wake-up timer
  useEffect(() => {
    if (!state.enabled || state.msUntilNextSlide == null || state.msUntilNextSlide <= 0)
      return;

    const timerId = window.setTimeout(() => {
      setTick((t) => t + 1);
    }, Math.min(state.msUntilNextSlide, 86400000));

    return () => window.clearTimeout(timerId);
  }, [state.enabled, state.slideIndex, state.msUntilNextSlide]);

  return state;
}
