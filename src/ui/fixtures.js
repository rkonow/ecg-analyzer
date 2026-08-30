// Contract-shaped fixture data. Used as a fallback when src/vision/extract.js
// or src/analysis/analyze.js aren't available yet (or throw), so the app
// pipeline is runnable end to end before those modules land.
//
// Shapes mirror the module contracts exactly:
//   extractTraces(imageData, options) -> see src/vision/extract.js
//   analyzeLead(samples, samplingRate, options) -> see src/analysis/analyze.js

const LEAD_LABELS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

// Synthesizes a plausible-looking single-lead waveform (sum of Gaussian
// bumps per beat) so the fixture renders something waveform-shaped rather
// than a flat line.
function synthesizeLeadSamples(samplingRate, durationSec, bpm) {
  const n = Math.round(samplingRate * durationSec);
  const samples = new Array(n).fill(0);
  const beatIntervalSec = 60 / bpm;

  const bumps = [
    { offsetSec: -0.16, amplitude: 0.1, widthSec: 0.025 }, // P
    { offsetSec: -0.02, amplitude: -0.1, widthSec: 0.01 }, // Q
    { offsetSec: 0, amplitude: 1.2, widthSec: 0.018 }, // R
    { offsetSec: 0.03, amplitude: -0.25, widthSec: 0.012 }, // S
    { offsetSec: 0.28, amplitude: 0.22, widthSec: 0.06 }, // T
  ];

  for (let i = 0; i < n; i++) {
    const t = i / samplingRate;
    let v = 0;
    const nearestBeat = Math.round(t / beatIntervalSec);
    const beatCenter = nearestBeat * beatIntervalSec;
    for (const bump of bumps) {
      const dt = t - (beatCenter + bump.offsetSec);
      v += bump.amplitude * Math.exp(-(dt * dt) / (2 * bump.widthSec * bump.widthSec));
    }
    v += (Math.random() - 0.5) * 0.015; // baseline noise
    samples[i] = Number(v.toFixed(4));
  }
  return samples;
}

export function extractTraces(imageData, options = {}) {
  const samplingRate = options.samplingRateHz || 500;
  const paperSpeed = options.paperSpeedMmPerSec || 25;
  const gain = options.gainMmPerMv || 10;
  const width = (imageData && imageData.width) || 800;
  const height = (imageData && imageData.height) || 400;

  const leads = LEAD_LABELS.slice(0, 3).map((label, i) => ({
    label,
    samples: synthesizeLeadSamples(samplingRate, 10, 72 + i * 2),
    quality: 0.5,
  }));

  return {
    ok: true,
    warnings: [
      "Vision module unavailable — showing placeholder fixture data, not a real trace extraction.",
    ],
    grid: {
      detected: false,
      smallBoxPx: null,
      largeBoxPx: null,
      pxPerMm: null,
      mmPerSecond: paperSpeed,
      mmPerMV: gain,
    },
    calibration: {
      samplingRate,
      mvPerUnit: 1,
      source: "fixture",
    },
    roi: { x: 0, y: 0, width, height },
    leads,
    debug: { overlay: null },
  };
}

export function analyzeLead(samples, samplingRate, options = {}) {
  const rate = samplingRate || (options && options.samplingRateHz) || 500;
  const n = Array.isArray(samples) ? samples.length : Math.round(rate * 10);
  const durationSec = n / rate;
  const bpm = 74;
  const rrMs = 60000 / bpm;
  const beatCount = Math.max(1, Math.floor(durationSec / (rrMs / 1000)));

  const beats = Array.from({ length: beatCount }, (_, i) => {
    const tSec = i * (rrMs / 1000);
    const rIndex = Math.min(n - 1, Math.round(tSec * rate));
    return {
      index: i,
      tSec: Number(tSec.toFixed(3)),
      rIndex,
      p: Math.max(0, rIndex - Math.round(0.16 * rate)),
      q: Math.max(0, rIndex - Math.round(0.02 * rate)),
      r: rIndex,
      s: Math.min(n - 1, rIndex + Math.round(0.03 * rate)),
      t: Math.min(n - 1, rIndex + Math.round(0.28 * rate)),
    };
  });

  return {
    ok: true,
    warnings: [
      "Analysis module unavailable — showing placeholder fixture data, not a real analysis.",
    ],
    heartRate: { bpm, method: "fixture", confidence: 0.3 },
    rhythm: {
      regular: true,
      classification: "unknown",
      note: "Placeholder fixture — no real rhythm classification performed.",
    },
    beats,
    intervals: {
      rrMs: { mean: rrMs, sd: 12, min: rrMs - 20, max: rrMs + 20, values: beats.map(() => rrMs) },
      prMs: { mean: 160, sd: 10, n: beatCount },
      qrsMs: { mean: 90, sd: 8, n: beatCount },
      qtMs: { mean: 380, sd: 15, n: beatCount },
      qtcMs: { mean: 410, formula: "Bazett" },
    },
    hrv: { sdnnMs: 35, rmssdMs: 28, pnn50: 0.1 },
    axis: { degrees: 60, note: "Placeholder fixture axis estimate." },
    flags: ["fixture-data"],
  };
}
