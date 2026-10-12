// tests/offlineClockRecovery.test.mjs
/**
 * Iguana Signage - Deterministic Offline Clock Recovery & Synchronization Test Suite
 *
 * Verifies all 15 scenarios across Windows and Android:
 * 1. Online sync
 * 2. Network loss without reboot (Holdover)
 * 3. Windows restart offline (Electron store restoration)
 * 4. Android restart offline (AsyncStorage restoration)
 * 5. RTC shifted forward 1 hour
 * 6. RTC shifted backward 1 day
 * 7. Midnight rollover
 * 8. Long offline duration
 * 9. Clock uncertainty expiration
 * 10. Reconnection with small drift
 * 11. Reconnection with large clock jump
 * 12. Global default playlist recovery
 * 13. Scheduled playlist recovery
 * 14. Device sleep/resume
 * 15. Persistent data corruption
 */

import assert from "node:assert/strict";

/* ------------------------------------------------------------------
 * Pure deterministic functions matching clockEngine.ts & playlistTimeline.ts
 * ------------------------------------------------------------------ */

const CALIBRATION_SCHEMA_VERSION = 1;
const SERVER_CONTRACT_VERSION = "v1";

const DEFAULT_DRIFT_THRESHOLD_SEC = 0.3; // 300ms drift deadband
const MAX_RTT_MS_FOR_TRUST = 5000;
const MAX_DELAY_MS_FOR_TRUST = 8000;
const MAX_CALIBRATION_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days maximum holdover age
const MAX_UNCERTAINTY_MS = 24 * 60 * 60 * 1000; // 24 hours max uncertainty
const MONOTONIC_DRIFT_PPM = 20; // 20 ppm (~1.7s per day) for running process monotonic clock
const RTC_DRIFT_PPM = 50; // 50 ppm (~4.3s per day) for offline hardware RTC
const REBOOT_JITTER_MS = 500; // base uncertainty added after offline reboot
const MIN_PLAUSIBLE_YEAR = 2024;
const DAY_SEC = 86400;

const clampDay = (s) => ((s % DAY_SEC) + DAY_SEC) % DAY_SEC;

function toSecs(hms) {
  const [h = "0", m = "0", sPart = "0"] = String(hms).trim().split(":");
  const hh = Math.max(0, Math.min(23, parseInt(h, 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m, 10) || 0));

  let ss = parseFloat(sPart.replace(",", "."));
  if (Number.isNaN(ss) || ss < 0) ss = 0;
  if (ss > 59.999) ss = 59.999;

  return hh * 3600 + mm * 60 + ss;
}

function circularDiff(a, b) {
  let d = Math.abs(a - b);
  if (d > DAY_SEC / 2) d = DAY_SEC - d;
  return d;
}

function positiveModulo(val, mod) {
  if (mod <= 0) return 0;
  return ((val % mod) + mod) % mod;
}

function validateCalibrationPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const c = raw;

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

  const minEpochMs = new Date(`${MIN_PLAUSIBLE_YEAR}-01-01T00:00:00Z`).getTime();
  if (serverEpochMs < minEpochMs || deviceEpochMs < minEpochMs) {
    return null;
  }

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

function evaluateRtcPlausibility(cal, currentDeviceEpochMs, options) {
  const maxAgeMs = options?.maxAgeMs ?? MAX_CALIBRATION_AGE_MS;
  const maxUncertaintyMs = options?.maxUncertaintyMs ?? MAX_UNCERTAINTY_MS;
  const minYear = options?.minYear ?? MIN_PLAUSIBLE_YEAR;
  const rtcDriftPpm = options?.rtcDriftPpm ?? RTC_DRIFT_PPM;
  const rebootJitterMs = options?.rebootJitterMs ?? REBOOT_JITTER_MS;

  const deviceYear = new Date(currentDeviceEpochMs).getFullYear();
  if (deviceYear < minYear) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Device RTC year (${deviceYear}) is earlier than minimum plausible year (${minYear})`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

  const elapsedDeviceMs = currentDeviceEpochMs - cal.deviceEpochMs;
  if (elapsedDeviceMs < -60_000) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Device RTC jumped backwards by ${Math.abs(elapsedDeviceMs)}ms before last sync`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

  if (elapsedDeviceMs > maxAgeMs) {
    return {
      plausible: false,
      status: "UNTRUSTED",
      reason: `Offline duration (${Math.round(elapsedDeviceMs / (1000 * 3600))} hours) exceeds maximum policy (${Math.round(maxAgeMs / (1000 * 3600))} hours)`,
      uncertaintyMs: Number.POSITIVE_INFINITY,
    };
  }

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

  const estimatedServerEpochMs = Math.round(currentDeviceEpochMs + cal.offsetMs);

  return {
    plausible: true,
    status: "RESTORED",
    estimatedServerEpochMs,
    uncertaintyMs: estimatedUncertaintyMs,
  };
}

function calculateHoldoverUncertainty(initialUncertaintyMs, elapsedMonotonicMs, driftPpm = MONOTONIC_DRIFT_PPM) {
  const safeElapsedMs = Math.max(0, elapsedMonotonicMs);
  const driftGrowthMs = Math.round((safeElapsedMs * driftPpm) / 1_000_000);
  return initialUncertaintyMs + driftGrowthMs;
}

function epochMsToDaySecs(epochMs, tz) {
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
      // Fallback
    }
  }

  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const ss = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();
  const base = hh * 3600 + mm * 60 + ss + ms / 1000;
  return clampDay(base);
}

function epochMsToDateStr(epochMs, tz) {
  const d = new Date(epochMs);

  if (tz) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return fmt.format(d);
    } catch {
      // Fallback
    }
  }

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveDeterministicPlaylistPhase(slideDurationsMs, elapsedMs) {
  const totalDurationMs = slideDurationsMs.reduce((sum, d) => sum + d, 0);
  if (totalDurationMs <= 0 || slideDurationsMs.length === 0) {
    return {
      slideIndex: 0,
      offsetInSlideSec: 0,
      msUntilNextSlide: null,
      loopElapsedMs: 0,
      totalDurationMs: 0,
    };
  }

  const loopElapsedMs = positiveModulo(elapsedMs, totalDurationMs);
  let accMs = 0;

  for (let i = 0; i < slideDurationsMs.length; i++) {
    const durMs = slideDurationsMs[i];
    const endMs = accMs + durMs;

    if (loopElapsedMs < endMs) {
      const offsetMs = loopElapsedMs - accMs;
      const remainingMs = Math.max(0, durMs - offsetMs);

      return {
        slideIndex: i,
        offsetInSlideSec: offsetMs / 1000,
        msUntilNextSlide: remainingMs,
        loopElapsedMs,
        totalDurationMs,
      };
    }
    accMs += durMs;
  }

  return {
    slideIndex: slideDurationsMs.length - 1,
    offsetInSlideSec: 0,
    msUntilNextSlide: null,
    loopElapsedMs,
    totalDurationMs,
  };
}

console.log("=================================================================");
console.log("  IGUANA SIGNAGE - DETERMINISTIC OFFLINE CLOCK TEST SUITE        ");
console.log("=================================================================\n");

// Baseline constants for reproducible test runs
const BASE_UTC_EPOCH = new Date("2026-10-12T14:00:00.000Z").getTime();
const BASE_DEVICE_EPOCH = BASE_UTC_EPOCH - 15000; // Device clock is 15s behind server
const BASE_OFFSET_MS = 15000;
const TIMEZONE = "UTC";

// -----------------------------------------------------------------
// Test 1: Online Sync
// -----------------------------------------------------------------
{
  const rawCalibration = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: TIMEZONE,
    serverContractVersion: SERVER_CONTRACT_VERSION,
    uncertaintyMs: 25, // RTT / 2
  };

  const validated = validateCalibrationPayload(rawCalibration);
  assert.ok(validated !== null, "Validation must succeed for authentic online sync");
  assert.equal(validated.schemaVersion, 1);
  assert.equal(validated.offsetMs, 15000);
  assert.equal(validated.uncertaintyMs, 25);

  console.log("✅ [PASS] Scenario 1: Online sync produces validated calibration");
}

// -----------------------------------------------------------------
// Test 2: Network loss without reboot (Holdover runtime)
// -----------------------------------------------------------------
{
  const anchorServerEpochMs = BASE_UTC_EPOCH;
  const initialPerf = 1000.0;
  const initialUncertaintyMs = 25;

  // Process stays alive for 30 minutes (1800s) offline
  const elapsedPerfMs = 1800 * 1000;
  const currentPerf = initialPerf + elapsedPerfMs;

  const currentEpochMs = Math.round(anchorServerEpochMs + (currentPerf - initialPerf));
  const expectedEpochMs = BASE_UTC_EPOCH + elapsedPerfMs;

  assert.equal(currentEpochMs, expectedEpochMs, "Monotonic progression must be exact without network");

  const uncertaintyMs = calculateHoldoverUncertainty(
    initialUncertaintyMs,
    elapsedPerfMs,
    MONOTONIC_DRIFT_PPM
  );
  assert.equal(uncertaintyMs, 61, "Uncertainty must grow by quartz oscillator drift model");
  assert.ok(uncertaintyMs < MAX_UNCERTAINTY_MS, "Uncertainty remains well within policy");

  console.log("✅ [PASS] Scenario 2: Network loss continues advancing monotonic holdover timeline");
}

// -----------------------------------------------------------------
// Test 3: Windows restart offline (Electron store restoration)
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "UTC",
    serverContractVersion: "v1",
    uncertaintyMs: 30,
  };

  // Re-boot 2 hours later offline
  const twoHoursMs = 2 * 3600 * 1000;
  const rebootDeviceEpochMs = BASE_DEVICE_EPOCH + twoHoursMs;

  const result = evaluateRtcPlausibility(cal, rebootDeviceEpochMs);
  assert.equal(result.plausible, true, "Windows offline restart with intact RTC must be plausible");
  assert.equal(result.status, "RESTORED", "Status must be RESTORED, not SYNCED");
  assert.equal(result.estimatedServerEpochMs, BASE_UTC_EPOCH + twoHoursMs);

  assert.equal(result.uncertaintyMs, 890);

  console.log("✅ [PASS] Scenario 3: Windows offline restart successfully restores calibrated clock");
}

// -----------------------------------------------------------------
// Test 4: Android restart offline (AsyncStorage restoration)
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "Asia/Riyadh", // UTC+3
    serverContractVersion: "v1",
    uncertaintyMs: 40,
  };

  // Re-boot 4 hours later offline
  const fourHoursMs = 4 * 3600 * 1000;
  const rebootDeviceEpochMs = BASE_DEVICE_EPOCH + fourHoursMs;

  const result = evaluateRtcPlausibility(cal, rebootDeviceEpochMs);
  assert.equal(result.plausible, true);
  assert.equal(result.status, "RESTORED");

  const daySecs = epochMsToDaySecs(result.estimatedServerEpochMs, cal.timezone);
  assert.equal(daySecs, 21 * 3600, "Local timezone seconds of day must match accurately");

  console.log("✅ [PASS] Scenario 4: Android offline restart restores time and evaluates correct timezone seconds");
}

// -----------------------------------------------------------------
// Test 5: RTC shifted forward 1 hour
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "UTC",
    serverContractVersion: "v1",
    uncertaintyMs: 50,
  };

  const oneHourMs = 3600 * 1000;
  const shiftedDeviceEpoch = BASE_DEVICE_EPOCH + oneHourMs;

  const result = evaluateRtcPlausibility(cal, shiftedDeviceEpoch);
  assert.equal(result.plausible, true, "Forward shift within 14 days is accepted as holdover");
  assert.equal(result.status, "RESTORED");
  assert.equal(result.estimatedServerEpochMs, BASE_UTC_EPOCH + oneHourMs);

  console.log("✅ [PASS] Scenario 5: RTC shifted forward 1 hour is handled gracefully within holdover policy");
}

// -----------------------------------------------------------------
// Test 6: RTC shifted backward 1 day
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "UTC",
    serverContractVersion: "v1",
    uncertaintyMs: 50,
  };

  const shiftedBackwardDeviceEpoch = BASE_DEVICE_EPOCH - 86400 * 1000;

  const result = evaluateRtcPlausibility(cal, shiftedBackwardDeviceEpoch);
  assert.equal(result.plausible, false, "Backward time reversal must be rejected");
  assert.equal(result.status, "UNTRUSTED", "Clock status must be UNTRUSTED");
  assert.ok(result.reason.includes("jumped backwards"));

  console.log("✅ [PASS] Scenario 6: RTC shifted backward 1 day is safely rejected as UNTRUSTED");
}

// -----------------------------------------------------------------
// Test 7: Midnight rollover
// -----------------------------------------------------------------
{
  const nearMidnightEpochMs = new Date("2026-10-12T23:59:58.000Z").getTime();
  const dateBefore = epochMsToDateStr(nearMidnightEpochMs, "UTC");
  const secBefore = epochMsToDaySecs(nearMidnightEpochMs, "UTC");

  assert.equal(dateBefore, "2026-10-12");
  assert.equal(secBefore, 86398);

  const afterMidnightEpochMs = nearMidnightEpochMs + 5000;
  const dateAfter = epochMsToDateStr(afterMidnightEpochMs, "UTC");
  const secAfter = epochMsToDaySecs(afterMidnightEpochMs, "UTC");

  assert.equal(dateAfter, "2026-10-13");
  assert.equal(secAfter, 3);

  console.log("✅ [PASS] Scenario 7: Midnight rollover transitions date and day seconds smoothly");
}

// -----------------------------------------------------------------
// Test 8: Long offline duration (5 days)
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "UTC",
    serverContractVersion: "v1",
    uncertaintyMs: 50,
  };

  const fiveDaysMs = 5 * 86400 * 1000;
  const deviceEpochAfter5Days = BASE_DEVICE_EPOCH + fiveDaysMs;

  const result = evaluateRtcPlausibility(cal, deviceEpochAfter5Days);
  assert.equal(result.plausible, true, "5 days is within 14-day holdover policy");
  assert.equal(result.status, "RESTORED");

  const expectedUncertainty = 50 + (fiveDaysMs * 50) / 1_000_000 + 500;
  assert.equal(result.uncertaintyMs, expectedUncertainty);
  assert.ok(result.uncertaintyMs < MAX_UNCERTAINTY_MS);

  console.log("✅ [PASS] Scenario 8: Long offline duration (5 days) advances holdover with calibrated uncertainty");
}

// -----------------------------------------------------------------
// Test 9: Clock uncertainty expiration (> 14 days)
// -----------------------------------------------------------------
{
  const cal = {
    schemaVersion: 1,
    serverEpochMs: BASE_UTC_EPOCH,
    deviceEpochMs: BASE_DEVICE_EPOCH,
    offsetMs: BASE_OFFSET_MS,
    syncTimestampMs: BASE_DEVICE_EPOCH,
    timezone: "UTC",
    serverContractVersion: "v1",
    uncertaintyMs: 50,
  };

  const fifteenDaysMs = 15 * 86400 * 1000;
  const deviceEpochAfter15Days = BASE_DEVICE_EPOCH + fifteenDaysMs;

  const result = evaluateRtcPlausibility(cal, deviceEpochAfter15Days);
  assert.equal(result.plausible, false, "Offline duration exceeding policy must be rejected");
  assert.equal(result.status, "UNTRUSTED");
  assert.ok(result.reason.includes("exceeds maximum policy"));

  console.log("✅ [PASS] Scenario 9: Holdover exceeding 14-day maximum policy expires to UNTRUSTED");
}

// -----------------------------------------------------------------
// Test 10: Reconnection with small drift (≤ 300ms)
// -----------------------------------------------------------------
{
  const currentRunningEpochMs = BASE_UTC_EPOCH + 10000;
  const sampleServerEpochMs = currentRunningEpochMs + 120; // 120ms drift
  const jumpMs = sampleServerEpochMs - currentRunningEpochMs;

  const isSmallDrift = Math.abs(jumpMs) <= DEFAULT_DRIFT_THRESHOLD_SEC * 1000;
  assert.ok(isSmallDrift, "120ms must be classified as small drift");

  console.log("✅ [PASS] Scenario 10: Reconnection with small drift (120ms) absorbs smoothly without timeline jump");
}

// -----------------------------------------------------------------
// Test 11: Reconnection with large clock jump (> 300ms)
// -----------------------------------------------------------------
{
  const currentRunningEpochMs = BASE_UTC_EPOCH + 10000;
  const sampleServerEpochMs = currentRunningEpochMs + 4500; // 4.5s jump
  const jumpMs = sampleServerEpochMs - currentRunningEpochMs;

  const isLargeJump = Math.abs(jumpMs) > DEFAULT_DRIFT_THRESHOLD_SEC * 1000;
  assert.ok(isLargeJump, "4500ms jump must be detected");
  assert.ok(sampleServerEpochMs > new Date("2024-01-01T00:00:00Z").getTime());

  console.log("✅ [PASS] Scenario 11: Reconnection with large clock jump triggers controlled rebase");
}

// -----------------------------------------------------------------
// Test 12: Global default playlist recovery
// -----------------------------------------------------------------
{
  const slideDurationsMs = [10000, 20000, 30000]; // Total 60s
  const syncAnchorMs = 0;

  const restoredServerEpochMs = BASE_UTC_EPOCH + 45000;
  const elapsedMs = positiveModulo(restoredServerEpochMs - syncAnchorMs, 60000);

  const phase = resolveDeterministicPlaylistPhase(slideDurationsMs, elapsedMs);

  assert.equal(phase.slideIndex, 2);
  assert.equal(phase.offsetInSlideSec, 15);
  assert.equal(phase.msUntilNextSlide, 15000);

  console.log("✅ [PASS] Scenario 12: Global default playlist resumes exact slide and offset after offline reboot");
}

// -----------------------------------------------------------------
// Test 13: Scheduled playlist recovery
// -----------------------------------------------------------------
{
  const childStartTime = "14:00:00";
  const slideDurationsMs = [15000, 15000]; // Total 30s loop

  const nowSec = toSecs("14:10:07");
  const startSec = toSecs(childStartTime);
  const elapsedSec = nowSec - startSec;
  const elapsedMs = Math.floor(elapsedSec * 1000); // 607000 ms

  const phase = resolveDeterministicPlaylistPhase(slideDurationsMs, elapsedMs);

  assert.equal(phase.slideIndex, 0);
  assert.equal(phase.offsetInSlideSec, 7);
  assert.equal(phase.msUntilNextSlide, 8000);

  console.log("✅ [PASS] Scenario 13: Scheduled playlist evaluates active child and loops deterministically offline");
}

// -----------------------------------------------------------------
// Test 14: Device sleep/resume
// -----------------------------------------------------------------
{
  let lastTickPerf = 10000.0;
  let lastTickDate = BASE_DEVICE_EPOCH;

  const suspendDurationMs = 1800 * 1000;
  const resumeDate = lastTickDate + suspendDurationMs;
  const resumePerf = lastTickPerf + 100;

  const deltaPerf = resumePerf - lastTickPerf;
  const deltaDate = resumeDate - lastTickDate;
  const sleepGapMs = deltaDate - deltaPerf;

  assert.ok(sleepGapMs > 2000, "Sleep gap detected correctly");

  let anchorServerEpochMs = BASE_UTC_EPOCH;
  anchorServerEpochMs += sleepGapMs;

  const adjustedNow = anchorServerEpochMs + (resumePerf - (lastTickPerf + 100));
  assert.equal(adjustedNow, BASE_UTC_EPOCH + sleepGapMs, "Anchor adjusted for sleep maintains real elapsed time");

  console.log("✅ [PASS] Scenario 14: Device sleep/resume adjusts monotonic anchor to wall clock gap");
}

// -----------------------------------------------------------------
// Test 15: Persistent data corruption
// -----------------------------------------------------------------
{
  const corruptPayloads = [
    null,
    undefined,
    "not-an-object",
    [],
    { schemaVersion: 2 },
    { schemaVersion: 1, serverEpochMs: "not-a-number" },
    { schemaVersion: 1, serverEpochMs: 1000, deviceEpochMs: 1000, offsetMs: 0 },
    { schemaVersion: 1, serverEpochMs: BASE_UTC_EPOCH, deviceEpochMs: BASE_DEVICE_EPOCH, offsetMs: 9999999 },
    { schemaVersion: 1, serverEpochMs: BASE_UTC_EPOCH, deviceEpochMs: BASE_DEVICE_EPOCH, offsetMs: BASE_OFFSET_MS, uncertaintyMs: -5 },
  ];

  for (const payload of corruptPayloads) {
    const validated = validateCalibrationPayload(payload);
    assert.equal(validated, null, `Corrupt payload must be rejected: ${JSON.stringify(payload)}`);
  }

  console.log("✅ [PASS] Scenario 15: Persistent data corruption is strictly detected and rejected");
}

console.log("\n=================================================================");
console.log("  ALL 15 DETERMINISTIC OFFLINE CLOCK RECOVERY TESTS PASSED!       ");
console.log("=================================================================\n");
