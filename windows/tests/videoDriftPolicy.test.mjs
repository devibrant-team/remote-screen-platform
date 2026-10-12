// tests/videoDriftPolicy.test.mjs
import assert from "node:assert/strict";

/**
 * Pure evaluation logic matching videoDriftPolicy.ts
 */
const DEFAULT_DRIFT_POLICY = {
  deadbandMs: 120,
  softMaxMs: 500,
  hardSeekCooldownMs: 1800,
  rateSpeedUp: 1.08,
  rateSlowDown: 0.92,
  minOffsetForCorrection: 0.25,
};

function evaluateDriftCorrection(params) {
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

  const cfg = { ...DEFAULT_DRIFT_POLICY, ...userConfig };

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

  // 1. In sync (|drift| < 120ms)
  if (absDriftMs < cfg.deadbandMs) {
    return { type: "in_sync", targetRate: 1.0, driftMs };
  }

  // 2. Gentle rate adjustment (120ms - 500ms)
  if (absDriftMs <= cfg.softMaxMs) {
    const targetRate = driftMs > 0 ? cfg.rateSpeedUp : cfg.rateSlowDown;
    return { type: "rate_adjust", targetRate, driftMs };
  }

  // 3. Hard seek (> 500ms) with cooldown
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

console.log("==========================================================");
console.log("  IGUANA SIGNAGE - VIDEO DRIFT CORRECTION TEST SUITE      ");
console.log("==========================================================\n");

let passed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// 1. Small drift ignored (< 120ms deadband)
runTest("Test 1: Small drift (|drift| < 120ms) is ignored and keeps rate 1.0", () => {
  const result = evaluateDriftCorrection({
    expectedTimeSec: 10.050,
    actualTimeSec: 10.000,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 5000,
  });

  assert.equal(result.type, "in_sync");
  assert.equal(result.targetRate, 1.0);
  assert.equal(result.driftMs, 50);
});

// 2. Medium drift corrected gently (video lagging: +250ms -> 1.08x)
runTest("Test 2: Medium drift lagging (+250ms) applies gentle speed up (1.08x)", () => {
  const result = evaluateDriftCorrection({
    expectedTimeSec: 10.250,
    actualTimeSec: 10.000,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 5000,
  });

  assert.equal(result.type, "rate_adjust");
  assert.equal(result.targetRate, 1.08);
  assert.equal(result.driftMs, 250);
});

// 3. Medium drift corrected gently (video leading: -250ms -> 0.92x)
runTest("Test 3: Medium drift leading (-250ms) applies gentle slow down (0.92x)", () => {
  const result = evaluateDriftCorrection({
    expectedTimeSec: 9.750,
    actualTimeSec: 10.000,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 5000,
  });

  assert.equal(result.type, "rate_adjust");
  assert.equal(result.targetRate, 0.92);
  assert.equal(result.driftMs, -250);
});

// 4. Large drift hard-seeked (> 500ms)
runTest("Test 4: Large drift (+2400ms) triggers hard seek to expected position", () => {
  const result = evaluateDriftCorrection({
    expectedTimeSec: 14.500,
    actualTimeSec: 12.100,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 10000,
  });

  assert.equal(result.type, "hard_seek");
  assert.equal(result.targetTimeSec, 14.5);
  assert.equal(result.driftMs, 2400);
});

// 5. Hard seek cooldown prevents oscillation loops
runTest("Test 5: Hard seek cooldown blocks repetitive seeks within 1800ms", () => {
  const tSeek = 10000;

  // First hard seek at t = 10000ms
  const r1 = evaluateDriftCorrection({
    expectedTimeSec: 20.0,
    actualTimeSec: 15.0,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: tSeek,
  });
  assert.equal(r1.type, "hard_seek");

  // Subsequent check 500ms later (at t = 10500ms): cooldown must trigger!
  const r2 = evaluateDriftCorrection({
    expectedTimeSec: 20.5,
    actualTimeSec: 15.2,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: tSeek,
    currentNowMs: tSeek + 500,
  });
  assert.equal(r2.type, "cooldown");

  // Subsequent check after cooldown (at t = 11900ms, 1900ms later): seek permitted!
  const r3 = evaluateDriftCorrection({
    expectedTimeSec: 22.0,
    actualTimeSec: 16.0,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: tSeek,
    currentNowMs: tSeek + 1900,
  });
  assert.equal(r3.type, "hard_seek");
});

// 6. Boundary safety windows (start & end of video)
runTest("Test 6: Boundary windows skip correction to prevent glitching", () => {
  // Within start window (< 0.25s)
  const rStart = evaluateDriftCorrection({
    expectedTimeSec: 0.15,
    actualTimeSec: 0.0,
    videoDurationSec: 30.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 1000,
  });
  assert.equal(rStart.type, "skip");
  assert.equal(rStart.reason, "start_boundary_window");

  // Near end of video (> duration - 0.25s)
  const rEnd = evaluateDriftCorrection({
    expectedTimeSec: 29.85,
    actualTimeSec: 28.0,
    videoDurationSec: 30.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 5000,
  });
  assert.equal(rEnd.type, "skip");
  assert.equal(rEnd.reason, "end_boundary_window");
});

// 7. Buffering and seeking states are handled safely
runTest("Test 7: Media buffering, seeking, and pause inhibit drift correction", () => {
  const base = {
    expectedTimeSec: 15.0,
    actualTimeSec: 12.0,
    videoDurationSec: 60.0,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 5000,
  };

  assert.equal(evaluateDriftCorrection({ ...base, isBuffering: true }).type, "skip");
  assert.equal(evaluateDriftCorrection({ ...base, isSeeking: true }).type, "skip");
  assert.equal(evaluateDriftCorrection({ ...base, isPaused: true }).type, "skip");
  assert.equal(evaluateDriftCorrection({ ...base, isReady: false }).type, "skip");
});

// 8. Long-running stability (10-minute / 600-second video)
runTest("Test 8: Long-running 10-minute video tracks accurately across timeline", () => {
  const duration = 600.0; // 10 minutes

  // Check at minute 5 (300 seconds)
  const r300 = evaluateDriftCorrection({
    expectedTimeSec: 300.200,
    actualTimeSec: 300.000,
    videoDurationSec: duration,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 300000,
  });
  assert.equal(r300.type, "rate_adjust");
  assert.equal(r300.targetRate, 1.08);

  // Check when back in sync at 305 seconds
  const r305 = evaluateDriftCorrection({
    expectedTimeSec: 305.040,
    actualTimeSec: 305.000,
    videoDurationSec: duration,
    isReady: true,
    isSeeking: false,
    isBuffering: false,
    isPaused: false,
    lastHardSeekMs: 0,
    currentNowMs: 305000,
  });
  assert.equal(r305.type, "in_sync");
  assert.equal(r305.targetRate, 1.0);
});

console.log(`\n==========================================================`);
console.log(`  ALL ${passed} VIDEO DRIFT CORRECTION TESTS PASSED!       `);
console.log(`==========================================================`);
