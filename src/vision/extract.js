import { preprocess } from './preprocess.js';
import { detectGrid } from './grid.js';
import { extractLeadSeries } from './trace.js';
import { calibrateAndResample } from './calibrate.js';

const LEAD_COLORS = [
  [255, 60, 60],
  [60, 220, 255],
  [255, 210, 60],
  [180, 120, 255],
];

function setPixel(data, width, height, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 4;
  data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
}

function drawRect(data, width, height, rect, color) {
  const { x, y, width: w, height: h } = rect;
  for (let dx = 0; dx < w; dx++) {
    setPixel(data, width, height, x + dx, y, ...color, 255);
    setPixel(data, width, height, x + dx, y + h - 1, ...color, 255);
  }
  for (let dy = 0; dy < h; dy++) {
    setPixel(data, width, height, x, y + dy, ...color, 255);
    setPixel(data, width, height, x + w - 1, y + dy, ...color, 255);
  }
}

function buildOverlay(pre, grid, traceResult) {
  const { width, height, gray } = pre;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }

  if (grid.detected) {
    for (const y of grid.rowPositions) {
      for (let x = 0; x < width; x += 3) setPixel(data, width, height, x, y, 80, 160, 255, 160);
    }
    for (const x of grid.colPositions) {
      for (let y = 0; y < height; y += 3) setPixel(data, width, height, x, y, 80, 160, 255, 160);
    }
  }

  drawRect(data, width, height, grid.roi, [255, 255, 0]);

  traceResult.leads.forEach((lead, i) => {
    const color = LEAD_COLORS[i % LEAD_COLORS.length];
    const { roi } = grid;
    for (let dx = 0; dx < lead.yPx.length; dx++) {
      const yv = lead.yPx[dx];
      if (Number.isNaN(yv)) continue;
      setPixel(data, width, height, roi.x + dx, yv, ...color, 255);
    }
  });

  return new ImageData(data, width, height);
}

function emptyResult(imageData, options, warnings) {
  return {
    ok: false,
    warnings,
    grid: {
      detected: false,
      smallBoxPx: null,
      largeBoxPx: null,
      pxPerMm: null,
      mmPerSecond: options.mmPerSecond ?? 25,
      mmPerMV: options.mmPerMV ?? 10,
    },
    calibration: {
      samplingRate: options.samplingRate ?? 250,
      mvPerUnit: null,
      source: 'assumed',
    },
    roi: { x: 0, y: 0, width: imageData.width, height: imageData.height },
    leads: [],
    debug: { overlay: null },
  };
}

// Public API: extracts calibrated 1-D waveform(s) from a photo/screenshot of
// an ECG trace. See module doc for the full pipeline description.
export function extractTraces(imageData, options = {}) {
  const warnings = [];
  let pre;
  let grid;
  let traceResult;
  try {
    pre = preprocess(imageData, options);
    warnings.push(...pre.warnings);
    grid = detectGrid(pre.gray, pre.width, pre.height, pre.rotationDeg);
    warnings.push(...grid.warnings);
    traceResult = extractLeadSeries(pre, grid);
    warnings.push(...traceResult.warnings);
  } catch (err) {
    return emptyResult(imageData, options, [...warnings, `Extraction failed during preprocessing/segmentation: ${err && err.message ? err.message : String(err)}`]);
  }

  if (traceResult.leads.length === 0) {
    const result = emptyResult(imageData, options, warnings);
    result.grid = {
      detected: grid.detected,
      smallBoxPx: grid.smallBoxPx,
      largeBoxPx: grid.largeBoxPx,
      pxPerMm: grid.pxPerMm,
      mmPerSecond: options.mmPerSecond ?? 25,
      mmPerMV: options.mmPerMV ?? 10,
    };
    result.roi = grid.roi;
    if (options.debug !== false) {
      try { result.debug.overlay = buildOverlay(pre, grid, traceResult); } catch { /* overlay is best-effort */ }
    }
    return result;
  }

  let calibration, leads;
  try {
    const calResult = calibrateAndResample(traceResult.leads, grid, grid.roi, options);
    calibration = calResult.calibration;
    leads = calResult.leads;
    warnings.push(...calResult.warnings);
  } catch (err) {
    return emptyResult(imageData, options, [...warnings, `Extraction failed during calibration: ${err && err.message ? err.message : String(err)}`]);
  }

  let overlay = null;
  if (options.debug !== false) {
    try { overlay = buildOverlay(pre, grid, traceResult); } catch { /* overlay is best-effort */ }
  }

  return {
    ok: true,
    warnings,
    grid: {
      detected: grid.detected,
      smallBoxPx: grid.smallBoxPx,
      largeBoxPx: grid.largeBoxPx,
      pxPerMm: grid.pxPerMm,
      mmPerSecond: options.mmPerSecond ?? 25,
      mmPerMV: options.mmPerMV ?? 10,
    },
    calibration,
    roi: grid.roi,
    leads,
    debug: { overlay },
  };
}
