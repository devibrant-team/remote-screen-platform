// src/utils/useServerClockStrict.ts
/**
 * Iguana Signage - Unified Deterministic Server Clock Engine (Windows Electron)
 *
 * Implements strict offline clock recovery, RTC plausibility validation,
 * monotonic holdover, drift correction, and platform lifecycle handling.
 */

import { useEffect, useMemo, useState } from "react";
import { TimeClockApi } from "../Api/Api";
import {
  getAuthToken,
  loadDeviceStateSync,
  getClockCalibration,
  saveClockCalibration,
} from "./deviceState";
import { showServerToast } from "./serverClockToast";
import {
  type ClockStatus,
  type ClockCalibration,
  CALIBRATION_SCHEMA_VERSION,
  SERVER_CONTRACT_VERSION,
  DEFAULT_DRIFT_THRESHOLD_SEC,
  MAX_RTT_MS_FOR_TRUST,
  MAX_DELAY_MS_FOR_TRUST,
  MAX_UNCERTAINTY_MS,
  MONOTONIC_DRIFT_PPM,
  evaluateRtcPlausibility,
  calculateHoldoverUncertainty,
  epochMsToDaySecs,
  epochMsToDateStr,
  clampDay,
  toSecs,
  circularDiff,
} from "./clockEngine";

export type { ClockStatus, ClockCalibration };

type ServerReply = {
  success?: boolean;
  server_time?: string;
  server_date?: string;
  server_epoch_ms?: number;
  server_rx_epoch_ms?: number;
  server_tx_epoch_ms?: number;
  timezone?: string;
};

type Sample = {
  tz: string | null;
  offsetSec: number;
  rttMs: number;
  delayMs: number;
  serverSec: number;
  perfRef: number;
  perfRefDaySec: number;
  t3_epoch: number;
  epochOffsetMs: number;
  anchorServerEpochMs: number;
  quality: "trusted" | "degraded";
  trusted: boolean;
  server_epoch_ms?: number;
};

type InternalClockState = {
  status: ClockStatus;
  tz: string | null;
  offsetSec: number;
  anchorPerf: number;
  anchorServerEpochMs: number;
  anchorServerSec: number;
  lastDriftSec: number;
  lastRttMs: number;
  lastSyncEpoch: number | null;
  syncCount: number;
  epochOffsetMs: number;
  baseUncertaintyMs: number;
};

// Resync interval once clock is synchronized
const resyncEveryMs = 10 * 60 * 1000; // 10 minutes

let engineState: InternalClockState | null = null;
let engineStarted = false;
let engineStartPending = false;
const subscribers = new Set<() => void>();

let engineStartEpoch: number | null = null;
let noServerTimeAlertShown = false;
let serverReadyAlertShown = false;
let activeSyncPromise: Promise<boolean> | null = null;

// Suspend/resume drift tracking
let lastTickPerf = performance.now();
let lastTickDate = Date.now();

function notifySubscribers() {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore subscriber error
    }
  });
}

function computeCurrentUncertainty(st: InternalClockState): number {
  if (st.status === "UNTRUSTED") return Number.POSITIVE_INFINITY;
  const elapsedPerfMs = Math.max(0, performance.now() - st.anchorPerf);

  if (st.status === "SYNCED") {
    // Recent live sync: base uncertainty plus slight monotonic drift
    return calculateHoldoverUncertainty(st.baseUncertaintyMs, elapsedPerfMs, MONOTONIC_DRIFT_PPM);
  }

  if (st.status === "HOLDOVER") {
    // Network loss during runtime: monotonic quartz drift
    const uncertainty = calculateHoldoverUncertainty(st.baseUncertaintyMs, elapsedPerfMs, MONOTONIC_DRIFT_PPM);
    if (uncertainty > MAX_UNCERTAINTY_MS) {
      st.status = "UNTRUSTED";
    }
    return uncertainty;
  }

  if (st.status === "RESTORED") {
    // Offline reboot: base uncertainty from RTC evaluation plus monotonic progression
    const uncertainty = calculateHoldoverUncertainty(st.baseUncertaintyMs, elapsedPerfMs, MONOTONIC_DRIFT_PPM);
    if (uncertainty > MAX_UNCERTAINTY_MS) {
      st.status = "UNTRUSTED";
    }
    return uncertainty;
  }

  return Number.POSITIVE_INFINITY;
}

function ensureServerOrAlert() {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (!engineStartEpoch) return;
  if (now - engineStartEpoch < 30_000) return;

  if ((!engineState || engineState.status === "UNTRUSTED") && !noServerTimeAlertShown) {
    const { linked } = loadDeviceStateSync();
    if (!linked) return;

    noServerTimeAlertShown = true;
    showServerToast(
      "⚠️ Server time has not been received yet. The schedule cannot run without accurate server time.",
      "error"
    );
  }
}

/**
 * Recovers persisted calibration from persistent storage and validates device RTC.
 */
async function attemptOfflineRestoration(): Promise<boolean> {
  try {
    const cal = await getClockCalibration();
    if (!cal) {
      console.log("[clock] No persisted calibration available on startup");
      return false;
    }

    const currentDeviceEpochMs = Date.now();
    const result = evaluateRtcPlausibility(cal, currentDeviceEpochMs);

    if (!result.plausible || result.estimatedServerEpochMs == null) {
      console.warn("[clock] Persisted calibration failed RTC plausibility check:", result.reason);
      return false;
    }

    const perfNow = performance.now();
    const estimatedServerEpochMs = result.estimatedServerEpochMs;
    const tz = cal.timezone;
    const serverSec = epochMsToDaySecs(estimatedServerEpochMs, tz);
    const perfRefDaySec = clampDay(perfNow / 1000);
    const offsetSec = serverSec - perfRefDaySec;

    engineState = {
      status: "RESTORED",
      tz,
      offsetSec,
      anchorPerf: perfNow,
      anchorServerEpochMs: estimatedServerEpochMs,
      anchorServerSec: serverSec,
      lastDriftSec: 0,
      lastRttMs: 0,
      lastSyncEpoch: cal.syncTimestampMs,
      syncCount: 0, // 0 indicates restored from cache, not fresh live sync
      epochOffsetMs: cal.offsetMs,
      baseUncertaintyMs: result.uncertaintyMs,
    };

    console.log("[clock] Offline clock successfully RESTORED from calibration", {
      estimatedServerEpochMs: new Date(estimatedServerEpochMs).toISOString(),
      uncertaintyMs: result.uncertaintyMs,
      timezone: tz,
    });

    notifySubscribers();
    return true;
  } catch (err) {
    console.error("[clock] Error restoring offline calibration:", err);
    return false;
  }
}

/**
 * Takes one NTP-style sample from the server with sub-millisecond precision.
 */
async function takeOneSampleNtp(): Promise<Sample | null> {
  try {
    const token = (await getAuthToken()) ?? "";
    if (!token) return null;

    const t0_perf = performance.now();
    const t0_epoch = Date.now();

    const resp = await fetch(TimeClockApi(), {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const t3_perf = performance.now();
    const t3_epoch = Date.now();

    if (!resp.ok) return null;

    let json: ServerReply;
    try {
      json = (await resp.json()) as ServerReply;
    } catch {
      return null;
    }

    if (json.success === false) return null;

    const tz =
      json.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

    let t1 = json.server_rx_epoch_ms;
    let t2 = json.server_tx_epoch_ms;

    const usedEpochFallback =
      t1 == null && t2 == null && json.server_epoch_ms != null;

    if (usedEpochFallback) {
      t1 = json.server_epoch_ms;
      t2 = json.server_epoch_ms;
    }

    if (t1 == null || t2 == null) return null;

    const delayMs = t3_epoch - t0_epoch - (t2 - t1);
    const offsetMs = (t1 - t0_epoch + (t2 - t3_epoch)) / 2;
    const rttMs = t3_perf - t0_perf;

    if (delayMs < 0 || delayMs > MAX_DELAY_MS_FOR_TRUST) return null;

    const highRtt = rttMs > MAX_RTT_MS_FOR_TRUST;
    const degraded = usedEpochFallback && highRtt;
    if (highRtt && !degraded) return null;

    const serverAtT3_epoch = t3_epoch + offsetMs;

    // Reject obviously implausible server epochs (e.g. year prior to 2024)
    if (serverAtT3_epoch < new Date("2024-01-01T00:00:00Z").getTime()) {
      console.warn("[clock] Rejected server sample with implausible epoch:", serverAtT3_epoch);
      return null;
    }

    const serverSec = clampDay(epochMsToDaySecs(serverAtT3_epoch, tz));
    const perfRefDaySec = clampDay(t3_perf / 1000);
    const offsetSec = serverSec - perfRefDaySec;

    return {
      tz,
      offsetSec,
      rttMs,
      delayMs,
      serverSec,
      perfRef: t3_perf,
      perfRefDaySec,
      t3_epoch,
      epochOffsetMs: offsetMs,
      anchorServerEpochMs: serverAtT3_epoch,
      quality: degraded ? "degraded" : "trusted",
      trusted: !degraded,
      server_epoch_ms: json.server_epoch_ms,
    };
  } catch {
    return null;
  }
}

async function bestOfNSamples(n: number): Promise<Sample | null> {
  const results: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const s = await takeOneSampleNtp();
    if (s) results.push(s);
  }
  if (!results.length) return null;
  results.sort((a, b) => a.rttMs - b.rttMs);
  return results[0];
}

async function singleSync(): Promise<boolean> {
  const sample = await bestOfNSamples(3);

  if (!sample) {
    // Network unavailable or server down: transition to HOLDOVER if previously SYNCED
    if (engineState && engineState.status === "SYNCED") {
      console.log("[clock] Server unreachable; entering HOLDOVER mode");
      engineState.status = "HOLDOVER";
    }
    notifySubscribers();
    return false;
  }

  const prev = engineState;
  const wasReady = !!prev && (prev.status === "SYNCED" || prev.status === "RESTORED");

  // Calculate jump and drift against currently running clock
  let lastDriftSec = 0;
  let largeJumpDetected = false;

  if (prev && prev.anchorServerEpochMs) {
    const currentRunningEpochMs =
      prev.anchorServerEpochMs + (sample.perfRef - prev.anchorPerf);
    const jumpMs = sample.anchorServerEpochMs - currentRunningEpochMs;
    lastDriftSec = Math.abs(jumpMs) / 1000;

    if (Math.abs(jumpMs) > DEFAULT_DRIFT_THRESHOLD_SEC * 1000) {
      largeJumpDetected = true;
      console.log("[clock] Clock jump detected:", {
        jumpMs,
        prevEpoch: new Date(currentRunningEpochMs).toISOString(),
        sampleEpoch: new Date(sample.anchorServerEpochMs).toISOString(),
      });
    }
  }

  // If drift is small, preserve current monotonic anchor progression to avoid micro-stutters
  if (prev && !largeJumpDetected && lastDriftSec <= DEFAULT_DRIFT_THRESHOLD_SEC) {
    engineState = {
      ...prev,
      status: "SYNCED",
      tz: sample.tz,
      offsetSec: sample.offsetSec,
      lastDriftSec,
      lastRttMs: sample.rttMs,
      lastSyncEpoch: sample.t3_epoch,
      syncCount: prev.syncCount + 1,
      epochOffsetMs: sample.epochOffsetMs,
      baseUncertaintyMs: Math.round(sample.rttMs / 2),
    };
  } else {
    // Large jump or first sync: rebase to new sample
    engineState = {
      status: "SYNCED",
      tz: sample.tz,
      offsetSec: sample.offsetSec,
      anchorPerf: sample.perfRef,
      anchorServerEpochMs: sample.anchorServerEpochMs,
      anchorServerSec: sample.serverSec,
      lastDriftSec,
      lastRttMs: sample.rttMs,
      lastSyncEpoch: sample.t3_epoch,
      syncCount: (prev?.syncCount ?? 0) + 1,
      epochOffsetMs: sample.epochOffsetMs,
      baseUncertaintyMs: Math.round(sample.rttMs / 2),
    };
  }

  // Persist updated calibration atomically
  const cal: ClockCalibration = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    serverEpochMs: engineState.anchorServerEpochMs,
    deviceEpochMs: sample.t3_epoch,
    offsetMs: engineState.epochOffsetMs,
    syncTimestampMs: Date.now(),
    timezone: engineState.tz,
    serverContractVersion: SERVER_CONTRACT_VERSION,
    uncertaintyMs: engineState.baseUncertaintyMs,
  };

  void saveClockCalibration(cal).catch((err) => {
    console.warn("[clock] Failed to persist calibration:", err);
  });

  const isReadyNow = engineState.status === "SYNCED";

  if (!wasReady && isReadyNow && typeof window !== "undefined" && !serverReadyAlertShown) {
    serverReadyAlertShown = true;
    showServerToast(
      "✅ Server time received successfully. Schedules are now running with accurate timing.",
      "success"
    );
  }

  notifySubscribers();
  return true;
}

async function guardedSync(label?: string): Promise<boolean> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }
  activeSyncPromise = (async () => {
    try {
      return await singleSync();
    } finally {
      activeSyncPromise = null;
    }
  })();
  return activeSyncPromise;
}

/**
 * Handles system power resume / wake / sleep gap
 */
function handleSystemResume() {
  const nowPerf = performance.now();
  const nowDate = Date.now();

  const deltaPerf = nowPerf - lastTickPerf;
  const deltaDate = nowDate - lastTickDate;
  lastTickPerf = nowPerf;
  lastTickDate = nowDate;

  // Detect sleep/suspend: wall clock advanced much more than monotonic performance counter
  if (deltaDate - deltaPerf > 2000 && engineState) {
    console.log("[clock] Suspend/sleep detected. Adjusting clock anchors", {
      gapMs: deltaDate - deltaPerf,
    });

    if (engineState.status === "HOLDOVER" || engineState.status === "RESTORED") {
      // Re-anchor monotonic time to elapsed wall clock
      engineState.anchorServerEpochMs += (deltaDate - deltaPerf);
      engineState.anchorPerf = nowPerf;
      // Add sleep jitter to uncertainty
      engineState.baseUncertaintyMs += Math.round(((deltaDate - deltaPerf) * 50) / 1_000_000) + 500;
    }
  }

  // Revalidate with server immediately
  void guardedSync();
}

async function ensureEngineStarted() {
  if (engineStarted || engineStartPending) return;

  const { screenId, linked } = loadDeviceStateSync();
  if (!linked || !screenId) return;

  engineStartPending = true;
  let token: string | undefined;
  try {
    token = await getAuthToken();
  } catch (error) {
    console.error("Secure authentication token unavailable; server clock is paused", error);
  } finally {
    engineStartPending = false;
  }
  if (!token || engineStarted) return;

  engineStarted = true;
  engineStartEpoch = Date.now();
  lastTickPerf = performance.now();
  lastTickDate = Date.now();

  // Step 1: Attempt offline restoration immediately from persistent store
  await attemptOfflineRestoration();

  // Step 2: Attempt online synchronization
  void guardedSync();

  // Periodic heartbeat: check holdover expiration & trigger resync
  if (typeof window !== "undefined") {
    setInterval(() => {
      lastTickPerf = performance.now();
      lastTickDate = Date.now();

      if (!engineState || engineState.status === "UNTRUSTED") {
        ensureServerOrAlert();
        void guardedSync();
      }
    }, 30_000);

    setInterval(() => {
      if (engineState && (engineState.status === "SYNCED" || engineState.status === "HOLDOVER")) {
        void guardedSync();
      }
    }, resyncEveryMs);

    window.addEventListener("online", () => {
      console.log("[clock] Network online event fired");
      void guardedSync();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleSystemResume();
      }
    });

    // Electron power resume listener
    const api = window.signage;
    if (api?.onPowerResume) {
      api.onPowerResume(() => {
        console.log("[clock] Electron powerMonitor resume event received");
        handleSystemResume();
      });
    }
  }
}

/* ---------- Server Clock Service (Non-React API) ---------- */

export interface ServerClockService {
  clockStatus(): ClockStatus;
  canSchedule(): boolean;
  isReady(): boolean;
  nowEpochMs(): number | null;
  nowSecs(): number;
  serverDate(): string | null;
  uncertaintyMs(): number;
  lastSyncAt(): number | null;
  msUntil(hms?: string | null): number | undefined;
  driftSec(): number;
  timezone(): string | null;
  lastRttMs(): number;
  syncCount(): number;
  source(): "server" | "restored" | "holdover" | "none";
  requestResync(label?: string): Promise<boolean>;
  getSnapshot(): {
    status: ClockStatus;
    canSchedule: boolean;
    tz: string | null;
    serverDate: string | null;
    nowEpochMs: number | null;
    nowSecs: number;
    uncertaintyMs: number;
    lastSyncAt: number | null;
    lastDriftSec: number;
    lastRttMs: number;
    syncCount: number;
  };
}

export const serverClockService: ServerClockService = {
  clockStatus(): ClockStatus {
    const st = engineState;
    if (!st) return "UNTRUSTED";
    computeCurrentUncertainty(st);
    return st.status;
  },

  canSchedule(): boolean {
    const status = this.clockStatus();
    return status === "SYNCED" || status === "HOLDOVER" || status === "RESTORED";
  },

  isReady(): boolean {
    return this.canSchedule();
  },

  nowEpochMs(): number | null {
    const st = engineState;
    if (!st || !this.canSchedule()) {
      ensureServerOrAlert();
      return null;
    }

    const perfNow = performance.now();
    return Math.round(st.anchorServerEpochMs + (perfNow - st.anchorPerf));
  },

  nowSecs(): number {
    const st = engineState;

    if (st && this.canSchedule()) {
      const perfNow = performance.now();
      const perfNowDaySec = clampDay(perfNow / 1000);
      return clampDay(perfNowDaySec + st.offsetSec);
    }

    ensureServerOrAlert();
    const fallbackPerf = performance.now();
    return clampDay(fallbackPerf / 1000);
  },

  serverDate(): string | null {
    const epochMs = this.nowEpochMs();
    if (epochMs == null) return null;
    return epochMsToDateStr(epochMs, this.timezone());
  },

  uncertaintyMs(): number {
    const st = engineState;
    if (!st) return Number.POSITIVE_INFINITY;
    return computeCurrentUncertainty(st);
  },

  lastSyncAt(): number | null {
    return engineState?.lastSyncEpoch ?? null;
  },

  msUntil(hms?: string | null): number | undefined {
    if (!hms) return undefined;
    if (!this.canSchedule()) {
      ensureServerOrAlert();
      return undefined;
    }

    const target = clampDay(toSecs(hms));
    const now = this.nowSecs();
    let delta = target - now;
    if (delta < 0) delta = 0;
    return Math.floor(delta * 1000);
  },

  driftSec(): number {
    return engineState?.lastDriftSec ?? 0;
  },

  timezone(): string | null {
    return (
      engineState?.tz ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      null
    );
  },

  lastRttMs(): number {
    return engineState?.lastRttMs ?? 0;
  },

  syncCount(): number {
    return engineState?.syncCount ?? 0;
  },

  source(): "server" | "restored" | "holdover" | "none" {
    const status = this.clockStatus();
    switch (status) {
      case "SYNCED":
        return "server";
      case "HOLDOVER":
        return "holdover";
      case "RESTORED":
        return "restored";
      default:
        return "none";
    }
  },

  requestResync(label = "SAFETY_LAYER"): Promise<boolean> {
    void ensureEngineStarted();
    return guardedSync(label);
  },

  getSnapshot() {
    const st = engineState;
    const status = this.clockStatus();
    if (!st) {
      return {
        status: "UNTRUSTED",
        canSchedule: false,
        tz: null,
        serverDate: null,
        nowEpochMs: null,
        nowSecs: 0,
        uncertaintyMs: Number.POSITIVE_INFINITY,
        lastSyncAt: null,
        lastDriftSec: 0,
        lastRttMs: 0,
        syncCount: 0,
      };
    }
    const now = this.nowSecs();
    const epoch = this.nowEpochMs();
    return {
      status,
      canSchedule: this.canSchedule(),
      tz: st.tz,
      serverDate: this.serverDate(),
      nowEpochMs: epoch,
      nowSecs: now,
      uncertaintyMs: this.uncertaintyMs(),
      lastSyncAt: st.lastSyncEpoch,
      lastDriftSec: st.lastDriftSec,
      lastRttMs: st.lastRttMs,
      syncCount: st.syncCount,
    };
  },
};

/* ---------- React Hook ---------- */

export function useServerClockStrict() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    void ensureEngineStarted();

    const onLinked = () => void ensureEngineStarted();
    window.addEventListener("iguana:linked", onLinked);

    const cb = () => forceRender((x) => x + 1);
    subscribers.add(cb);

    return () => {
      window.removeEventListener("iguana:linked", onLinked);
      subscribers.delete(cb);
    };
  }, []);

  const api = useMemo(
    () => ({
      clockStatus: () => serverClockService.clockStatus(),
      canSchedule: () => serverClockService.canSchedule(),
      isReady: () => serverClockService.isReady(),
      nowEpochMs: () => serverClockService.nowEpochMs(),
      nowSecs: () => serverClockService.nowSecs(),
      serverDate: () => serverClockService.serverDate(),
      uncertaintyMs: () => serverClockService.uncertaintyMs(),
      lastSyncAt: () => serverClockService.lastSyncAt(),
      msUntil: (hms?: string | null) => serverClockService.msUntil(hms),
      driftSec: () => serverClockService.driftSec(),
      timezone: () => serverClockService.timezone(),
      lastRttMs: () => serverClockService.lastRttMs(),
      syncCount: () => serverClockService.syncCount(),
      source: () => serverClockService.source(),
      debugSnapshot: () => serverClockService.getSnapshot(),
    }),
    []
  );

  return api;
}
