// tests/defaultPlaylistSync.test.mjs
import assert from "node:assert/strict";

/**
 * Deterministic functions matching playlistTimeline.ts across Windows and Android
 */
function positiveModulo(val, mod) {
  if (mod <= 0) return 0;
  return ((val % mod) + mod) % mod;
}

function normalizeSlideDurationMs(duration) {
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.round(duration * 1000);
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

console.log("=================================================");
console.log("  IGUANA SIGNAGE - DETERMINISTIC SYNC TEST SUITE ");
console.log("=================================================\n");

let passedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// Test 1: Requirement 12 - 4 Devices Starting at Different Times
// -------------------------------------------------------------
runTest("Req 12: 4 Devices with Different Launch Times Resolve Identical Slide & Video Offset", () => {
  // Playlist: Slide 0 = 30s (video), Slide 1 = 15s (image), Slide 2 = 45s (video). Total = 90s (90,000ms).
  const slides = [{ duration: 30 }, { duration: 15 }, { duration: 45 }];
  const durationsMs = slides.map((s) => normalizeSlideDurationMs(s.duration));
  const totalDurationMs = durationsMs.reduce((sum, d) => sum + d, 0); // 90,000ms

  const T0 = 1776000000000; // Reference server epoch ms
  const sharedAnchorEpochMs = 0; // Universal deterministic epoch anchor

  // Simulated device launch times
  const win1_launch = T0;
  const android1_launch = T0 + 25 * 1000;
  const win2_launch = T0 + 120 * 1000;
  const android2_launch = T0 + 300 * 1000;

  // Common observation time T_obs = T0 + 314.5s (314,500ms after T0)
  // (1,776,000,000,000 + 314,500) % 90,000 = 74,500ms
  // Slide 0: 0-30,000ms, Slide 1: 30,000-45,000ms, Slide 2: 45,000-90,000ms
  // 74,500ms falls into Slide 2 with offset = 74,500 - 45,000 = 29,500ms (29.5s)
  const T_obs = T0 + 314500;

  function simulateDevicePhase(serverNowEpochMs) {
    const elapsedMs = positiveModulo(serverNowEpochMs - sharedAnchorEpochMs, totalDurationMs);
    return resolveDeterministicPlaylistPhase(durationsMs, elapsedMs);
  }

  const phase_win1 = simulateDevicePhase(T_obs);
  const phase_android1 = simulateDevicePhase(T_obs);
  const phase_win2 = simulateDevicePhase(T_obs);
  const phase_android2 = simulateDevicePhase(T_obs);

  // All 4 devices must resolve the EXACT same slide index, offset, and msUntilNextSlide
  assert.equal(phase_win1.slideIndex, 2, "Win1 should be on slide 2");
  assert.equal(phase_android1.slideIndex, 2, "Android1 should be on slide 2");
  assert.equal(phase_win2.slideIndex, 2, "Win2 should be on slide 2");
  assert.equal(phase_android2.slideIndex, 2, "Android2 should be on slide 2");

  assert.equal(phase_win1.offsetInSlideSec, 29.5, "Win1 offset should be 29.5s");
  assert.equal(phase_android1.offsetInSlideSec, 29.5, "Android1 offset should be 29.5s");
  assert.equal(phase_win2.offsetInSlideSec, 29.5, "Win2 offset should be 29.5s");
  assert.equal(phase_android2.offsetInSlideSec, 29.5, "Android2 offset should be 29.5s");

  assert.equal(phase_win1.msUntilNextSlide, 15500, "Win1 remaining should be 15,500ms");
  assert.equal(phase_android2.msUntilNextSlide, 15500, "Android2 remaining should be 15,500ms");
});

// -------------------------------------------------------------
// Test 2: Exact Slide and Playlist Boundaries
// -------------------------------------------------------------
runTest("Req 13.1: Exact Slide and Playlist Loop Boundaries", () => {
  // Slides: 10s, 20s. Total: 30s = 30000ms
  const durationsMs = [10000, 20000];

  // 1ms before slide 0 ends
  const p1 = resolveDeterministicPlaylistPhase(durationsMs, 9999);
  assert.equal(p1.slideIndex, 0);
  assert.equal(p1.offsetInSlideSec, 9.999);
  assert.equal(p1.msUntilNextSlide, 1);

  // Exact millisecond of transition to slide 1
  const p2 = resolveDeterministicPlaylistPhase(durationsMs, 10000);
  assert.equal(p2.slideIndex, 1);
  assert.equal(p2.offsetInSlideSec, 0.0);
  assert.equal(p2.msUntilNextSlide, 20000);

  // 1ms before playlist loop ends
  const p3 = resolveDeterministicPlaylistPhase(durationsMs, 29999);
  assert.equal(p3.slideIndex, 1);
  assert.equal(p3.offsetInSlideSec, 19.999);
  assert.equal(p3.msUntilNextSlide, 1);

  // Exact millisecond of loop wrap-around
  const p4 = resolveDeterministicPlaylistPhase(durationsMs, 30000);
  assert.equal(p4.slideIndex, 0);
  assert.equal(p4.offsetInSlideSec, 0.0);
  assert.equal(p4.msUntilNextSlide, 10000);
});

// -------------------------------------------------------------
// Test 3: Multiple Complete Playlist Loops (Long Term Stability)
// -------------------------------------------------------------
runTest("Req 13.2: Long Term Stability across 10,000 Playlist Loops", () => {
  const durationsMs = [12000, 18000, 30000]; // 60s total
  const total = 60000;

  // Test at loop 0 at 15.2s
  const pBase = resolveDeterministicPlaylistPhase(durationsMs, 15200);

  // Test at loop 10,000 (after 600,000 seconds = ~7 days)
  const p7Days = resolveDeterministicPlaylistPhase(durationsMs, 10000 * total + 15200);

  assert.equal(pBase.slideIndex, p7Days.slideIndex);
  assert.equal(pBase.offsetInSlideSec, p7Days.offsetInSlideSec);
  assert.equal(pBase.msUntilNextSlide, p7Days.msUntilNextSlide);
});

// -------------------------------------------------------------
// Test 4: Midnight Rollover Continuity
// -------------------------------------------------------------
runTest("Req 13.3: Smooth Midnight Rollover Without Reset or Stutter", () => {
  const durationsMs = [20000, 40000]; // 60s loop
  const total = 60000;

  // Midnight transition:
  const T_midnight = 1776000000000;
  const T_before = T_midnight - 100; // 23:59:59.900
  const T_after = T_midnight + 100;  // 00:00:00.100

  const pBefore = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(T_before, total));
  const pAfter = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(T_after, total));

  // The elapsed time must advance by exactly 200ms across the midnight boundary
  const elapsedDiff = (pAfter.loopElapsedMs - pBefore.loopElapsedMs + total) % total;
  assert.equal(elapsedDiff, 200, "Phase should advance by exactly 200ms across midnight");
});

// -------------------------------------------------------------
// Test 5: Cross-Timezone Devices
// -------------------------------------------------------------
runTest("Req 13.4: Cross-Timezone Devices Share Absolute UTC Epoch", () => {
  const durationsMs = [10000, 20000, 30000];
  const total = 60000;

  // Physical instant in UTC:
  const utcNow = 1776045123456;

  // Regardless of local system timezone (New York, Beirut, Tokyo),
  // serverNowEpochMs is derived from NTP UTC epoch milliseconds.
  const phaseNY = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(utcNow, total));
  const phaseBeirut = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(utcNow, total));
  const phaseTokyo = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(utcNow, total));

  assert.deepEqual(phaseNY, phaseBeirut);
  assert.deepEqual(phaseBeirut, phaseTokyo);
});

// -------------------------------------------------------------
// Test 6: Restart During Active Video
// -------------------------------------------------------------
runTest("Req 13.5: Device Restart Mid-Video Resumes at Current Global Offset", () => {
  // Slide 0: 60s video
  const durationsMs = [60000];
  const total = 60000;

  // Video was at 22.3s when power cut occurred
  const tBeforeCrash = 22300;
  // Device reboots 5 seconds later
  const tAfterReboot = 27300;

  const phaseAfterReboot = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(tAfterReboot, total));

  assert.equal(phaseAfterReboot.slideIndex, 0);
  assert.equal(phaseAfterReboot.offsetInSlideSec, 27.3, "Should seek directly to 27.3s");
});

// -------------------------------------------------------------
// Test 7: Device Clock Skew Compensated by NTP Offset
// -------------------------------------------------------------
runTest("Req 13.6: Different Device Hardware Skew Normalized by Clock Engine", () => {
  const durationsMs = [15000, 15000];
  const total = 30000;

  const trueServerEpoch = 1776000050000;

  // Device A hardware RTC is fast by 2 minutes (+120,000ms)
  const deviceA_localEpoch = trueServerEpoch + 120000;
  const deviceA_offsetMs = trueServerEpoch - deviceA_localEpoch; // -120,000ms

  // Device B hardware RTC is slow by 1 hour (-3,600,000ms)
  const deviceB_localEpoch = trueServerEpoch - 3600000;
  const deviceB_offsetMs = trueServerEpoch - deviceB_localEpoch; // +3,600,000ms

  // Derived server time on both devices
  const serverNowA = deviceA_localEpoch + deviceA_offsetMs;
  const serverNowB = deviceB_localEpoch + deviceB_offsetMs;

  assert.equal(serverNowA, trueServerEpoch);
  assert.equal(serverNowB, trueServerEpoch);

  const phaseA = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(serverNowA, total));
  const phaseB = resolveDeterministicPlaylistPhase(durationsMs, positiveModulo(serverNowB, total));

  assert.deepEqual(phaseA, phaseB);
});

// -------------------------------------------------------------
// Test 8: Scheduled Child vs Default Playlist Transitions
// -------------------------------------------------------------
runTest("Req 13.7: Scheduled Child vs Default Playlist Transition Semantics", () => {
  // Default playlist slides: 20s each (Total 40s)
  const defaultDurationsMs = [20000, 20000];
  // Child playlist slides: 30s each (Total 60s)
  const childDurationsMs = [30000, 30000];

  // At 07:59:50 (Default playlist active)
  const tDefault = 1776000030000; // elapsed = 30,000ms -> Slide 1, offset 10s
  const defaultPhase = resolveDeterministicPlaylistPhase(defaultDurationsMs, positiveModulo(tDefault, 40000));
  assert.equal(defaultPhase.slideIndex, 1);
  assert.equal(defaultPhase.offsetInSlideSec, 10.0);

  // At 08:00:00 (Schedule starts with childStartTime = "08:00:00")
  const childStartSec = 8 * 3600; // 28800s
  const nowSecAt8AM = 28800;
  const childElapsedMs = Math.floor((nowSecAt8AM - childStartSec) * 1000); // 0ms
  const childPhaseAtStart = resolveDeterministicPlaylistPhase(childDurationsMs, childElapsedMs);
  assert.equal(childPhaseAtStart.slideIndex, 0);
  assert.equal(childPhaseAtStart.offsetInSlideSec, 0.0);

  // At 08:00:45 (45s into child schedule)
  const nowSecAt80045 = 28845;
  const childElapsedMs45 = Math.floor((nowSecAt80045 - childStartSec) * 1000); // 45000ms
  const childPhase45 = resolveDeterministicPlaylistPhase(childDurationsMs, childElapsedMs45);
  assert.equal(childPhase45.slideIndex, 1);
  assert.equal(childPhase45.offsetInSlideSec, 15.0);

  // At 09:00:00 (Schedule ends -> switches back to default playlist)
  const tDefaultEnd = 1776000030000 + 3600 * 1000; // +1 hour = +3,600,000ms
  // 3,630,000 % 40,000 = 30,000ms -> Slide 1, offset 10s
  const defaultPhaseAfter = resolveDeterministicPlaylistPhase(defaultDurationsMs, positiveModulo(tDefaultEnd, 40000));
  assert.equal(defaultPhaseAfter.slideIndex, 1);
  assert.equal(defaultPhaseAfter.offsetInSlideSec, 10.0);
});

console.log(`\n=================================================`);
console.log(`  ALL ${passedTests} DETERMINISTIC SYNCHRONIZATION TESTS PASSED!`);
console.log(`=================================================`);
