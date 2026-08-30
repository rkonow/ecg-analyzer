// Synthetic ECG generator for verification only (not part of the public
// analysis API). Builds a lead from raised-cosine P/QRS/T pulses with
// explicit onset/peak/offset timing so ground-truth PR/QRS/QT intervals are
// known exactly, plus optional baseline wander, powerline hum, white noise
// and RR jitter to stress the pipeline like a photo-derived signal would.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRng(rng) {
  let spare = null;
  return function () {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u, v, s;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

function raisedCosinePulse(tMs, onset, peak, offset, amp) {
  if (tMs < onset || tMs > offset || peak <= onset || offset <= peak) return 0;
  if (tMs < peak) {
    const frac = (tMs - onset) / (peak - onset);
    return amp * 0.5 * (1 - Math.cos(Math.PI * frac));
  }
  const frac = (tMs - peak) / (offset - peak);
  return amp * 0.5 * (1 + Math.cos(Math.PI * frac));
}

function qrsComplex(tMs, qrsOnset, qPeak, sPeak, qrsOffset, qAmp, rAmp, sAmp) {
  if (tMs < qrsOnset || tMs > qrsOffset) return 0;
  if (tMs < qPeak) {
    const frac = (tMs - qrsOnset) / (qPeak - qrsOnset);
    return qAmp * 0.5 * (1 - Math.cos(Math.PI * frac));
  }
  if (tMs < 0) {
    const frac = (tMs - qPeak) / (0 - qPeak);
    return qAmp + (rAmp - qAmp) * 0.5 * (1 - Math.cos(Math.PI * frac));
  }
  if (tMs < sPeak) {
    const frac = tMs / sPeak;
    return rAmp + (sAmp - rAmp) * 0.5 * (1 - Math.cos(Math.PI * frac));
  }
  const frac = (tMs - sPeak) / (qrsOffset - sPeak);
  return sAmp * 0.5 * (1 + Math.cos(Math.PI * frac));
}

/**
 * @returns {{ samples: number[], samplingRate: number, groundTruth: object }}
 */
export function generateSyntheticECG(config = {}) {
  const {
    samplingRate = 250,
    durationSec = 10,
    heartRateBpm = 75,
    rrJitterMs = 0,
    prMs = 160,
    qrsMs = 90,
    qtMs = 380,
    pAmplitudeMv = 0.15,
    pDurationMs = 100,
    qAmplitudeMv = -0.1,
    rAmplitudeMv = 1.2,
    sAmplitudeMv = -0.2,
    tAmplitudeMv = 0.3,
    baselineWanderHz = 0.3,
    baselineWanderMv = 0,
    powerlineHz = 50,
    powerlineMv = 0,
    noiseStdMv = 0,
    seed = 12345,
  } = config;

  const rng = mulberry32(seed);
  const gauss = gaussianRng(rng);

  const rrNominalMs = 60000 / heartRateBpm;
  const qrsOnsetMs = -qrsMs / 2;
  const qrsOffsetMs = qrsMs / 2;
  const qPeakMs = qrsOnsetMs + qrsMs * 0.22;
  const sPeakMs = qrsOffsetMs * 0.35;

  const remainderMs = Math.max(qtMs - qrsMs, 40);
  const stSegmentMs = remainderMs * 0.25;
  const tDurationMs = remainderMs * 0.75;
  const tOnsetMs = qrsOffsetMs + stSegmentMs;
  const tPeakMs = tOnsetMs + tDurationMs * 0.4;
  const tOffsetMs = tOnsetMs + tDurationMs;

  const pOnsetMs = qrsOnsetMs - prMs;
  const pPeakMs = pOnsetMs + pDurationMs * 0.4;
  const pEndMs = pOnsetMs + pDurationMs;

  const rTimesMs = [];
  let tCursorMs = rrNominalMs; // lead-in so the first beat has a full PR segment before it
  const durationMs = durationSec * 1000;
  while (tCursorMs < durationMs) {
    rTimesMs.push(tCursorMs);
    const jitter = rrJitterMs > 0 ? gauss() * rrJitterMs : 0;
    const rr = Math.max(300, rrNominalMs + jitter);
    tCursorMs += rr;
  }

  const nSamples = Math.round(durationSec * samplingRate);
  const samples = new Array(nSamples).fill(0);
  const beatWindowMs = Math.min(rrNominalMs * 0.9, 700);

  for (let n = 0; n < nSamples; n++) {
    const tMs = (n / samplingRate) * 1000;
    let value = 0;

    for (const rMs of rTimesMs) {
      const dt = tMs - rMs;
      if (Math.abs(dt) > beatWindowMs) continue;
      value += qrsComplex(dt, qrsOnsetMs, qPeakMs, sPeakMs, qrsOffsetMs, qAmplitudeMv, rAmplitudeMv, sAmplitudeMv);
      value += raisedCosinePulse(dt, pOnsetMs, pPeakMs, pEndMs, pAmplitudeMv);
      value += raisedCosinePulse(dt, tOnsetMs, tPeakMs, tOffsetMs, tAmplitudeMv);
    }

    if (baselineWanderMv > 0) {
      value += baselineWanderMv * Math.sin(2 * Math.PI * baselineWanderHz * (tMs / 1000) + 0.7);
    }
    if (powerlineMv > 0) {
      value += powerlineMv * Math.sin(2 * Math.PI * powerlineHz * (tMs / 1000));
    }
    if (noiseStdMv > 0) {
      value += gauss() * noiseStdMv;
    }

    samples[n] = value;
  }

  return {
    samples,
    samplingRate,
    groundTruth: {
      heartRateBpm,
      rrNominalMs,
      beatCount: rTimesMs.length,
      rTimesMs,
      prMs,
      qrsMs,
      qtMs,
      pAmplitudeMv,
      qAmplitudeMv,
      rAmplitudeMv,
      sAmplitudeMv,
      tAmplitudeMv,
    },
  };
}
