import { median, mean, resampleLinear, clamp } from './utils.js';

const DEFAULT_SAMPLING_RATE = 250;
const STANDARD_RATES = [500, 360, 250, 180, 120, 100];
const ASSUMED_PEAK_TO_PEAK_MV = 1.5; // typical lead II physiological span, clearly flagged as a guess

function chooseSamplingRate(nativeColsPerSecond) {
  for (const s of STANDARD_RATES) {
    if (nativeColsPerSecond >= s * 0.9) return s;
  }
  return clamp(Math.round(nativeColsPerSecond), 30, 100);
}

function ampFromYPx(yPx) {
  const baseline = median(yPx);
  const amp = new Float32Array(yPx.length);
  for (let i = 0; i < yPx.length; i++) amp[i] = baseline - yPx[i]; // flip: image y grows down
  return amp;
}

function centerAndTrim(samples) {
  const m = mean(samples);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - m;
  return out;
}

export function calibrateAndResample(rawLeads, grid, roi, options = {}) {
  const warnings = [];
  const mmPerSecond = options.mmPerSecond ?? 25;
  const mmPerMV = options.mmPerMV ?? 10;

  const ampByLead = rawLeads.map((lead) => ampFromYPx(lead.yPx));

  let source;
  let samplingRate;
  let mvPerUnit;
  let leadsOut;

  if (grid.detected) {
    const pxPerMm = grid.pxPerMm;
    const nativeColsPerSecond = pxPerMm * mmPerSecond;
    samplingRate = options.samplingRate ?? chooseSamplingRate(nativeColsPerSecond);
    mvPerUnit = 1 / (pxPerMm * mmPerMV);
    source = 'grid';

    const duration = roi.width / nativeColsPerSecond;
    const numSamples = Math.max(2, Math.round(duration * samplingRate));
    const srcTimes = Float64Array.from({ length: roi.width }, (_, i) => i / nativeColsPerSecond);
    const dstTimes = Float64Array.from({ length: numSamples }, (_, i) => i / samplingRate);

    leadsOut = rawLeads.map((lead, i) => {
      const resampled = resampleLinear(ampByLead[i], srcTimes, dstTimes);
      return {
        label: lead.label,
        samples: Array.from(centerAndTrim(resampled)),
        quality: lead.quality,
      };
    });
  } else {
    source = options.pxPerMm ? 'user' : 'assumed';
    samplingRate = options.samplingRate ?? DEFAULT_SAMPLING_RATE;

    if (options.pxPerMm) {
      mvPerUnit = 1 / (options.pxPerMm * mmPerMV);
    } else {
      const overallPeakToPeak = ampByLead.reduce((m, amp) => {
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < amp.length; i++) { if (amp[i] < lo) lo = amp[i]; if (amp[i] > hi) hi = amp[i]; }
        return Math.max(m, hi - lo);
      }, 1);
      mvPerUnit = ASSUMED_PEAK_TO_PEAK_MV / Math.max(1, overallPeakToPeak);
      warnings.push('No grid detected: amplitude calibration (mV) is an unverified assumption based on a typical physiological amplitude, not a measurement. Treat amplitude values as relative, not absolute.');
    }
    if (!options.samplingRate) {
      warnings.push(`No grid detected: sampling rate is an unverified assumption (image columns treated as consecutive samples at ${samplingRate} Hz). Provide a grid-containing image or an explicit sampling rate to trust the time axis.`);
    } else {
      warnings.push('No grid detected: time axis relies on the user-supplied sampling rate and cannot be independently verified against the image.');
    }

    // No physical time reference: keep the native 1-sample-per-column series,
    // labeled at the (assumed or user-given) sampling rate, rather than
    // inventing a duration to resample against.
    leadsOut = rawLeads.map((lead, i) => ({
      label: lead.label,
      samples: Array.from(centerAndTrim(ampByLead[i])),
      quality: lead.quality,
    }));
  }

  return {
    calibration: { samplingRate, mvPerUnit, source },
    leads: leadsOut,
    warnings,
  };
}
