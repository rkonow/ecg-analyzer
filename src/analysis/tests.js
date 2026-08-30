// Verification suite for the ECG analysis module. Runs entirely in the
// browser (no build step / test runner) — load via dev.html. Generates
// synthetic ECGs with known ground truth and checks recovered measurements
// against it within stated tolerances, plus edge-case handling.

import { analyzeLead } from './analyze.js';
import { generateSyntheticECG } from './synthetic.js';

const results = [];

function record(name, pass, message) {
  results.push({ name, pass, message: message || '' });
}

function test(name, fn) {
  try {
    fn();
    if (!results.length || results[results.length - 1].name !== name) {
      record(name, true);
    }
  } catch (err) {
    record(name, false, err.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertClose(actual, expected, tolerance, label) {
  if (actual === null || actual === undefined || !Number.isFinite(actual)) {
    throw new Error(`${label}: expected ~${expected}, got ${actual}`);
  }
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${label}: expected ${expected} +/- ${tolerance}, got ${actual} (diff ${diff.toFixed(2)})`);
  }
}

// --- Test 1: clean normal sinus rhythm -------------------------------------
test('clean sinus rhythm: recovers HR, PR, QRS, QT within tolerance', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 12,
    heartRateBpm: 75,
    prMs: 160,
    qrsMs: 90,
    qtMs: 380,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });

  assert(result.ok, 'result.ok should be true');
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 3, 'heart rate (bpm)');
  assert(result.heartRate.method === 'Pan-Tompkins', 'method should report Pan-Tompkins');
  assertClose(result.intervals.prMs.mean, groundTruth.prMs, 40, 'PR interval (ms)');
  assertClose(result.intervals.qrsMs.mean, groundTruth.qrsMs, 40, 'QRS duration (ms)');
  assertClose(result.intervals.qtMs.mean, groundTruth.qtMs, 50, 'QT interval (ms)');
  assert(result.rhythm.regular === true, 'rhythm should be regular');
  assert(result.rhythm.classification === 'sinus', `expected sinus classification, got ${result.rhythm.classification}`);
  assert(result.beats.length >= groundTruth.beatCount - 1, 'should detect nearly all beats');
  assert(result.axis.degrees === null, 'axis should be null for single lead');
});

// --- Test 2: noisy signal (baseline wander + 50Hz hum + white noise) -------
test('noisy sinus rhythm: still recovers HR within looser tolerance', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 12,
    heartRateBpm: 72,
    prMs: 150,
    qrsMs: 90,
    qtMs: 370,
    baselineWanderHz: 0.3,
    baselineWanderMv: 0.35,
    powerlineHz: 50,
    powerlineMv: 0.08,
    noiseStdMv: 0.04,
    seed: 42,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });

  assert(result.ok, 'result.ok should be true');
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 5, 'heart rate (bpm) under noise');
  assert(Array.isArray(result.warnings), 'warnings should be an array');
});

// --- Test 3: tachycardia ----------------------------------------------------
test('tachycardia: HR ~150bpm flagged', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 10,
    heartRateBpm: 150,
    prMs: 120,
    qrsMs: 80,
    qtMs: 300,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 5, 'heart rate (bpm)');
  assert(result.flags.includes('tachycardia'), `expected tachycardia flag, got ${JSON.stringify(result.flags)}`);
});

// --- Test 4: bradycardia ----------------------------------------------------
test('bradycardia: HR ~40bpm flagged', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 14,
    heartRateBpm: 40,
    prMs: 170,
    qrsMs: 95,
    qtMs: 420,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 5, 'heart rate (bpm)');
  assert(result.flags.includes('bradycardia'), `expected bradycardia flag, got ${JSON.stringify(result.flags)}`);
});

// --- Test 5: extreme tachycardia -------------------------------------------
test('extreme tachycardia: HR ~200bpm detected without crashing', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 8,
    heartRateBpm: 200,
    prMs: 100,
    qrsMs: 70,
    qtMs: 260,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 8, 'heart rate (bpm)');
  assert(result.flags.includes('tachycardia'), 'expected tachycardia flag');
});

// --- Test 6: extreme bradycardia --------------------------------------------
test('extreme bradycardia: HR ~30bpm detected without crashing', () => {
  const { samples, samplingRate, groundTruth } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 16,
    heartRateBpm: 30,
    prMs: 180,
    qrsMs: 100,
    qtMs: 460,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assertClose(result.heartRate.bpm, groundTruth.heartRateBpm, 6, 'heart rate (bpm)');
  assert(result.flags.includes('bradycardia'), 'expected bradycardia flag');
});

// --- Test 7: irregularly irregular rhythm, no clear P waves -----------------
test('irregular rhythm with absent P waves: flagged irregular, not sinus', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 16,
    heartRateBpm: 85,
    rrJitterMs: 180,
    pAmplitudeMv: 0,
    qrsMs: 90,
    qtMs: 360,
    seed: 7,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assert(result.ok, 'result.ok should be true');
  assert(result.rhythm.regular === false, 'rhythm should be classified irregular');
  assert(result.flags.includes('irregular-rhythm'), 'expected irregular-rhythm flag');
  assert(result.rhythm.classification !== 'sinus', 'should not classify as sinus');
});

// --- Test 8: prolonged QT ----------------------------------------------------
test('prolonged QT is flagged', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 12,
    heartRateBpm: 70,
    prMs: 150,
    qrsMs: 90,
    qtMs: 520,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assert(result.flags.includes('prolonged-QT'), `expected prolonged-QT flag, got ${JSON.stringify(result.flags)} (qtc=${result.intervals.qtcMs.mean})`);
});

// --- Test 9: wide QRS --------------------------------------------------------
test('wide QRS is flagged', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 12,
    heartRateBpm: 70,
    prMs: 150,
    qrsMs: 160,
    qtMs: 420,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assert(result.flags.includes('wide-QRS'), `expected wide-QRS flag, got ${JSON.stringify(result.flags)} (qrs mean=${result.intervals.qrsMs.mean})`);
});

// --- Test 10: HRV sanity on a clean regular rhythm --------------------------
test('HRV metrics are near zero for a near-constant RR clean rhythm', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 14,
    heartRateBpm: 70,
    prMs: 150,
    qrsMs: 90,
    qtMs: 380,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assert(result.hrv.sdnnMs !== null, 'sdnnMs should be computed');
  assert(result.hrv.sdnnMs < 15, `expected low SDNN for regular rhythm, got ${result.hrv.sdnnMs}`);
  assert(result.hrv.pnn50 !== null && result.hrv.pnn50 < 5, `expected near-zero pNN50, got ${result.hrv.pnn50}`);
});

// --- Edge case: flat line ----------------------------------------------------
test('edge case: flat line does not crash and returns null heart rate', () => {
  const samples = new Array(2000).fill(0.42);
  const result = analyzeLead(samples, 250, { mvPerUnit: 1 });
  assert(result.ok === true, 'flat line should still return ok:true (degrade honestly, not an error)');
  assert(result.heartRate.bpm === null, 'flat line should not report a heart rate');
  assert(result.beats.length === 0, 'flat line should report zero beats');
  assert(result.flags.includes('low-signal-quality'), 'flat line should be flagged low-signal-quality');
  assert(result.warnings.length > 0, 'flat line should carry a warning');
});

// --- Edge case: pure white noise --------------------------------------------
test('edge case: pure noise does not crash and produces a valid shape', () => {
  let seedState = 99;
  const rand = () => {
    seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
    return seedState / 0x7fffffff;
  };
  const samples = Array.from({ length: 2500 }, () => (rand() - 0.5) * 0.6);
  const result = analyzeLead(samples, 250, { mvPerUnit: 1 });
  assert(typeof result.ok === 'boolean', 'ok should be boolean');
  assert(Array.isArray(result.warnings), 'warnings should be an array');
  assert(Array.isArray(result.beats), 'beats should be an array');
  assert(result.axis.degrees === null, 'axis should remain null');
});

// --- Edge case: very short signal -------------------------------------------
test('edge case: very short signal (under 2s) is handled gracefully', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 1,
    heartRateBpm: 75,
  });
  const result = analyzeLead(samples, samplingRate, { mvPerUnit: 1 });
  assert(result.ok === true, 'short signal should still return ok:true');
  assert(result.warnings.some((w) => w.toLowerCase().includes('duration') || w.toLowerCase().includes('short')), 'should warn about short duration');
});

// --- Edge case: below minimum sample count ----------------------------------
test('edge case: signal below minimum sample count returns empty but valid result', () => {
  const result = analyzeLead([0.1, 0.2, 0.1, -0.1, 0.05], 250, { mvPerUnit: 1 });
  assert(result.ok === true, 'too-short array should still return ok:true');
  assert(result.heartRate.bpm === null, 'bpm should be null');
  assert(result.beats.length === 0, 'beats should be empty');
});

// --- Edge case: malformed input ----------------------------------------------
test('edge case: malformed input (non-array samples) returns ok:false without throwing', () => {
  const result = analyzeLead(null, 250, { mvPerUnit: 1 });
  assert(result.ok === false, 'malformed input should report ok:false');
  assert(result.warnings.length > 0, 'malformed input should carry a warning');
});

test('edge case: invalid samplingRate returns ok:false without throwing', () => {
  const result = analyzeLead([0, 1, 0, -1, 0, 1, 0, -1], 0, { mvPerUnit: 1 });
  assert(result.ok === false, 'invalid samplingRate should report ok:false');
});

// --- Edge case: no mV calibration provided -----------------------------------
test('edge case: missing mvPerUnit yields null amplitudes plus a warning', () => {
  const { samples, samplingRate } = generateSyntheticECG({
    samplingRate: 250,
    durationSec: 10,
    heartRateBpm: 75,
  });
  const result = analyzeLead(samples, samplingRate, {});
  assert(result.ok, 'result.ok should be true');
  assert(result.warnings.some((w) => w.toLowerCase().includes('mvperunit')), 'should warn about missing calibration');
  const beatWithR = result.beats.find((b) => b.r);
  assert(beatWithR && beatWithR.r.amplitudeMv === null, 'R amplitude should be null without calibration');
});

export function runAllTests() {
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  return { results, passCount, failCount, total: results.length };
}
