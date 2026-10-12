// src/utils/clockEngine.ts
/**
 * Iguana Signage - Unified Deterministic Clock Engine & Offline Calibration
 *
 * Provides shared clock state management, RTC plausibility validation,
 * uncertainty propagation, and timezone-aware conversions across Windows and Android.
 */

export type ClockStatus = "SYNCED" | "HOLDOVER" | "RESTORED" | "UNTRUSTED";

export interface ClockCalibration {
  schemaVersion: number;
  serverEpochMs: number;
  deviceEpochMs: number;
  offsetMs: number;
  syncTimestampMs: number;
  timezone: string | null;
  serverContractVersion: string;
  uncertaintyMs: number;
}

export interface RtcPlausibilityResult {
  plausible: boolean;
  status: ClockStatus;
  reason?: string;
  estimatedServerEpochMs?: number;
  uncertaintyMs: number;
}

export const CALIBRATION_SCHEMA_VERSION = 1;
export const SERVER_CONTRACT_VERSION = "v1";

export const DEFAULT_DRIFT_THRESHOLD_SEC = 0.3; // 300ms drift deadband
export const MAX_RTT_MS_FOR_TRUST = 5000;
export const MAX_DELAY_MS_FOR_TRUST = 8000;
export const MAX_CALIBRATION_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days maximum holdover age
export const MAX_UNCERTAINTY_MS = 24 * 60 * 60 * 1000; // 24 hours max uncertainty
export const MONOTONIC_DRIFT_PPM = 20; // 20 ppm (~1.7s per day) for running process monotonic clock
export const RTC_DRIFT_PPM = 50; // 50 ppm (~4.3s per day) for offline hardware RTC
export const REBOOT_JITTER_MS = 500; // base uncertainty added after offline reboot
export const MIN_PLAUSIBLE_YEAR = 2024;
export const DAY_SEC = 86400;

export const clampDay = (s: number): number => ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;

export function toSecs(hms: string): number {
  const [h = "0", m = "0", sPart = "0"] = String(hms).trim().split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));

  let ss = parseFloat(sPart.replace(",", "."));
  if (Number.isNaN(ss) || ss < 0) ss = 0;
  if (ss > 59.999) ss = 59.999;

  return hh * 3600 + mm * 60 + ss;
}

export function circularDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > DAY_SEC / 2) d = DAY_SEC - d;
  return d;
}

/**
 * Validates a candidate persisted calibration object against the required schema.
 * Rejects corrupt, tampered, or mismatched payloads.
 */
export function validateCalibrationPayload(raw: unknown): ClockCalibration | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const c = raw as Record<string, unknown>;

  if (c.schemaVersion !== CALIBRATION_SCHEMA_VERSION) {
    return null;
  }

  const {
    serverEpochMs,
    deviceEpochMs,
    offsetMs,
    syncTimestampMs,
    timezone,
    serverContractVersion,
    uncertaintyMs,
  } = c;

  if (
    typeof serverEpochMs !== "number" ||
    !Number.isFinite(serverEpochMs) ||
    typeof deviceEpochMs !== "number" ||
    !Number.isFinite(deviceEpochMs) ||
    typeof offsetMs !== "number" ||
    !Number.isFinite(offsetMs) ||
    typeof syncTimestampMs !== "number" ||
    !Number.isFinite(syncTimestampMs) ||
    typeof uncertaintyMs !== "number" ||
    !Number.isFinite(uncertaintyMs)
  ) {
    return null;
  }

  // Plausible year sanity check (must not be pre-2024 or negative)
  const minEpochMs = new Date(`${MIN_PLAUSIBLE_YEAR}-01-01T00:00:00Z`).getTime();
  if (serverEpochMs < minEpochMs || deviceEpochMs < minEpochMs) {
    return null;
  }

  // Offset integrity check: serverEpoch - deviceEpoch must match offsetMs (within 5ms rounding)
  if (Math.abs(serverEpochMs - deviceEpochMs - offsetMs) > 5) {
    return null;
  }

  if (uncertaintyMs < 0) {
    return null;
  }

  const tz =
    typeof timezone === "string" && timezone.trim().length > 0
      ? timezone.trim()
      : null;

  const version =
    typeof serverContractVersion === "string" && serverContractVersion.trim().length > 0
      ? serverContractVersion.trim()
      : SERVER_CONTRACT_VERSION;

  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    serverEpochMs: Math.round(serverEpochMs),
    deviceEpochMs: Math.round(deviceEpochMs),
    offsetMs: Math.round(offsetMs),
    syncTimestampMs: Math.round(syncTimestampMs),
    timezone: tz,
    serverContractVersion: version,
    uncertaintyMs: Math.round(uncertaintyMs),
  };
}

/**
 * Evaluates whether the device RTC after boot is plausible compared to
 * the persisted calibration data.
 */
export function evaluateRtcPlausibility(
  cal: ClockCalibration,
  currentDeviceEpochMs: number,
  options?: {
    maxAgeMs?: number;
    maxUncertaintyMs?: number;
    minYear?: number;
    rtcDriftPpm?: number;
    rebootJitterMs?: number;
  }
): RtcPlausibilityResult {
  const maxAgeMs = options?.maxAgeMs ?? MAX_CALIBRATION_AGE_MS;
  const maxUncertaintyMs = options?.maxUncertaintyMs ?? MAX_UNCERTAINTY_MS;
  const minYear = options?.minYear ?? MIN_PLAUSIBLE_YEAR;
  const rtcDriftPpm = options?.rtcDriftPpm ?? RTC_DRIFT_PPM;
  const rebootJitterMs = options?.rebootJitterMs ?? REBOOT_JITTER_MS;

  // 1. Year plausibility check (detects 1970/1980 unbacked RTC hardware defaults)
  const deviceYear = new Date(currentDeviceEpochMs).getFullYear();
  if (deviceYear < minYear) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Device RTC year (${deviceYear}) is earlier than minimum plausible year (${minYear})`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

  // 2. Time-reversal check (device clock jumped backwards past sync point)
  // Allow a small 60-second grace window for startup clock step adjustments
  const elapsedDeviceMs = currentDeviceEpochMs - cal.deviceEpochMs;
  if (elapsedDeviceMs < -60_000) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Device RTC jumped backwards by ${Math.abs(elapsedDeviceMs)}ms before last sync`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

  // 3. Maximum holdover duration check
  if (elapsedDeviceMs > maxAgeMs) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Offline duration (${Math.round(elapsedDeviceMs / (1000 * 3600))} hours) exceeds maximum policy (${Math.round(maxAgeMs / (1000 * 3600))} hours)`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

  // 4. Uncertainty calculation
  const safeElapsedMs = Math.max(0, elapsedDeviceMs);
  const rtcDriftGrowthMs = Math.round((safeElapsedMs * rtcDriftPpm) / 1_000_000);
  const estimatedUncertaintyMs =
    cal.uncertaintyMs + rtcDriftGrowthMs + rebootJitterMs;

  if (estimatedUncertaintyMs > maxUncertaintyMs) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Estimated clock uncertainty (${estimatedUncertaintyMs}ms) exceeds maximum allowable threshold (${maxUncertaintyMs}ms)`,
      uncertaintyMs: estimatedUncertaintyMs,
    };
  }

  // Plausible: return estimated server epoch from device wall clock + offset
  const estimatedServerEpochMs = Math.round(currentDeviceEpochMs + cal.offsetMs);

  return {
    plausible: true,
    status: "RESTORED",
    estimatedServerEpochMs,
    uncertaintyMs: estimatedUncertaintyMs,
  };
}

/**
 * Calculates current uncertainty during runtime holdover using process monotonic clock.
 */
export function calculateHoldoverUncertainty(
  initialUncertaintyMs: number,
  elapsedMonotonicMs: number,
  driftPpm: number = MONOTONIC_DRIFT_PPM
): number {
  const safeElapsedMs = Math.max(0, elapsedMonotonicMs);
  const driftGrowthMs = Math.round((safeElapsedMs * driftPpm) / 1_000_000);
  return initialUncertaintyMs + driftGrowthMs;
}

/**
 * Converts an epoch timestamp in milliseconds to fractional seconds of the day (0..86399.999)
 * within the specified timezone.
 */
export function epochMsToDaySecs(epochMs: number, tz?: string | null): number {
  const d = new Date(epochMs);
  const fracSec = (((epochMs % 1000) + 1000) % 1000) / 1000;

  if (tz) {
    try {
      const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const parts = fmt.formatToParts(d);
      let h = "0";
      let m = "0";
      let s = "0";
      for (const p of parts) {
        if (p.type === "hour") h = p.value;
        else if (p.type === "minute") m = p.value;
        else if (p.type === "second") s = p.value;
      }
      const base = toSecs(`${h}:${m}:${s}`);
      return clampDay(base + fracSec);
    } catch {
      // Fallback below
    }
  }

  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();
  const base = hh * 3600 + mm * 60 + ss + ms / 1000;
  return clampDay(base);
}

/**
 * Formats an epoch timestamp into a "YYYY-MM-DD" date string in the specified timezone.
 */
export function epochMsToDateStr(epochMs: number, tz?: string | null): string {
  const d = new Date(epochMs);

  if (tz) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return fmt.format(d); // "YYYY-MM-DD"
    } catch {
      // Fallback below
    }
  }

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
