// Per-beat wave delineation: Q/S as adjacent minima around each R peak, and
// P/T located by a windowed search (sized relative to the local RR interval)
// with an area/derivative-style onset-offset rule based on threshold
// crossings of the deviation from a locally estimated isoelectric baseline.
// Any wave that cannot be confidently located is returned as null rather
// than guessed.

const QRS_SEARCH_MS = 100; // max distance to look for Q/S from R
const ONSET_THRESHOLD_FRACTION = 0.18; // fraction of peak deviation defining onset/offset
const SNR_GATE = 2.5; // peak deviation must exceed this multiple of local noise std

function clampIdx(n, len) {
  return Math.max(0, Math.min(len - 1, n));
}

function segmentStats(signal, lo, hi) {
  const a = clampIdx(Math.round(lo), signal.length);
  const b = clampIdx(Math.round(hi), signal.length);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const seg = signal.slice(start, end + 1);
  if (seg.length === 0) return { median: 0, std: 0 };
  const sorted = seg.slice().sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = seg.reduce((s, v) => s + v, 0) / seg.length;
  const variance = seg.reduce((s, v) => s + (v - mean) * (v - mean), 0) / seg.length;
  return { median, std: Math.sqrt(variance) };
}

/** Find the adjacent minimum after (dir=+1) or before (dir=-1) idx0. */
function findAdjacentMinimum(signal, idx0, dir, maxSamples) {
  let bestIdx = -1;
  let bestVal = Infinity;
  const limit = clampIdx(idx0 + dir * maxSamples, signal.length);
  for (let n = idx0 + dir; dir > 0 ? n <= limit : n >= limit; n += dir) {
    if (n <= 0 || n >= signal.length - 1) break;
    const isLocalMin = signal[n] <= signal[n - 1] && signal[n] <= signal[n + 1];
    if (isLocalMin && signal[n] < signal[idx0]) {
      if (signal[n] < bestVal) {
        bestVal = signal[n];
        bestIdx = n;
      }
      break; // first local minimum encountered walking away from R
    }
    if (signal[n] > signal[idx0]) break; // signal is rising away from R, no trough found
  }
  return bestIdx === -1 ? null : bestIdx;
}

/**
 * Search [lo, hi] for the sample with maximum |deviation| from baseline.
 * Rejects extrema that touch the window edge (truncated, unreliable).
 */
function findPeakInWindow(signal, lo, hi, baseline) {
  const a = clampIdx(Math.round(lo), signal.length);
  const b = clampIdx(Math.round(hi), signal.length);
  if (b - a < 4) return null;
  let bestIdx = -1;
  let bestDev = 0;
  for (let n = a + 1; n < b; n++) {
    const dev = signal[n] - baseline;
    if (Math.abs(dev) > Math.abs(bestDev)) {
      bestDev = dev;
      bestIdx = n;
    }
  }
  if (bestIdx === -1 || bestIdx === a + 1 || bestIdx === b - 1) return null;
  return { idx: bestIdx, deviation: bestDev };
}

/** Walk from peakIdx toward limitIdx until |dev| falls below the threshold. */
function findBoundary(signal, peakIdx, baseline, peakDeviation, dir, limitIdx) {
  const threshold = Math.abs(peakDeviation) * ONSET_THRESHOLD_FRACTION;
  let n = peakIdx;
  while (dir > 0 ? n <= limitIdx : n >= limitIdx) {
    const dev = Math.abs(signal[n] - baseline);
    if (dev < threshold) return n;
    n += dir;
  }
  return null; // never returned to baseline within the search window
}

function delineatePWave(signal, samplingRate, rIdx, qrsOnsetIdx, windowStartIdx) {
  const searchHi = qrsOnsetIdx !== null ? qrsOnsetIdx - Math.round(0.02 * samplingRate) : rIdx - Math.round(0.05 * samplingRate);
  const searchLo = windowStartIdx;
  if (searchHi - searchLo < Math.round(0.03 * samplingRate)) return null;

  const baselineSeg = segmentStats(signal, searchLo, searchLo + Math.round(0.04 * samplingRate));
  const { median: baseline, std: noise } = baselineSeg;

  const found = findPeakInWindow(signal, searchLo, searchHi, baseline);
  if (!found) return null;
  if (Math.abs(found.deviation) < SNR_GATE * Math.max(noise, 1e-9)) return null;

  const onset = findBoundary(signal, found.idx, baseline, found.deviation, -1, searchLo);
  const offset = findBoundary(signal, found.idx, baseline, found.deviation, +1, searchHi);
  if (onset === null || offset === null) return null;

  return { onset, peak: found.idx, offset, amplitude: found.deviation };
}

function delineateTWave(signal, samplingRate, rIdx, qrsOffsetIdx, windowEndIdx) {
  const searchLo = qrsOffsetIdx !== null ? qrsOffsetIdx + Math.round(0.02 * samplingRate) : rIdx + Math.round(0.05 * samplingRate);
  const searchHi = windowEndIdx;
  if (searchHi - searchLo < Math.round(0.05 * samplingRate)) return null;

  const baselineSeg = segmentStats(signal, searchLo, searchLo + Math.round(0.03 * samplingRate));
  const { median: baseline, std: noise } = baselineSeg;

  const found = findPeakInWindow(signal, searchLo, searchHi, baseline);
  if (!found) return null;
  if (Math.abs(found.deviation) < SNR_GATE * Math.max(noise, 1e-9)) return null;

  const onset = findBoundary(signal, found.idx, baseline, found.deviation, -1, searchLo);
  const offset = findBoundary(signal, found.idx, baseline, found.deviation, +1, searchHi);
  if (onset === null || offset === null) return null;

  return { onset, peak: found.idx, offset, amplitude: found.deviation };
}

/**
 * Delineate one beat around R index `rIdx`. `prevRIdx`/`nextRIdx` (or null
 * at record boundaries) provide local RR context to size the P/T search
 * windows. Returns raw-signal-unit amplitudes; mV conversion happens in
 * analyze.js. Includes internal (non-public) qrsOnsetIdx/qrsOffsetIdx used
 * by intervals.js for QRS/QT duration measurement.
 */
export function delineateBeat(signal, samplingRate, rIdxIn, prevRIdx, nextRIdx) {
  // The incoming rIdx was located on the QRS module's internal Pan-Tompkins
  // bandpass signal, which can differ by a sample or two from this
  // (differently filtered) delineation signal. Snap to the true local max
  // here so Q/S search directions are consistent with `signal` itself.
  const snapWindow = Math.max(1, Math.round(0.02 * samplingRate));
  let rIdx = rIdxIn;
  let rVal = signal[rIdxIn];
  for (let n = Math.max(0, rIdxIn - snapWindow); n <= Math.min(signal.length - 1, rIdxIn + snapWindow); n++) {
    if (signal[n] > rVal) {
      rVal = signal[n];
      rIdx = n;
    }
  }

  const maxQS = Math.round((QRS_SEARCH_MS / 1000) * samplingRate);
  const qIdx = findAdjacentMinimum(signal, rIdx, -1, maxQS);
  const sIdx = findAdjacentMinimum(signal, rIdx, +1, maxQS);

  const prevRR = prevRIdx !== null ? rIdx - prevRIdx : null;
  const nextRR = nextRIdx !== null ? nextRIdx - rIdx : null;
  const refRR = prevRR || nextRR || Math.round(0.8 * samplingRate);

  // QRS onset/offset: walk from Q/R and S/R back toward baseline. The
  // threshold is relative to the anchor point's own deflection (Q's depth,
  // or R's height when no Q was found) rather than always R, since Q/S are
  // usually much smaller than R and would otherwise already read as
  // "below threshold" at their own sample.
  const qBaseSeg = segmentStats(signal, rIdx - Math.round(0.32 * refRR), rIdx - Math.round(0.28 * refRR));
  const qrsOnsetStart = qIdx !== null ? qIdx : rIdx;
  const qrsOnsetLimit = clampIdx(rIdx - Math.min(maxQS, Math.round(0.45 * refRR)), signal.length);
  const qrsOnsetIdx = findBoundary(
    signal,
    qrsOnsetStart,
    qBaseSeg.median,
    signal[qrsOnsetStart] - qBaseSeg.median,
    -1,
    qrsOnsetLimit
  );

  const sBaseSeg = segmentStats(signal, rIdx + Math.round(0.1 * refRR), rIdx + Math.round(0.16 * refRR));
  const qrsOffsetStart = sIdx !== null ? sIdx : rIdx;
  const qrsOffsetLimit = clampIdx(rIdx + Math.min(maxQS, Math.round(0.45 * refRR)), signal.length);
  const qrsOffsetIdx = findBoundary(
    signal,
    qrsOffsetStart,
    sBaseSeg.median,
    signal[qrsOffsetStart] - sBaseSeg.median,
    +1,
    qrsOffsetLimit
  );

  const pWindowStart = clampIdx(rIdx - Math.min(Math.round(0.45 * refRR), Math.round(0.35 * samplingRate)), signal.length);
  const p = delineatePWave(signal, samplingRate, rIdx, qrsOnsetIdx, pWindowStart);

  const tWindowEnd = clampIdx(rIdx + Math.min(Math.round(0.65 * refRR), Math.round(0.45 * samplingRate)), signal.length);
  const t = delineateTWave(signal, samplingRate, rIdx, qrsOffsetIdx, tWindowEnd);

  return {
    index: rIdx,
    rIndex: rIdx,
    qIdx,
    sIdx,
    qrsOnsetIdx,
    qrsOffsetIdx,
    p,
    t,
  };
}
