// Public entry point for the ECG analysis module. Orchestrates filtering,
// QRS detection, beat delineation, interval/HRV measurement, rhythm
// classification and flagging for a single calibrated 1-D lead.

import { preprocessSignal } from './filters.js';
import { detectQRS } from './qrs.js';
import { delineateBeat } from './delineate.js';
import { computeIntervals } from './intervals.js';
import { computeHRV } from './hrv.js';
import { classifyRhythm } from './rhythm.js';

const MIN_SAMPLES_FOR_ANALYSIS = 64;

function emptyResult(warnings, flags = [], ok = true) {
  return {
    ok,
    warnings,
    heartRate: { bpm: null, method: 'Pan-Tompkins', confidence: 0 },
    rhythm: { regular: null, classification: 'indeterminate', note: 'Insufficient signal to assess rhythm.' },
    beats: [],
    intervals: {
      rrMs: { mean: null, sd: null, min: null, max: null, values: [] },
      prMs: { mean: null, sd: null, n: 0 },
      qrsMs: { mean: null, sd: null, n: 0 },
      qtMs: { mean: null, sd: null, n: 0 },
      qtcMs: { mean: null, formula: 'Bazett' },
    },
    hrv: { sdnnMs: null, rmssdMs: null, pnn50: null },
    axis: { degrees: null, note: 'Axis calculation requires at least two limb leads; only a single lead was provided.' },
    flags,
  };
}

function toMv(rawValue, mvPerUnit) {
  if (rawValue === null || rawValue === undefined) return null;
  if (!mvPerUnit || !Number.isFinite(mvPerUnit) || mvPerUnit <= 0) return null;
  return rawValue * mvPerUnit;
}

function estimateNoiseRatio(raw, filtered) {
  const n = raw.length;
  if (n === 0) return 1;
  let residualSq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = raw[i] - filtered[i];
    residualSq += r * r;
    if (filtered[i] < min) min = filtered[i];
    if (filtered[i] > max) max = filtered[i];
  }
  const residualStd = Math.sqrt(residualSq / n);
  const range = Math.max(max - min, 1e-9);
  return residualStd / range;
}

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  return { min, max };
}

function buildPublicWave(wave, mvPerUnit) {
  if (!wave) return null;
  return {
    onset: wave.onset,
    peak: wave.peak,
    offset: wave.offset,
    amplitudeMv: toMv(wave.amplitude, mvPerUnit),
  };
}

/**
 * @param {number[]} samples
 * @param {number} samplingRate - Hz
 * @param {{ mvPerUnit?: number }} [options]
 */
export function analyzeLead(samples, samplingRate, options = {}) {
  const warnings = [];

  if (!Array.isArray(samples) || !Number.isFinite(samplingRate) || samplingRate <= 0) {
    warnings.push('Invalid input: samples must be an array and samplingRate must be a positive number.');
    return emptyResult(warnings, [], false);
  }

  if (samples.length < MIN_SAMPLES_FOR_ANALYSIS) {
    warnings.push(`Signal too short to analyze (${samples.length} samples, need at least ${MIN_SAMPLES_FOR_ANALYSIS}).`);
    return emptyResult(warnings, ['low-signal-quality']);
  }

  const durationSec = samples.length / samplingRate;
  if (durationSec < 2) {
    warnings.push(`Signal duration is only ${durationSec.toFixed(2)}s; measurements based on fewer than a couple of beats are unreliable.`);
  }

  const mvPerUnit = options.mvPerUnit;
  if (!mvPerUnit || !Number.isFinite(mvPerUnit) || mvPerUnit <= 0) {
    warnings.push('No valid mvPerUnit calibration provided; amplitude fields will be null.');
  }

  const flags = [];

  const { min: sampleMin, max: sampleMax } = minMax(samples);
  const range = sampleMax - sampleMin;
  if (!Number.isFinite(range) || range < 1e-9) {
    warnings.push('Signal appears flat (no meaningful variation); cannot detect any beats.');
    flags.push('low-signal-quality');
    return emptyResult(warnings, flags);
  }

  const filtered = preprocessSignal(samples, samplingRate);
  const noiseRatio = estimateNoiseRatio(samples, filtered);
  if (noiseRatio > 0.4) {
    warnings.push('High noise-to-signal ratio detected after filtering; results may be unreliable.');
    flags.push('low-signal-quality');
  }

  const { rIndices, searchBackCount } = detectQRS(filtered, samplingRate);

  if (rIndices.length === 0) {
    warnings.push('No QRS complexes detected.');
    if (!flags.includes('low-signal-quality')) flags.push('low-signal-quality');
    return emptyResult(warnings, flags);
  }

  if (rIndices.length < 3) {
    warnings.push(`Only ${rIndices.length} beat(s) detected; most statistics require more beats and will be null.`);
  }

  const internalBeats = rIndices.map((rIdx, i) => {
    const prevRIdx = i > 0 ? rIndices[i - 1] : null;
    const nextRIdx = i < rIndices.length - 1 ? rIndices[i + 1] : null;
    return delineateBeat(filtered, samplingRate, rIdx, prevRIdx, nextRIdx);
  });

  const intervals = computeIntervals(internalBeats, samplingRate);
  const hrv = computeHRV(intervals.rrMs.values);
  const rhythm = classifyRhythm(intervals.rrMs.values, internalBeats);

  const bpm = intervals.rrMs.mean ? 60000 / intervals.rrMs.mean : null;

  let confidence = 0.9;
  if (rIndices.length < 4) confidence -= 0.2;
  confidence -= Math.min(0.3, searchBackCount * 0.05);
  if (rhythm.regular === false) confidence -= 0.1;
  confidence -= Math.min(0.3, noiseRatio * 0.5);
  confidence = Math.max(0, Math.min(1, confidence));

  const beats = internalBeats.map((b, i) => ({
    index: i,
    tSec: b.rIndex / samplingRate,
    rIndex: b.rIndex,
    p: buildPublicWave(b.p, mvPerUnit),
    q: b.qIdx !== null ? { index: b.qIdx, amplitudeMv: toMv(filtered[b.qIdx], mvPerUnit) } : null,
    r: { index: b.rIndex, amplitudeMv: toMv(filtered[b.rIndex], mvPerUnit) },
    s: b.sIdx !== null ? { index: b.sIdx, amplitudeMv: toMv(filtered[b.sIdx], mvPerUnit) } : null,
    t: buildPublicWave(b.t, mvPerUnit),
  }));

  if (bpm !== null) {
    if (bpm >= 100) flags.push('tachycardia');
    if (bpm < 60) flags.push('bradycardia');
  }
  if (intervals.qrsMs.mean !== null && intervals.qrsMs.mean > 120) {
    flags.push('wide-QRS');
  }
  if (intervals.qtcMs.mean !== null && intervals.qtcMs.mean > 450) {
    flags.push('prolonged-QT');
  }
  if (rhythm.regular === false) {
    flags.push('irregular-rhythm');
  }

  return {
    ok: true,
    warnings,
    heartRate: { bpm, method: 'Pan-Tompkins', confidence },
    rhythm,
    beats,
    intervals,
    hrv,
    axis: { degrees: null, note: 'Axis calculation requires at least two limb leads (e.g. I and aVF); only a single lead was provided.' },
    flags,
  };
}
