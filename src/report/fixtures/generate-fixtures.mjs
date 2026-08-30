#!/usr/bin/env node
// Deterministic generator for the dev fixtures under src/report/fixtures/.
// Run with `node generate-fixtures.mjs` to regenerate healthy.json / degraded.json.
// Not part of the shipped app - a repeatable way to produce contract-shaped
// sample analysis/extraction objects for src/report/dev.html, matching the
// exact shapes produced by src/analysis/analyze.js (heartRate.method is
// always 'Pan-Tompkins'; P/T waves are {onset,peak,offset,amplitudeMv};
// Q/R/S are {index,amplitudeMv}; prMs/qrsMs/qtMs are {mean,sd,n} with no
// min/max; qtcMs is {mean,formula} with no sd/n; axis is always null today
// since a single lead can't determine it; pnn50 is already a 0-100 percent).

const SAMPLING_RATE = 250;
const DURATION_SEC = 10;

// Simple seeded PRNG so regenerating the fixtures is reproducible.
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(t, center, width, amplitude) {
  const z = (t - center) / width;
  return amplitude * Math.exp(-0.5 * z * z);
}

function buildBeatWave(samples, samplingRate, rSec, { pSec, qSec, sSec, tSec, pAmp, qAmp, rAmp, sAmp, tAmp }) {
  const n = samples.length;
  const spanSec = 0.5;
  const startI = Math.max(0, Math.floor((rSec - spanSec) * samplingRate));
  const endI = Math.min(n - 1, Math.ceil((rSec + spanSec) * samplingRate));
  const offsets = [
    pAmp !== null ? [pSec, 0.018, pAmp] : null,
    [qSec, 0.007, qAmp],
    [rSec, 0.009, rAmp],
    [sSec, 0.008, sAmp],
    tAmp !== null ? [tSec, 0.036, tAmp] : null,
  ];
  for (let i = startI; i <= endI; i++) {
    const t = i / samplingRate;
    let v = 0;
    for (const o of offsets) {
      if (!o) continue;
      v += gaussian(t, o[0], o[1], o[2]);
    }
    samples[i] += v;
  }
}

function sampleAt(samples, idx) {
  return samples[Math.max(0, Math.min(samples.length - 1, idx))];
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function sd(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

function buildRecording({ rng, rrBaseMs, rrJitterMs, pProbability, tProbability, noiseAmp, baselineWanderAmp }) {
  const n = Math.round(DURATION_SEC * SAMPLING_RATE);
  const samples = new Array(n).fill(0);

  const rTimes = [];
  let t = 0.4;
  while (t < DURATION_SEC - 0.4) {
    rTimes.push(t);
    const jitter = (rng() - 0.5) * 2 * rrJitterMs;
    t += (rrBaseMs + jitter) / 1000;
  }

  const beats = [];
  for (let i = 0; i < rTimes.length; i++) {
    const rSec = rTimes[i];
    const hasP = rng() < pProbability;
    const hasT = rng() < tProbability;
    // Small per-beat jitter on each wave's offset from R, so PR/QRS/QT
    // intervals show realistic beat-to-beat variance instead of a flat SD=0.
    const pSec = rSec - 0.16 + (rng() - 0.5) * 0.012;
    const qSec = rSec - 0.02 + (rng() - 0.5) * 0.006;
    const sSec = rSec + 0.022 + (rng() - 0.5) * 0.006;
    const tSecWave = rSec + 0.2 + (rng() - 0.5) * 0.024;
    const morph = {
      pSec, qSec, sSec, tSec: tSecWave,
      pAmp: hasP ? 0.14 + rng() * 0.03 : null,
      qAmp: -(0.1 + rng() * 0.05),
      rAmp: 1.0 + rng() * 0.25,
      sAmp: -(0.2 + rng() * 0.08),
      tAmp: hasT ? 0.26 + rng() * 0.08 : null,
    };
    buildBeatWave(samples, SAMPLING_RATE, rSec, morph);

    const rIndex = Math.round(rSec * SAMPLING_RATE);
    const pIndex = Math.round(pSec * SAMPLING_RATE);
    const qIndex = Math.round(qSec * SAMPLING_RATE);
    const sIndex = Math.round(sSec * SAMPLING_RATE);
    const tIndex = Math.round(tSecWave * SAMPLING_RATE);
    const pHalfWidth = Math.round(0.02 * SAMPLING_RATE);
    const tHalfWidth = Math.round(0.045 * SAMPLING_RATE);

    // Matches src/analysis/delineate.js's public shape: P/T are
    // {onset,peak,offset,amplitudeMv}; Q/R/S are {index,amplitudeMv}. None
    // of these carry tSec - the report module derives it from the index.
    beats.push({
      index: i,
      tSec: Number(rSec.toFixed(4)),
      rIndex,
      p: hasP ? { onset: pIndex - pHalfWidth, peak: pIndex, offset: pIndex + pHalfWidth, amplitudeMv: null } : null,
      q: { index: qIndex, amplitudeMv: null },
      r: { index: rIndex, amplitudeMv: null },
      s: { index: sIndex, amplitudeMv: null },
      t: hasT ? { onset: tIndex - tHalfWidth, peak: tIndex, offset: tIndex + tHalfWidth, amplitudeMv: null } : null,
    });
  }

  for (let i = 0; i < n; i++) {
    samples[i] += (rng() - 0.5) * 2 * noiseAmp;
    samples[i] += baselineWanderAmp * Math.sin((i / SAMPLING_RATE) * 2 * Math.PI * 0.18);
  }

  for (const beat of beats) {
    if (beat.p) beat.p.amplitudeMv = Number(sampleAt(samples, beat.p.peak).toFixed(4));
    if (beat.t) beat.t.amplitudeMv = Number(sampleAt(samples, beat.t.peak).toFixed(4));
    beat.q.amplitudeMv = Number(sampleAt(samples, beat.q.index).toFixed(4));
    beat.r.amplitudeMv = Number(sampleAt(samples, beat.r.index).toFixed(4));
    beat.s.amplitudeMv = Number(sampleAt(samples, beat.s.index).toFixed(4));
  }

  return { samples: samples.map((v) => Number(v.toFixed(5))), beats };
}

function computeIntervals(beats, samplingRate) {
  const rr = [];
  for (let i = 1; i < beats.length; i++) rr.push(((beats[i].rIndex - beats[i - 1].rIndex) / samplingRate) * 1000);

  const summarize = (values) => (values.length === 0
    ? { mean: null, sd: null, n: 0 }
    : { mean: Number(mean(values).toFixed(1)), sd: Number(sd(values).toFixed(1)), n: values.length });

  const prValues = [];
  const qrsValues = [];
  const qtValues = [];
  const qtcValues = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat.p) prValues.push(((beat.q.index - beat.p.onset) / samplingRate) * 1000);
    qrsValues.push(((beat.s.index - beat.q.index) / samplingRate) * 1000);
    if (beat.t) {
      const qtMs = ((beat.t.offset - beat.q.index) / samplingRate) * 1000;
      qtValues.push(qtMs);
      if (i > 0) {
        const rrSec = (beat.rIndex - beats[i - 1].rIndex) / samplingRate;
        if (rrSec > 0) qtcValues.push(qtMs / Math.sqrt(rrSec));
      }
    }
  }

  const rrStat = rr.length === 0
    ? { mean: null, sd: null, min: null, max: null, values: [] }
    : { mean: Number(mean(rr).toFixed(1)), sd: Number(sd(rr).toFixed(1)), min: Number(Math.min(...rr).toFixed(1)), max: Number(Math.max(...rr).toFixed(1)), values: rr.map((v) => Number(v.toFixed(1))) };

  return {
    rrMs: rrStat,
    prMs: summarize(prValues),
    qrsMs: summarize(qrsValues),
    qtMs: summarize(qtValues),
    qtcMs: { mean: qtcValues.length ? Number(mean(qtcValues).toFixed(1)) : null, formula: 'Bazett' },
  };
}

function computeHrv(rrValues) {
  if (rrValues.length < 2) return { sdnnMs: null, rmssdMs: null, pnn50: null };
  const sdnnMs = sd(rrValues);
  const diffs = [];
  for (let i = 1; i < rrValues.length; i++) diffs.push(rrValues[i] - rrValues[i - 1]);
  const rmssdMs = Math.sqrt(mean(diffs.map((d) => d * d)));
  // hrv.js reports pnn50 as an already-computed 0-100 percentage.
  const pnn50 = (diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100;
  return {
    sdnnMs: Number(sdnnMs.toFixed(1)),
    rmssdMs: Number(rmssdMs.toFixed(1)),
    pnn50: Number(pnn50.toFixed(1)),
  };
}

function classifyRhythm(rrValues, beats) {
  const m = mean(rrValues);
  const cv = m > 0 ? sd(rrValues) / m : 0;
  const regular = cv < 0.10;
  const pFraction = beats.filter((b) => b.p !== null).length / beats.length;
  const hasConsistentP = pFraction >= 0.7;

  if (regular) {
    return hasConsistentP
      ? { regular: true, classification: 'sinus', note: `RR intervals are regular (sd/mean = ${(cv * 100).toFixed(1)}%) and a P wave precedes ${Math.round(pFraction * 100)}% of QRS complexes, consistent with sinus rhythm.` }
      : { regular: true, classification: 'indeterminate', note: `RR intervals are regular (sd/mean = ${(cv * 100).toFixed(1)}%) but a clear P wave could not be located before most QRS complexes, so sinus origin cannot be confirmed.` };
  }
  if (cv >= 0.20 && !hasConsistentP) {
    return { regular: false, classification: 'possible atrial fibrillation - irregularly irregular', note: `RR intervals vary widely with no discernible pattern (sd/mean = ${(cv * 100).toFixed(1)}%) and no consistent P wave was found before QRS complexes (${Math.round(pFraction * 100)}% of beats). This combination is suggestive of, but not diagnostic for, atrial fibrillation.` };
  }
  return { regular: false, classification: 'irregular', note: `RR intervals are irregular (sd/mean = ${(cv * 100).toFixed(1)}%). ${hasConsistentP ? 'P waves are present before most QRS complexes.' : 'P waves could not be consistently located.'}` };
}

function computeFlags({ bpm, intervals, rhythm, noisy }) {
  const flags = [];
  if (noisy) flags.push('low-signal-quality');
  if (bpm !== null) {
    if (bpm >= 100) flags.push('tachycardia');
    if (bpm < 60) flags.push('bradycardia');
  }
  if (intervals.qrsMs.mean !== null && intervals.qrsMs.mean > 120) flags.push('wide-QRS');
  if (intervals.qtcMs.mean !== null && intervals.qtcMs.mean > 450) flags.push('prolonged-QT');
  if (rhythm.regular === false) flags.push('irregular-rhythm');
  return flags;
}

// axis.degrees is always null in the current analyze.js: a single lead
// can't determine electrical axis (needs >=2 limb leads).
const AXIS_SINGLE_LEAD = { degrees: null, note: 'Axis calculation requires at least two limb leads (e.g. I and aVF); only a single lead was provided.' };

function buildHealthy() {
  const rng = mulberry32(42);
  const { samples, beats } = buildRecording({
    rng, rrBaseMs: 833, rrJitterMs: 18, pProbability: 1, tProbability: 1,
    noiseAmp: 0.006, baselineWanderAmp: 0.01,
  });
  const intervals = computeIntervals(beats, SAMPLING_RATE);
  const hrv = computeHrv(intervals.rrMs.values);
  const rhythm = classifyRhythm(intervals.rrMs.values, beats);
  const bpm = intervals.rrMs.mean ? Number((60000 / intervals.rrMs.mean).toFixed(1)) : null;
  const flags = computeFlags({ bpm, intervals, rhythm, noisy: false });

  const analysis = {
    ok: true,
    warnings: [],
    heartRate: { bpm, method: 'Pan-Tompkins', confidence: 0.93 },
    rhythm,
    beats,
    intervals,
    hrv,
    axis: AXIS_SINGLE_LEAD,
    flags,
  };

  const extraction = {
    ok: true,
    warnings: [],
    grid: { detected: true, smallBoxPx: 8.2, largeBoxPx: 41.0, pxPerMm: 8.2, mmPerSecond: 25, mmPerMV: 10 },
    calibration: { samplingRate: SAMPLING_RATE, mvPerUnit: 0.000806, source: 'grid' },
    roi: { x: 42, y: 58, width: 900, height: 260 },
    leads: [{ label: 'II', samples, quality: 0.91 }],
    debug: { overlay: 'fixtures/sample-overlay.svg' },
  };

  return { analysis, extraction };
}

function buildDegraded() {
  const rng = mulberry32(1337);
  const { samples, beats } = buildRecording({
    rng, rrBaseMs: 520, rrJitterMs: 140, pProbability: 0.25, tProbability: 0.65,
    noiseAmp: 0.045, baselineWanderAmp: 0.06,
  });
  const intervals = computeIntervals(beats, SAMPLING_RATE);
  const hrv = computeHrv(intervals.rrMs.values);
  const rhythm = classifyRhythm(intervals.rrMs.values, beats);
  const bpm = intervals.rrMs.mean ? Number((60000 / intervals.rrMs.mean).toFixed(1)) : null;
  const flags = computeFlags({ bpm, intervals, rhythm, noisy: true });

  const analysis = {
    ok: true,
    warnings: [
      'High noise-to-signal ratio detected after filtering; results may be unreliable.',
      'A clear P wave could not be located before most QRS complexes; PR interval is unreliable.',
    ],
    heartRate: { bpm, method: 'Pan-Tompkins', confidence: 0.42 },
    rhythm,
    beats,
    intervals,
    hrv,
    axis: AXIS_SINGLE_LEAD,
    flags,
  };

  const extraction = {
    ok: true,
    warnings: [
      'Grid lines faint in the lower-left quadrant of the photo.',
      'Perspective skew corrected with low confidence.',
    ],
    grid: { detected: false, smallBoxPx: null, largeBoxPx: null, pxPerMm: null, mmPerSecond: 25, mmPerMV: 10 },
    calibration: { samplingRate: SAMPLING_RATE, mvPerUnit: 0.00095, source: 'assumed' },
    roi: { x: 30, y: 70, width: 880, height: 300 },
    leads: [{ label: 'II', samples, quality: 0.42 }],
    debug: { overlay: null },
  };

  return { analysis, extraction };
}

const { writeFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const dir = fileURLToPath(new URL('.', import.meta.url));

const healthy = buildHealthy();
const degraded = buildDegraded();

writeFileSync(`${dir}healthy.json`, JSON.stringify(healthy, null, 2));
writeFileSync(`${dir}degraded.json`, JSON.stringify(degraded, null, 2));

console.log(`healthy: ${healthy.analysis.beats.length} beats, bpm=${healthy.analysis.heartRate.bpm}, rhythm=${healthy.analysis.rhythm.classification}, flags=${JSON.stringify(healthy.analysis.flags)}`);
console.log(`degraded: ${degraded.analysis.beats.length} beats, bpm=${degraded.analysis.heartRate.bpm}, rhythm=${degraded.analysis.rhythm.classification}, flags=${JSON.stringify(degraded.analysis.flags)}`);
