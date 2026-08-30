// DSP filter primitives implemented from scratch: biquad IIR filters (RBJ
// Audio EQ Cookbook design equations), a zero-phase forward-backward
// filtfilt wrapper, and a median-filter cascade for baseline wander removal.

/**
 * Design a single biquad (2nd order IIR) section.
 * @param {'lowpass'|'highpass'|'notch'} type
 * @param {number} freq - corner/center frequency in Hz
 * @param {number} samplingRate - Hz
 * @param {number} Q - quality factor
 */
export function designBiquad(type, freq, samplingRate, Q = 0.707) {
  const nyquist = samplingRate / 2;
  const f = Math.min(Math.max(freq, 0.0001), nyquist * 0.999);
  const w0 = (2 * Math.PI * f) / samplingRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  if (type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (type === 'notch') {
    b0 = 1;
    b1 = -2 * cosw0;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else {
    throw new Error(`Unknown biquad type: ${type}`);
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** Apply a biquad section to a signal in one causal (forward) pass. */
export function applyBiquad(signal, coeffs) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const out = new Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < signal.length; n++) {
    const x0 = signal[n];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[n] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

/**
 * Zero-phase filtering: filter forward, reverse, filter again, reverse back.
 * Cancels the phase delay a single causal biquad pass introduces, which
 * matters for preserving true onset/offset sample locations.
 */
export function filtfilt(signal, coeffs) {
  const forward = applyBiquad(signal, coeffs);
  const reversed = forward.slice().reverse();
  const backward = applyBiquad(reversed, coeffs);
  return backward.reverse();
}

/** Zero-phase low-pass Butterworth-style biquad (~40 Hz default). */
export function lowPassFilter(signal, samplingRate, cutoffHz = 40, Q = 0.707) {
  const coeffs = designBiquad('lowpass', cutoffHz, samplingRate, Q);
  return filtfilt(signal, coeffs);
}

/** Zero-phase high-pass biquad (~0.5 Hz default) for baseline wander. */
export function highPassFilter(signal, samplingRate, cutoffHz = 0.5, Q = 0.707) {
  const coeffs = designBiquad('highpass', cutoffHz, samplingRate, Q);
  return filtfilt(signal, coeffs);
}

/** Zero-phase notch biquad for powerline hum (50 or 60 Hz). */
export function notchFilter(signal, samplingRate, centerHz = 50, Q = 30) {
  if (centerHz >= samplingRate / 2) return signal.slice();
  const coeffs = designBiquad('notch', centerHz, samplingRate, Q);
  return filtfilt(signal, coeffs);
}

/** Simple moving-average filter (used inside QRS integration stage). */
export function movingAverage(signal, windowSize) {
  const w = Math.max(1, Math.round(windowSize));
  const out = new Array(signal.length);
  let sum = 0;
  for (let n = 0; n < signal.length; n++) {
    sum += signal[n];
    if (n >= w) sum -= signal[n - w];
    out[n] = sum / Math.min(n + 1, w);
  }
  return out;
}

/** 1-D median filter with a symmetric odd-length window. */
export function medianFilter(signal, windowSize) {
  const half = Math.max(1, Math.round(windowSize / 2));
  const out = new Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    const lo = Math.max(0, n - half);
    const hi = Math.min(signal.length - 1, n + half);
    const window = signal.slice(lo, hi + 1).slice().sort((a, b) => a - b);
    out[n] = window[Math.floor(window.length / 2)];
  }
  return out;
}

/**
 * Baseline wander removal via a two-stage median filter cascade (classic
 * ECG technique: ~200ms window removes P/QRS/T, ~600ms window removes
 * residual ripple, producing a baseline estimate that is subtracted out).
 */
export function removeBaselineWander(signal, samplingRate) {
  const w1 = Math.max(3, Math.round(0.2 * samplingRate));
  const w2 = Math.max(3, Math.round(0.6 * samplingRate));
  const stage1 = medianFilter(signal, w1);
  const baseline = medianFilter(stage1, w2);
  return signal.map((v, i) => v - baseline[i]);
}

/**
 * Full preprocessing pipeline: baseline wander removal, powerline notch,
 * then a gentle low-pass to attenuate high-frequency noise.
 */
export function preprocessSignal(signal, samplingRate, options = {}) {
  const { powerlineHz = 50, lowPassHz = 40, highPassHz = 0.5 } = options;
  let out = removeBaselineWander(signal, samplingRate);
  out = highPassFilter(out, samplingRate, highPassHz);
  if (powerlineHz > 0 && powerlineHz < samplingRate / 2) {
    out = notchFilter(out, samplingRate, powerlineHz, 30);
  }
  out = lowPassFilter(out, samplingRate, lowPassHz);
  return out;
}
