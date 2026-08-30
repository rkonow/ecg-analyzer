// Heart-rate variability metrics computed from RR interval values (ms).

export function computeHRV(rrValuesMs) {
  if (rrValuesMs.length < 2) {
    return { sdnnMs: null, rmssdMs: null, pnn50: null };
  }

  const mean = rrValuesMs.reduce((a, b) => a + b, 0) / rrValuesMs.length;
  const variance = rrValuesMs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rrValuesMs.length;
  const sdnnMs = Math.sqrt(variance);

  const diffs = [];
  for (let i = 1; i < rrValuesMs.length; i++) {
    diffs.push(rrValuesMs[i] - rrValuesMs[i - 1]);
  }

  let rmssdMs = null;
  let pnn50 = null;
  if (diffs.length > 0) {
    const sqSum = diffs.reduce((s, d) => s + d * d, 0);
    rmssdMs = Math.sqrt(sqSum / diffs.length);
    const nn50 = diffs.filter((d) => Math.abs(d) > 50).length;
    pnn50 = (nn50 / diffs.length) * 100;
  }

  return { sdnnMs, rmssdMs, pnn50 };
}
