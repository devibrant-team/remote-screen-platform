// src/utils/videoDriftPolicy.ts
import {
  positiveModulo,
  resolveDeterministicPlaylistPhase,
} from "./playlistTimeline";

export type DriftCorrectionAction =
  | { type: "in_sync"; targetRate: 1.0; driftMs: number }
  | { type: "rate_adjust"; targetRate: number; driftMs: number }
  | { type: "hard_seek"; targetTimeSec: number; driftMs: number }
  | { type: "cooldown"; driftMs: number }
  | { type: "skip"; reason: string };

export type DriftPolicyConfig = {
  deadbandMs: number;         // default: 120ms (below this, in sync)
  softMaxMs: number;          // default: 500ms (between deadband and softMax, adjust playbackRate)
  hardSeekCooldownMs: number; // default: 1800ms (minimum interval between hard seeks)
  rateSpeedUp: number;        // default: 1.08 (when video is lagging, speed up slightly)
  rateSlowDown: number;       // default: 0.92 (when video is leading, slow down slightly)
  minOffsetForCorrection: number; // default: 0.25s (skip during initial start window)
};

export const DEFAULT_DRIFT_POLICY: DriftPolicyConfig = {
  deadbandMs: 120,
  softMaxMs: 500,
  hardSeekCooldownMs: 1800,
  rateSpeedUp: 1.08,
  rateSlowDown: 0.92,
  minOffsetForCorrection: 0.25,
};

export type VideoSyncTelemetry = {
  platform: "windows" | "android";
  playlistId?: number | string | null;
  slideId?: number | string | null;
  expectedVideoTimeMs: number;
  actualVideoTimeMs: number;
  driftMs: number;
  correctionType: "in_sync" | "rate_adjust" | "hard_seek" | "cooldown" | "skip";
  playbackRate: number;
  buffering: boolean;
  lastHardSeekAt: number | null;
  updatedAt: number;
};

export type DriftEvaluationParams = {
  expectedTimeSec: number;
  actualTimeSec: number;
  videoDurationSec: number;
  isReady: boolean;
  isSeeking: boolean;
  isBuffering: boolean;
  isPaused: boolean;
  lastHardSeekMs: number;
  currentNowMs: number;
  config?: Partial<DriftPolicyConfig>;
};

/**
 * Pure, deterministic evaluation of video drift against global timeline.
 * 
 * driftMs = (expectedTimeSec - actualTimeSec) * 1000
 *   Positive driftMs: video is lagging behind expected timeline.
 *   Negative driftMs: video is leading ahead of expected timeline.
 */
export function evaluateDriftCorrection(params: DriftEvaluationParams): DriftCorrectionAction {
  const {
    expectedTimeSec,
    actualTimeSec,
    videoDurationSec,
    isReady,
    isSeeking,
    isBuffering,
    isPaused,
    lastHardSeekMs,
    currentNowMs,
    config: userConfig,
  } = params;

  const cfg: DriftPolicyConfig = { ...DEFAULT_DRIFT_POLICY, ...userConfig };

  if (!isReady) {
    return { type: "skip", reason: "media_not_ready" };
  }
  if (isSeeking) {
    return { type: "skip", reason: "seeking_in_progress" };
  }
  if (isBuffering) {
    return { type: "skip", reason: "buffering" };
  }
  if (isPaused) {
    return { type: "skip", reason: "paused" };
  }
  if (expectedTimeSec < cfg.minOffsetForCorrection) {
    return { type: "skip", reason: "start_boundary_window" };
  }
  if (videoDurationSec > 0 && expectedTimeSec > videoDurationSec - 0.25) {
    return { type: "skip", reason: "end_boundary_window" };
  }

  const driftMs = Math.round((expectedTimeSec - actualTimeSec) * 1000);
  const absDriftMs = Math.abs(driftMs);

  // 1. In sync (|drift| < 120ms): no correction, rate = 1.0
  if (absDriftMs < cfg.deadbandMs) {
    return { type: "in_sync", targetRate: 1.0, driftMs };
  }

  // 2. Gentle correction (120ms - 500ms): playback-rate adjustment
  if (absDriftMs <= cfg.softMaxMs) {
    // If lagging (driftMs > 0): speed up slightly (e.g. 1.08)
    // If leading (driftMs < 0): slow down slightly (e.g. 0.92)
    const targetRate = driftMs > 0 ? cfg.rateSpeedUp : cfg.rateSlowDown;
    return { type: "rate_adjust", targetRate, driftMs };
  }

  // 3. Hard seek (> 500ms): jump to expected position
  // Enforce cooldown to prevent repeated seeking loops
  if (currentNowMs - lastHardSeekMs < cfg.hardSeekCooldownMs) {
    return { type: "cooldown", driftMs };
  }

  const targetTimeSec = Math.max(
    0,
    Math.min(
      expectedTimeSec,
      videoDurationSec > 0 ? videoDurationSec - 0.2 : expectedTimeSec
    )
  );

  return { type: "hard_seek", targetTimeSec, driftMs };
}

/**
 * Calculates fresh expected slide index and intra-slide offset from the synchronized server timeline.
 */
export function calculateExpectedSlideOffsetSec(
  slides: { duration: number }[],
  clock: { nowEpochMs(): number | null; nowSecs(): number; isReady(): boolean },
  childStartTime?: string | null,
  scheduleStartDate?: string | null,
  serverDate?: string | null,
  playlistSyncAnchorMs?: number | null
): { expectedSlideIndex: number; expectedOffsetSec: number } | null {
  if (!slides || !slides.length) return null;

  const durationsMs = slides.map((s) => {
    const raw = typeof s.duration === "number" && Number.isFinite(s.duration) ? s.duration : 0;
    return Math.max(0, Math.round(raw * 1000));
  });
  const totalDurationMs = durationsMs.reduce((sum, d) => sum + d, 0);
  if (totalDurationMs <= 0) return null;

  const isClockReady = clock.isReady() || clock.nowEpochMs() !== null;
  if (!isClockReady) return null;

  if (childStartTime) {
    const [h = "0", m = "0", s = "0"] = String(childStartTime).split(":");
    const startSec = (+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0);
    const now = clock.nowSecs();

    let dayOffset = 0;
    if (scheduleStartDate && serverDate) {
      const A = new Date(scheduleStartDate + "T00:00:00Z").getTime();
      const B = new Date(serverDate + "T00:00:00Z").getTime();
      const days = Math.round((B - A) / 86400000);
      if (days > 0) dayOffset = days * 86400;
    }

    let elapsedSec = dayOffset + now - startSec;
    if (elapsedSec < 0) elapsedSec = 0;
    const elapsedMs = Math.floor(elapsedSec * 1000);

    const phase = resolveDeterministicPlaylistPhase(durationsMs, elapsedMs);
    return { expectedSlideIndex: phase.slideIndex, expectedOffsetSec: phase.offsetInSlideSec };
  } else {
    const serverNowEpochMs = clock.nowEpochMs() ?? Math.round(clock.nowSecs() * 1000);
    const anchorMs = typeof playlistSyncAnchorMs === "number" && Number.isFinite(playlistSyncAnchorMs)
      ? playlistSyncAnchorMs
      : 0;

    const elapsedMs = positiveModulo(serverNowEpochMs - anchorMs, totalDurationMs);
    const phase = resolveDeterministicPlaylistPhase(durationsMs, elapsedMs);
    return { expectedSlideIndex: phase.slideIndex, expectedOffsetSec: phase.offsetInSlideSec };
  }
}
