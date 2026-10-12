// src/utils/backgroundSyncSafety.ts
/**
 * Iguana Signage - Background Sync Safety Layer (Android React Native)
 *
 * Lightweight, non-blocking background safety layer triggered by relevant
 * incoming Laravel Reverb events.
 *
 * This is an additional safety mechanism, NOT a replacement for the primary
 * synchronization system (useServerClockStrict + Global Timeline + Video Drift Correction).
 *
 * Architectural Guarantees:
 * 1. Inspects clock status, nowEpochMs, lastSyncAt, uncertaintyMs.
 * 2. If healthy, performs NO network requests (skippedHealthy++).
 * 3. If stale, uncertain, RESTORED, or UNTRUSTED, requests a non-blocking resync.
 * 4. Never pauses playback, resets playlist, remounts video players, or seeks directly.
 * 5. Uses a single in-flight synchronization promise and bounded cooldown.
 * 6. Preserves existing event actions (pairing, schedule updates, screen configs).
 * 7. Does not call React Hooks inside event callbacks.
 * 8. Preserves working clock state if resync fails.
 * 9. Tracks lightweight diagnostic counters.
 */

import {
  serverClockService,
  type ServerClockService,
} from "./useServerClockStrict";

export interface BackgroundSyncDiagnostics {
  eventChecks: number;
  skippedHealthy: number;
  resyncRequested: number;
  resyncSucceeded: number;
  resyncFailed: number;
  cooldownSkipped: number;
  lastEventName: string | null;
  lastCheckTimestamp: number | null;
  lastResyncTimestamp: number | null;
}

export interface BackgroundSyncSafetyConfig {
  /** Maximum uncertainty in ms to consider clock healthy (default: 1500ms) */
  maxHealthyUncertaintyMs: number;
  /** Maximum elapsed time since last sync in ms to consider clock healthy (default: 10 minutes) */
  maxHealthyAgeMs: number;
  /** Minimum interval in ms between background resync requests (default: 15,000ms) */
  cooldownMs: number;
}

export const DEFAULT_BACKGROUND_SYNC_CONFIG: BackgroundSyncSafetyConfig = {
  maxHealthyUncertaintyMs: 1500,
  maxHealthyAgeMs: 10 * 60 * 1000, // 10 minutes
  cooldownMs: 15_000, // 15 seconds
};

const diagnostics: BackgroundSyncDiagnostics = {
  eventChecks: 0,
  skippedHealthy: 0,
  resyncRequested: 0,
  resyncSucceeded: 0,
  resyncFailed: 0,
  cooldownSkipped: 0,
  lastEventName: null,
  lastCheckTimestamp: null,
  lastResyncTimestamp: null,
};

let lastResyncRequestedAt = 0;

/**
 * Validates whether the clock is currently healthy.
 * A clock is healthy ONLY if:
 * 1. Status is "SYNCED" (RESTORED, HOLDOVER, or UNTRUSTED are not live-healthy).
 * 2. nowEpochMs() is finite and valid.
 * 3. lastSyncAt() is valid and within maxHealthyAgeMs (not stale).
 * 4. uncertaintyMs() is <= maxHealthyUncertaintyMs (not uncertain).
 */
export function isClockHealthy(
  service: Pick<
    ServerClockService,
    "clockStatus" | "nowEpochMs" | "lastSyncAt" | "uncertaintyMs"
  >,
  config: BackgroundSyncSafetyConfig = DEFAULT_BACKGROUND_SYNC_CONFIG,
  nowMs: number = Date.now()
): boolean {
  const status = service.clockStatus();
  if (status !== "SYNCED") {
    return false;
  }

  const nowEpoch = service.nowEpochMs();
  if (nowEpoch == null || !Number.isFinite(nowEpoch)) {
    return false;
  }

  const lastSync = service.lastSyncAt();
  if (lastSync == null || !Number.isFinite(lastSync)) {
    return false;
  }

  const ageMs = nowMs - lastSync;
  if (ageMs < 0 || ageMs > config.maxHealthyAgeMs) {
    return false;
  }

  const uncertainty = service.uncertaintyMs();
  if (!Number.isFinite(uncertainty) || uncertainty > config.maxHealthyUncertaintyMs) {
    return false;
  }

  return true;
}

/**
 * Non-blocking event listener safety check.
 * Triggered on incoming Reverb events to inspect clock health and schedule
 * a background resync if needed without interrupting active media playback.
 */
export async function handleReverbEventSafetyCheck(
  eventName: string,
  service: ServerClockService = serverClockService,
  config: BackgroundSyncSafetyConfig = DEFAULT_BACKGROUND_SYNC_CONFIG
): Promise<boolean> {
  diagnostics.eventChecks += 1;
  diagnostics.lastEventName = eventName;
  const now = Date.now();
  diagnostics.lastCheckTimestamp = now;

  // 1. Inspect existing clock state
  const healthy = isClockHealthy(service, config, now);

  // 2. If clock is healthy, perform NO network request
  if (healthy) {
    diagnostics.skippedHealthy += 1;
    return false;
  }

  // 3. Cooldown check: prevent bursting network requests
  if (now - lastResyncRequestedAt < config.cooldownMs) {
    diagnostics.cooldownSkipped += 1;
    return false;
  }

  // 4. Update cooldown timestamp and request non-blocking resync
  lastResyncRequestedAt = now;
  diagnostics.resyncRequested += 1;
  diagnostics.lastResyncTimestamp = now;

  try {
    const success = await service.requestResync(`REVERB_${eventName}`);
    if (success) {
      diagnostics.resyncSucceeded += 1;
    } else {
      diagnostics.resyncFailed += 1;
    }
    return success;
  } catch (err) {
    diagnostics.resyncFailed += 1;
    return false;
  }
}

/**
 * Returns current snapshot of background sync safety diagnostic counters.
 */
export function getBackgroundSyncDiagnostics(): Readonly<BackgroundSyncDiagnostics> {
  return { ...diagnostics };
}

/**
 * Resets all diagnostic counters and cooldown timestamps (useful for tests or diagnostics reset).
 */
export function resetBackgroundSyncDiagnostics(): void {
  diagnostics.eventChecks = 0;
  diagnostics.skippedHealthy = 0;
  diagnostics.resyncRequested = 0;
  diagnostics.resyncSucceeded = 0;
  diagnostics.resyncFailed = 0;
  diagnostics.cooldownSkipped = 0;
  diagnostics.lastEventName = null;
  diagnostics.lastCheckTimestamp = null;
  diagnostics.lastResyncTimestamp = null;
  lastResyncRequestedAt = 0;
}
