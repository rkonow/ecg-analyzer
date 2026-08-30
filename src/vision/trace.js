import { otsuThreshold, clamp, median, interpolateGaps } from './utils.js';

function signedInkDistance(gray, width, height, isPaper) {
  const out = new Float32Array(width * height);
  const bg = median(gray);
  for (let i = 0; i < gray.length; i++) {
    const d = isPaper ? bg - gray[i] : gray[i] - bg;
    out[i] = d < 0 ? 0 : d;
  }
  return out;
}

function buildForegroundMask(signedDist, width, height, roi) {
  const roiValues = [];
  for (let y = roi.y; y < roi.y + roi.height; y++) {
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      roiValues.push(signedDist[y * width + x]);
    }
  }
  const arr = Float32Array.from(roiValues);
  let thresh = otsuThreshold(arr);
  thresh = Math.max(thresh, 10);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < signedDist.length; i++) {
    mask[i] = signedDist[i] > thresh ? 1 : 0;
  }
  const maxVal = arr.reduce((m, v) => Math.max(m, v), 0);
  return { mask, thresh, maxVal };
}

// Only strips horizontal grid-line rows, not vertical columns: this is a
// column-wise extraction pipeline, so wiping an entire column guarantees a
// gap at that x regardless of the trace's y-position, while wiping a single
// row merely thins a stroke that is normally >1px thick. Kept to a 1px band
// so collateral loss stays small even at coarse (small pitch) grids.
function stripGridRows(mask, width, height, grid, halfWidth) {
  if (!grid.detected) return;
  for (const y of grid.rowPositions) {
    for (let dy = -halfWidth; dy <= halfWidth; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      const off = yy * width;
      for (let x = 0; x < width; x++) mask[off + x] = 0;
    }
  }
}

function rowDensity(mask, width, roi) {
  const density = new Float32Array(roi.height);
  for (let dy = 0; dy < roi.height; dy++) {
    const y = roi.y + dy;
    let count = 0;
    const off = y * width;
    for (let dx = 0; dx < roi.width; dx++) count += mask[off + roi.x + dx];
    density[dy] = count / roi.width;
  }
  return density;
}

function smooth(arr, radius) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j < 0 || j >= arr.length) continue;
      sum += arr[j]; n++;
    }
    out[i] = sum / n;
  }
  return out;
}

function findBands(density, roi, minGapPx) {
  const active = [];
  for (let i = 0; i < density.length; i++) active.push(density[i] > 0.02);
  const rawBands = [];
  let start = -1;
  for (let i = 0; i < active.length; i++) {
    if (active[i] && start === -1) start = i;
    if ((!active[i] || i === active.length - 1) && start !== -1) {
      const end = active[i] ? i : i - 1;
      rawBands.push([start, end]);
      start = -1;
    }
  }
  const merged = [];
  for (const b of rawBands) {
    if (merged.length && b[0] - merged[merged.length - 1][1] <= minGapPx) {
      merged[merged.length - 1][1] = b[1];
    } else {
      merged.push([...b]);
    }
  }
  return merged.map(([s, e]) => ({ yStart: roi.y + s, yEnd: roi.y + e }));
}

function columnCoverage(mask, width, roi, band, margin) {
  let covered = 0;
  const y0 = Math.max(0, band.yStart - margin);
  const y1 = band.yEnd + margin;
  for (let dx = 0; dx < roi.width; dx++) {
    const x = roi.x + dx;
    let hit = false;
    for (let y = y0; y <= y1; y++) {
      if (mask[y * width + x]) { hit = true; break; }
    }
    if (hit) covered++;
  }
  return covered / roi.width;
}

// A crude high-pass residual: real signal features (even a fast QRS) stay
// close to a 3-tap local average since they still have local continuity,
// while per-pixel extraction jitter from noise does not. Used only as a
// quality signal, not for filtering the series itself.
function estimateNoiseRatio(y) {
  const n = y.length;
  if (n < 5) return 0;
  let residualSum = 0;
  for (let i = 1; i < n - 1; i++) {
    const smoothed = (y[i - 1] + y[i] + y[i + 1]) / 3;
    residualSum += Math.abs(y[i] - smoothed);
  }
  const meanResidual = residualSum / (n - 2);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) { if (y[i] < min) min = y[i]; if (y[i] > max) max = y[i]; }
  const scale = Math.max(1, max - min);
  return meanResidual / scale;
}

function extractColumnSeries(mask, width, roi, band, margin) {
  const n = roi.width;
  const y = new Float32Array(n).fill(NaN);
  const y0 = Math.max(0, band.yStart - margin);
  const y1 = band.yEnd + margin;
  let prevY = (band.yStart + band.yEnd) / 2;
  let touchesTop = 0;
  let touchesBottom = 0;

  for (let dx = 0; dx < n; dx++) {
    const x = roi.x + dx;
    const runs = [];
    let runStart = -1;
    for (let yy = y0; yy <= y1 + 1; yy++) {
      const set = yy <= y1 && mask[yy * width + x];
      if (set && runStart === -1) runStart = yy;
      if (!set && runStart !== -1) { runs.push([runStart, yy - 1]); runStart = -1; }
    }
    if (runs.length === 0) continue;

    // Merge runs separated by small gaps (anti-aliasing breaks).
    const mergedRuns = [runs[0]];
    for (let i = 1; i < runs.length; i++) {
      if (runs[i][0] - mergedRuns[mergedRuns.length - 1][1] <= 2) {
        mergedRuns[mergedRuns.length - 1][1] = runs[i][1];
      } else {
        mergedRuns.push(runs[i]);
      }
    }

    let chosen = mergedRuns[0];
    if (mergedRuns.length > 1) {
      let bestDist = Infinity;
      for (const r of mergedRuns) {
        const mid = (r[0] + r[1]) / 2;
        const d = Math.abs(mid - prevY);
        if (d < bestDist) { bestDist = d; chosen = r; }
      }
    }
    const mid = (chosen[0] + chosen[1]) / 2;
    y[dx] = mid;
    prevY = mid;
    if (chosen[0] <= y0 + 1) touchesTop++;
    if (chosen[1] >= y1 - 1) touchesBottom++;
  }

  return { y, touchesTop, touchesBottom };
}

// Segments the trace(s) from grid/background, bands them into leads, and
// reduces each lead to one y-per-column (px units, not yet time/mV
// calibrated - that happens in calibrate.js).
export function extractLeadSeries(pre, grid) {
  const warnings = [];
  const { gray, width, height, backgroundLuma } = pre;
  const isPaper = backgroundLuma > 128;
  const roi = grid.roi;

  const signedDist = signedInkDistance(gray, width, height, isPaper);
  const { mask, thresh, maxVal } = buildForegroundMask(signedDist, width, height, roi);

  const contrastRange = maxVal - thresh;
  const lowContrast = contrastRange < 25;
  if (lowContrast) {
    warnings.push('Low contrast between trace and background; extraction confidence is reduced.');
  }

  if (grid.detected) stripGridRows(mask, width, height, grid, 0);

  const density = smooth(rowDensity(mask, width, roi), 1);
  const minGapPx = Math.max(3, Math.round((grid.smallBoxPx || roi.height * 0.02) * 0.5));
  const bands = findBands(density, roi, minGapPx);

  const margin = Math.max(2, Math.round((grid.smallBoxPx || roi.height * 0.02) * 0.4));
  let candidateBands = bands
    .map((b) => ({ ...b, coverage: columnCoverage(mask, width, roi, b, margin) }))
    .filter((b) => b.coverage > 0.5);

  let relaxed = false;
  if (candidateBands.length === 0) {
    candidateBands = bands
      .map((b) => ({ ...b, coverage: columnCoverage(mask, width, roi, b, margin) }))
      .filter((b) => b.coverage > 0.25);
    relaxed = candidateBands.length > 0;
  }

  if (candidateBands.length === 0) {
    warnings.push('No trace could be segmented from the image (no band of ink spans a useful fraction of the ROI width).');
    return { leads: [], warnings, mask, bands: [], roi, thresh };
  }
  if (relaxed) {
    warnings.push('Trace bands only found at reduced coverage; the trace may be broken over large stretches.');
  }
  if (candidateBands.length > 1) {
    warnings.push(`Detected ${candidateBands.length} candidate trace bands (multi-lead strip or multiple overlapping traces).`);
  }

  candidateBands.sort((a, b) => a.yStart - b.yStart);

  const leads = candidateBands.map((band, i) => {
    const { y, touchesTop, touchesBottom } = extractColumnSeries(mask, width, roi, band, margin);
    const gapCountBefore = y.reduce((c, v) => c + (Number.isNaN(v) ? 1 : 0), 0);
    const gapFraction = gapCountBefore / roi.width;
    interpolateGaps(y);

    const clipFraction = Math.max(touchesTop, touchesBottom) / roi.width;
    const clipped = clipFraction > 0.15;

    if (gapFraction > 0.02) {
      warnings.push(`Trace broken over ${(gapFraction * 100).toFixed(1)}% of columns in lead unknown-${i + 1}; gaps were interpolated.`);
    }
    if (clipped) {
      warnings.push(`Suspected signal clipping (trace touching band edge) in lead unknown-${i + 1}.`);
    }

    const contrastFactor = clamp((contrastRange) / 90, 0.2, 1);
    const coverageFactor = clamp((band.coverage - 0.25) / 0.75, 0, 1);
    const gapFactor = clamp(1 - gapFraction * 1.5, 0, 1);
    const clipFactor = clipped ? 0.6 : 1;
    const noiseFactor = clamp(1 - estimateNoiseRatio(y) * 6, 0.3, 1);
    const quality = clamp(contrastFactor * coverageFactor * gapFactor * clipFactor * noiseFactor, 0, 1);

    return {
      label: `unknown-${i + 1}`,
      yPx: y,
      band,
      gapFraction,
      clipped,
      quality,
    };
  });

  return { leads, warnings, mask, bands: candidateBands, roi, thresh, isPaper };
}
