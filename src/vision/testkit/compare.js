// Ground-truth comparison helpers for the dev.html self-test harness.

export function pearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= n; meanB /= n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den < 1e-9 ? 0 : num / den;
}

export function rmse(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum / n);
}

function resampleAt(values, srcRate, dstTimes) {
  const out = new Float32Array(dstTimes.length);
  const n = values.length;
  for (let i = 0; i < dstTimes.length; i++) {
    const idx = dstTimes[i] * srcRate;
    const i0 = Math.floor(idx);
    const i1 = i0 + 1;
    const f = idx - i0;
    const v0 = i0 >= 0 && i0 < n ? values[i0] : 0;
    const v1 = i1 >= 0 && i1 < n ? values[i1] : v0;
    out[i] = v0 + (v1 - v0) * f;
  }
  return out;
}

// Searches for the time-shift (within +-maxShiftSec) that best aligns the
// recovered series against the dense ground-truth series, since the ROI
// origin does not necessarily correspond to ground-truth t=0. Returns the
// best Pearson correlation, matching RMSE (after z-scoring both to remove
// unknown scale/offset), and the shift used.
export function bestAlignedMatch(recovered, recoveredRate, gtValues, gtRate, maxShiftSec = 2) {
  const n = recovered.length;
  const stepSec = 1 / recoveredRate;
  let best = { corr: -Infinity, shiftSec: 0 };
  const shiftSteps = Math.round((maxShiftSec * 2) / stepSec);
  for (let s = 0; s <= shiftSteps; s++) {
    const shiftSec = -maxShiftSec + s * stepSec;
    const times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = shiftSec + i * stepSec;
    // resampleAt zero-pads samples outside the ground-truth range, so a
    // candidate window that slightly overhangs either end is still scored
    // (just penalized at the overhanging edge) rather than skipped outright.
    const segment = resampleAt(gtValues, gtRate, times);
    const corr = pearsonCorrelation(recovered, segment);
    if (corr > best.corr) best = { corr, shiftSec, segment };
  }
  if (best.corr === -Infinity) return { corr: 0, shiftSec: 0, rmseZ: Infinity, segment: new Float32Array(n) };

  const z = (arr) => {
    let m = 0; for (let i = 0; i < arr.length; i++) m += arr[i]; m /= arr.length;
    let v = 0; for (let i = 0; i < arr.length; i++) v += (arr[i] - m) * (arr[i] - m);
    const sd = Math.sqrt(v / arr.length) || 1;
    return Array.from(arr, (x) => (x - m) / sd);
  };
  const rmseZ = rmse(z(recovered), z(best.segment));

  return { corr: best.corr, shiftSec: best.shiftSec, rmseZ, segment: best.segment };
}
