// Pan-Tompkins QRS detector: bandpass -> derivative -> square -> moving
// window integration -> adaptive dual-threshold peak detection with
// search-back for missed beats and T-wave discrimination.

import { designBiquad, filtfilt, movingAverage } from './filters.js';

/** 5-15 Hz bandpass tuned for QRS energy, built from cascaded biquads. */
function bandpass(signal, samplingRate) {
  const hp = designBiquad('highpass', 5, samplingRate, 0.707);
  const lp = designBiquad('lowpass', 15, samplingRate, 0.707);
  return filtfilt(filtfilt(signal, hp), lp);
}

/** Causal 5-point derivative approximation used by Pan-Tompkins. */
function derivative(signal) {
  const out = new Array(signal.length).fill(0);
  for (let n = 4; n < signal.length; n++) {
    out[n] = (2 * signal[n] + signal[n - 1] - signal[n - 3] - 2 * signal[n - 4]) / 8;
  }
  return out;
}

function square(signal) {
  return signal.map((v) => v * v);
}

/**
 * Detect QRS complexes (R peaks) in a preprocessed ECG signal.
 * @returns {{ rIndices: number[], integrated: number[], filtered: number[], searchBackCount: number }}
 */
export function detectQRS(signal, samplingRate) {
  const n = signal.length;
  if (n < samplingRate * 0.5) {
    return { rIndices: [], integrated: [], filtered: signal.slice(), searchBackCount: 0 };
  }

  const filtered = bandpass(signal, samplingRate);
  const deriv = derivative(filtered);
  const squared = square(deriv);
  const integrationWindow = Math.max(1, Math.round(0.15 * samplingRate));
  const integrated = movingAverage(squared, integrationWindow);

  const refractorySamples = Math.round(0.2 * samplingRate);
  const rrLimitLow = Math.round(0.2 * samplingRate); // physiological floor (~300bpm)

  // Adaptive thresholds (SPKI = signal peak level, NPKI = noise peak level).
  const initialWindow = integrated.slice(0, Math.min(integrated.length, samplingRate * 2));
  let initMax = 0;
  let initSum = 0;
  for (const v of initialWindow) {
    if (v > initMax) initMax = v;
    initSum += v;
  }
  const initMean = initSum / (initialWindow.length || 1);
  let SPKI = initMax * 0.5 || 1e-6;
  let NPKI = initMean * 0.5 || 1e-9;
  let thresholdI1 = NPKI + 0.25 * (SPKI - NPKI);
  let thresholdI2 = 0.5 * thresholdI1;

  const peaks = [];
  const rrHistory = [];
  let searchBackCount = 0;
  let lastPeakIdx = -Infinity;

  const localPeaks = findLocalMaxima(integrated);

  let i = 0;
  while (i < localPeaks.length) {
    const idx = localPeaks[i];
    const amp = integrated[idx];

    if (idx - lastPeakIdx < refractorySamples) {
      i++;
      continue;
    }

    if (amp > thresholdI1) {
      peaks.push(idx);
      SPKI = 0.125 * amp + 0.875 * SPKI;
      lastPeakIdx = idx;
      updateRRHistory(rrHistory, peaks, samplingRate, rrLimitLow);
    } else {
      // Search-back: if we've missed an expected beat given recent RR
      // rhythm, rescan the gap with the lower threshold.
      const avgRR = rrHistory.length ? rrHistory.reduce((a, b) => a + b, 0) / rrHistory.length : null;
      if (avgRR && idx - lastPeakIdx > 1.66 * avgRR) {
        const backIdx = findBestInRange(integrated, lastPeakIdx + refractorySamples, idx, thresholdI2);
        if (backIdx !== -1) {
          peaks.push(backIdx);
          SPKI = 0.25 * integrated[backIdx] + 0.75 * SPKI;
          lastPeakIdx = backIdx;
          searchBackCount++;
          updateRRHistory(rrHistory, peaks, samplingRate, rrLimitLow);
          continue; // re-evaluate current idx next loop without advancing i's noise update
        }
      }
      NPKI = 0.125 * amp + 0.875 * NPKI;
    }

    thresholdI1 = NPKI + 0.25 * (SPKI - NPKI);
    thresholdI2 = 0.5 * thresholdI1;
    i++;
  }

  const rIndices = refineRPeaks(peaks, filtered, samplingRate);
  const deduped = dedupeClose(rIndices, refractorySamples);

  return { rIndices: deduped, integrated, filtered, searchBackCount };
}

function findLocalMaxima(signal) {
  const peaks = [];
  for (let n = 1; n < signal.length - 1; n++) {
    if (signal[n] > signal[n - 1] && signal[n] >= signal[n + 1] && signal[n] > 0) {
      peaks.push(n);
    }
  }
  return peaks;
}

function findBestInRange(signal, lo, hi, minAmp) {
  let bestIdx = -1;
  let bestVal = -Infinity;
  for (let n = Math.max(0, lo); n < Math.min(signal.length, hi); n++) {
    if (signal[n] > minAmp && signal[n] > bestVal) {
      bestVal = signal[n];
      bestIdx = n;
    }
  }
  return bestIdx;
}

function updateRRHistory(rrHistory, peaks, samplingRate, rrLimitLow) {
  if (peaks.length < 2) return;
  const rr = peaks[peaks.length - 1] - peaks[peaks.length - 2];
  if (rr >= rrLimitLow) {
    rrHistory.push(rr);
    if (rrHistory.length > 8) rrHistory.shift();
  }
}

/**
 * The integration-stage peak lags the true R peak due to the derivative and
 * window smoothing. Refine each index by finding the max-magnitude sample
 * in the bandpassed signal within a small local window.
 */
function refineRPeaks(peaks, filtered, samplingRate) {
  const searchRadius = Math.round(0.075 * samplingRate);
  return peaks.map((idx) => {
    const lo = Math.max(0, idx - searchRadius);
    const hi = Math.min(filtered.length - 1, idx + searchRadius);
    let bestIdx = idx;
    let bestVal = -Infinity;
    for (let n = lo; n <= hi; n++) {
      const v = Math.abs(filtered[n]);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = n;
      }
    }
    return bestIdx;
  });
}

function dedupeClose(indices, minGap) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out = [];
  for (const idx of sorted) {
    if (out.length === 0 || idx - out[out.length - 1] >= minGap) {
      out.push(idx);
    }
  }
  return out;
}
