// Headless Node verification of the real src/vision pipeline modules,
// used when the AO browser capability (for dev.html) is unavailable.
// Builds synthetic ECG images with a hand-rolled pixel-buffer renderer
// (no Canvas/DOM dependency) and runs the actual production code against
// them, comparing recovered vs. ground-truth waveforms.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractTraces } from '../extract.js';
import { preprocess } from '../preprocess.js';
import { detectGrid } from '../grid.js';
import { extractLeadSeries } from '../trace.js';
import { rotateBuffer } from '../utils.js';
import { generateGroundTruth, mulberry32, addNoise } from './synth.js';
import { bestAlignedMatch } from './compare.js';

class ImageDataPolyfill {
  constructor(a, b, c) {
    if (a instanceof Uint8ClampedArray) {
      this.data = a; this.width = b; this.height = c;
    } else {
      this.width = a; this.height = b;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}
if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = ImageDataPolyfill;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function makeCanvasBuffers(width, height, bg) {
  return {
    width, height,
    r: new Float32Array(width * height).fill(bg[0]),
    g: new Float32Array(width * height).fill(bg[1]),
    b: new Float32Array(width * height).fill(bg[2]),
  };
}

function setPx(buf, x, y, rgb, alpha = 1) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const i = y * buf.width + x;
  buf.r[i] += (rgb[0] - buf.r[i]) * alpha;
  buf.g[i] += (rgb[1] - buf.g[i]) * alpha;
  buf.b[i] += (rgb[2] - buf.b[i]) * alpha;
}

function drawGridInto(buf, pxPerMm, smallColor, largeColor, smallAlpha, largeAlpha, yStart = 0, yEnd = buf.height) {
  for (let x = 0; x < buf.width; x += pxPerMm) {
    for (let y = yStart; y < yEnd; y++) setPx(buf, x, y, smallColor, smallAlpha);
  }
  for (let y = yStart; y < yEnd; y += pxPerMm) {
    for (let x = 0; x < buf.width; x++) setPx(buf, x, y, smallColor, smallAlpha);
  }
  for (let x = 0; x < buf.width; x += pxPerMm * 5) {
    for (let y = yStart; y < yEnd; y++) setPx(buf, x, y, largeColor, largeAlpha);
  }
  for (let y = yStart; y < yEnd; y += pxPerMm * 5) {
    for (let x = 0; x < buf.width; x++) setPx(buf, x, y, largeColor, largeAlpha);
  }
}

function sampleGt(gt, tSec) {
  const idx = tSec * gt.sampleRate;
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, gt.values.length - 1);
  const f = idx - i0;
  const v0 = gt.values[Math.min(Math.max(i0, 0), gt.values.length - 1)];
  const v1 = gt.values[Math.max(i1, 0)];
  return v0 + (v1 - v0) * f;
}

function drawTraceInto(buf, centerY, pxPerMm, mmPerSecond, mmPerMV, gt, color) {
  let prevY = centerY;
  for (let x = 0; x < buf.width; x++) {
    const tSec = x / (pxPerMm * mmPerSecond);
    const v = sampleGt(gt, tSec);
    const y = centerY - v * mmPerMV * pxPerMm;
    const y0 = Math.min(prevY, y), y1 = Math.max(prevY, y);
    for (let yy = Math.floor(y0); yy <= Math.ceil(y1); yy++) {
      setPx(buf, x, yy, color, 1);
      setPx(buf, x - 1, yy, color, 0.85);
    }
    prevY = y;
  }
}

function addGlareInto(buf, cx, cy, radius) {
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      const alpha = Math.max(0, 0.95 * (1 - d / radius));
      setPx(buf, x, y, [255, 255, 255], alpha);
    }
  }
}

function rotateCanvasBuffers(buf, rotationDeg, bg) {
  if (Math.abs(rotationDeg) < 0.001) return buf;
  const rad = (rotationDeg * Math.PI) / 180;
  const rr = rotateBuffer(buf.r, buf.width, buf.height, rad, bg[0]);
  const rg = rotateBuffer(buf.g, buf.width, buf.height, rad, bg[1]);
  const rb = rotateBuffer(buf.b, buf.width, buf.height, rad, bg[2]);
  return { width: rr.width, height: rr.height, r: rr.data, g: rg.data, b: rb.data };
}

function toImageData(buf, noiseStd, seed) {
  const data = new Uint8ClampedArray(buf.width * buf.height * 4);
  for (let i = 0; i < buf.width * buf.height; i++) {
    data[i * 4] = buf.r[i]; data[i * 4 + 1] = buf.g[i]; data[i * 4 + 2] = buf.b[i]; data[i * 4 + 3] = 255;
  }
  const imageData = new ImageDataPolyfill(data, buf.width, buf.height);
  if (noiseStd > 0) addNoise(imageData, noiseStd, mulberry32(seed));
  return imageData;
}

export function renderSyntheticImageNode(opts) {
  const {
    widthPx = 900, heightPx = 420, pxPerMm = 6, mmPerSecond = 25, mmPerMV = 10,
    heartRateBpm = 72, style = 'paper', rotationDeg = 0, glare = false, noiseStd = 0,
    seed = 1, traceColor, monitorGrid = false, glareX = 0.7, glareY = 0.35, glareRadius = 0.28,
  } = opts;

  const isPaper = style === 'paper';
  const bg = isPaper ? [239, 226, 217] : [5, 7, 5];
  const buf = makeCanvasBuffers(widthPx, heightPx, bg);

  if (isPaper) {
    drawGridInto(buf, pxPerMm, [255, 150, 150], [240, 90, 90], 0.55, 0.8);
  } else if (monitorGrid) {
    drawGridInto(buf, pxPerMm, [60, 90, 60], [70, 110, 70], 0.5, 0.7);
  }

  const durationSec = widthPx / (pxPerMm * mmPerSecond) + 0.2;
  const gt = generateGroundTruth({ durationSec, heartRateBpm });
  const tColor = hexToRgb(traceColor || (isPaper ? '#151515' : '#39ff6a'));
  drawTraceInto(buf, heightPx / 2, pxPerMm, mmPerSecond, mmPerMV, gt, tColor);

  if (glare) addGlareInto(buf, widthPx * glareX, heightPx * glareY, Math.min(widthPx, heightPx) * glareRadius);

  const rotated = rotateCanvasBuffers(buf, rotationDeg, bg);
  const imageData = toImageData(rotated, noiseStd, seed);

  return {
    imageData,
    groundTruth: gt,
    meta: { widthPx, heightPx, pxPerMm, mmPerSecond, mmPerMV, style, rotationDeg, glare, noiseStd, heartRateBpm },
  };
}

export function renderTwoLeadPaperNode(opts) {
  const { widthPx = 900, pxPerMm = 6, mmPerSecond = 25, mmPerMV = 10, rotationDeg = 0, noiseStd = 3, hrTop = 72, hrBottom = 95, seed = 7 } = opts;
  const bandH = 150;
  const totalH = bandH * 2 + 60;
  const bg = [239, 226, 217];
  const buf = makeCanvasBuffers(widthPx, totalH, bg);
  drawGridInto(buf, pxPerMm, [255, 150, 150], [240, 90, 90], 0.55, 0.8);

  const durationSec = widthPx / (pxPerMm * mmPerSecond) + 0.2;
  const gtTop = generateGroundTruth({ durationSec, heartRateBpm: hrTop });
  const gtBottom = generateGroundTruth({ durationSec, heartRateBpm: hrBottom });
  drawTraceInto(buf, 20 + bandH * 0.5, pxPerMm, mmPerSecond, mmPerMV, gtTop, [21, 21, 21]);
  drawTraceInto(buf, 40 + bandH * 1.5, pxPerMm, mmPerSecond, mmPerMV, gtBottom, [21, 21, 21]);

  const rotated = rotateCanvasBuffers(buf, rotationDeg, bg);
  const imageData = toImageData(rotated, noiseStd, seed);

  return {
    imageData,
    groundTruth: [gtTop, gtBottom],
    meta: { widthPx, totalH, pxPerMm, mmPerSecond, mmPerMV, rotationDeg, noiseStd, hrTop, hrBottom },
  };
}

// --- minimal PNG encoder (Node zlib only, no deps) for visual evidence ---
function crc32(buf) {
  if (!crc32.table) {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    crc32.table = t;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function encodePNG(imageDataLike) {
  const { data, width, height } = imageDataLike;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < stride; x++) raw[rowStart + 1 + x] = data[y * stride + x];
  }
  const idat = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function zScore(arr) {
  let m = 0; for (const v of arr) m += v; m /= arr.length;
  let s = 0; for (const v of arr) s += (v - m) * (v - m);
  const sd = Math.sqrt(s / arr.length) || 1;
  return arr.map((v) => (v - m) / sd);
}

const CORR_PASS = 0.85;

function runScenario(name, buildFn, outDir) {
  const { imageData, groundTruth, meta } = buildFn();
  const options = { mmPerSecond: meta.mmPerSecond, mmPerMV: meta.mmPerMV };

  let result, error = null;
  try {
    result = extractTraces(imageData, options);
  } catch (e) {
    error = e;
  }

  console.log(`\n=== ${name} ===`);
  console.log('meta:', JSON.stringify(meta));

  if (error) {
    console.log('THREW:', error.stack);
    return { name, pass: false };
  }
  if (!result.ok || result.leads.length === 0) {
    console.log('NO LEADS. ok=', result.ok, 'warnings=', result.warnings);
    return { name, pass: false };
  }

  console.log(`ok=${result.ok} grid.detected=${result.grid.detected} pxPerMm=${result.grid.pxPerMm != null ? result.grid.pxPerMm.toFixed(3) : 'n/a'} roi=${JSON.stringify(result.roi)}`);
  console.log(`calibration: source=${result.calibration.source} samplingRate=${result.calibration.samplingRate}Hz mvPerUnit=${result.calibration.mvPerUnit != null ? result.calibration.mvPerUnit.toExponential(3) : 'n/a'}`);
  console.log(`leads: ${result.leads.length}`);

  // When no grid is detected, calibrate.js correctly declines to resample
  // (there is no verified time reference) and just returns the raw
  // 1-sample-per-column series; result.calibration.samplingRate is only a
  // disclosed *label* for that case, not an actual resampling rate. For the
  // test's own alignment purposes we know the synthetic image's true native
  // column rate, so use that instead of the pipeline's admittedly-unverified
  // label - this tests pixel-to-shape recovery independent of the (rightly)
  // unverifiable time calibration.
  const nativeColsPerSecond = meta.pxPerMm * meta.mmPerSecond;
  const recoveredRate = result.grid.detected ? result.calibration.samplingRate : nativeColsPerSecond;

  const gtLists = Array.isArray(groundTruth) ? groundTruth : [groundTruth];
  let allPass = true;
  result.leads.forEach((lead, i) => {
    const gt = gtLists[Math.min(i, gtLists.length - 1)];
    const match = bestAlignedMatch(zScore(lead.samples), recoveredRate, zScore(Array.from(gt.values)), gt.sampleRate, 2.5);
    const pass = match.corr >= CORR_PASS;
    allPass = allPass && pass;
    console.log(`  lead ${lead.label}: quality=${lead.quality.toFixed(2)} corr=${match.corr.toFixed(3)} rmse(z)=${match.rmseZ.toFixed(3)} shift=${match.shiftSec.toFixed(2)}s -> ${pass ? 'PASS' : 'FAIL'}`);
  });
  if (result.warnings.length) {
    console.log('warnings:');
    result.warnings.forEach((w) => console.log('  - ' + w));
  }

  if (outDir) {
    fs.writeFileSync(path.join(outDir, `${name.replace(/[^a-z0-9]+/gi, '_')}_input.png`), encodePNG(imageData));
    if (result.debug.overlay) {
      fs.writeFileSync(path.join(outDir, `${name.replace(/[^a-z0-9]+/gi, '_')}_overlay.png`), encodePNG(result.debug.overlay));
    }
  }

  console.log(allPass ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { name, pass: allPass };
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const scenarios = [
    ['1_paper_clean', () => renderSyntheticImageNode({ style: 'paper', pxPerMm: 6, rotationDeg: 0, glare: false, noiseStd: 0, seed: 1 })],
    ['2_paper_rotated7_noise', () => renderSyntheticImageNode({ style: 'paper', pxPerMm: 6, rotationDeg: 7, noiseStd: 4, seed: 2 })],
    ['3_paper_glare_noise_rotm4', () => renderSyntheticImageNode({ style: 'paper', pxPerMm: 6, rotationDeg: -4, glare: true, noiseStd: 8, seed: 3 })],
    ['4_monitor_green_nogrid', () => renderSyntheticImageNode({ style: 'monitor', pxPerMm: 6, rotationDeg: 0, noiseStd: 3, traceColor: '#39ff6a', seed: 4 })],
    ['5_monitor_cyan_rot10', () => renderSyntheticImageNode({ style: 'monitor', pxPerMm: 6, rotationDeg: 10, noiseStd: 5, traceColor: '#22e0ff', seed: 5 })],
    ['6_paper_fastHR_steepQRS', () => renderSyntheticImageNode({ style: 'paper', pxPerMm: 6, heartRateBpm: 115, noiseStd: 3, seed: 6 })],
    ['7_two_lead_paper_strip', () => renderTwoLeadPaperNode({ rotationDeg: 3, noiseStd: 3 })],
  ];

  const results = scenarios.map(([name, build]) => runScenario(name, build, outDir));
  console.log('\n\n=== SUMMARY ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`));
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log(`\n${failed.length}/${results.length} scenarios FAILED.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} scenarios PASSED.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
