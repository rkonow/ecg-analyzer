import {
  clamp, boxBlur, medianFilter3, percentileStretch, sobel, rotateBuffer,
  otsuThreshold, median, solveHomography, invertHomography, warpPerspective,
  toGrayscale, bilinearSample,
} from './utils.js';

function extractColorChannels(imageData) {
  const { data, width, height } = imageData;
  const r = new Float32Array(width * height);
  const g = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  for (let i = 0, p = 0; i < r.length; i++, p += 4) {
    r[i] = data[p];
    g[i] = data[p + 1];
    b[i] = data[p + 2];
  }
  return { r, g, b };
}

// Glare is a localized blown-out hotspot, not merely "bright" - a uniformly
// bright but legitimate background (e.g. white ECG paper) must not trigger
// this. A local-average comparison was tried first but a fixed-radius blur
// is contaminated by the printed grid itself (whenever a window happens to
// include more grid lines than usual, the average dips and *unrelated*
// bright background pixels nearby read as "spikes"). Real glare, unlike a
// grid, forms one large contiguous saturated blob, so this instead flags
// near-fully-saturated pixels and keeps only connected components above a
// minimum size - scattered single saturated pixels near ink/grid edges
// don't qualify.
function detectGlare(gray, width, height) {
  const SAT_THRESHOLD = 253;
  const MIN_BLOB_FRACTION = 0.004;
  const minBlobSize = Math.max(25, Math.round(width * height * MIN_BLOB_FRACTION));

  const visited = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  const stack = [];
  let flaggedCount = 0;

  for (let start = 0; start < gray.length; start++) {
    if (visited[start] || gray[start] < SAT_THRESHOLD) continue;
    const component = [start];
    visited[start] = 1;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx / width) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const n of neighbors) {
        if (!visited[n] && gray[n] >= SAT_THRESHOLD) {
          visited[n] = 1;
          stack.push(n);
          component.push(n);
        }
      }
    }
    if (component.length >= minBlobSize) {
      for (const idx of component) mask[idx] = 1;
      flaggedCount += component.length;
    }
  }

  return { mask, fraction: flaggedCount / gray.length };
}

function downsampleForAnalysis(gray, width, height, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return { data: gray, width, height };
  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  const out = new Float32Array(newWidth * newHeight);
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      out[y * newWidth + x] = bilinearSample(gray, width, height, x / scale, y / scale, 0);
    }
  }
  return { data: out, width: newWidth, height: newHeight };
}

function variance(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m += arr[i];
  m /= arr.length;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
  return s / arr.length;
}

// A correctly-aligned grid/trace concentrates its edge energy into a few
// sharp row/column projection peaks; a skewed one spreads it out. This is
// the classic document-deskew "projection profile" method: search candidate
// corrections directly by re-rotating and scoring, rather than estimating
// orientation from a small gradient kernel. A per-pixel 3x3 Sobel angle
// histogram was tried first but is systematically biased on rasterized
// diagonal lines (their local staircase structure reads as closer to axis-
// aligned than the true line angle), so it is not used here.
function projectionScore(gray, width, height) {
  const { mag } = sobel(gray, width, height);
  const rowProj = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    const off = y * width;
    for (let x = 0; x < width; x++) sum += mag[off + x];
    rowProj[y] = sum;
  }
  const colProj = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += mag[y * width + x];
    colProj[x] = sum;
  }
  return variance(rowProj) + variance(colProj);
}

// Returns the tilt (degrees) present in the image: rotating the image by
// -angleDeg straightens it.
function estimateRotationDeg(gray, width, height) {
  const ds = downsampleForAnalysis(gray, width, height, 220);
  const fill = median(ds.data);
  const SEARCH_RANGE = 20;

  let bestCorrection = 0;
  let bestScore = -Infinity;
  const coarseScores = [];
  for (let a = -SEARCH_RANGE; a <= SEARCH_RANGE; a += 1) {
    const rotated = rotateBuffer(ds.data, ds.width, ds.height, a * Math.PI / 180, fill);
    const score = projectionScore(rotated.data, rotated.width, rotated.height);
    coarseScores.push(score);
    if (score > bestScore) { bestScore = score; bestCorrection = a; }
  }
  let refinedCorrection = bestCorrection;
  let refinedScore = bestScore;
  for (let a = bestCorrection - 0.9; a <= bestCorrection + 0.9; a += 0.1) {
    const rotated = rotateBuffer(ds.data, ds.width, ds.height, a * Math.PI / 180, fill);
    const score = projectionScore(rotated.data, rotated.width, rotated.height);
    if (score > refinedScore) { refinedScore = score; refinedCorrection = a; }
  }

  const meanScore = coarseScores.reduce((s, v) => s + v, 0) / coarseScores.length;
  const confidence = refinedScore > 0 ? clamp(1 - meanScore / refinedScore, 0, 1) : 0;
  // rotateBuffer(+correction) straightens the image, so the image's own
  // tilt is the negation of the correction that best aligns it.
  const angleDeg = Math.round(-refinedCorrection * 10) / 10;
  return { angleDeg, confidence };
}

// Best-effort quad detection: uses the extreme points (min/max of x+y and
// x-y) of the foreground mask as an approximation of a (possibly rotated)
// rectangle's four corners. Returns null when not confident.
function detectQuad(gray, width, height) {
  const thresh = otsuThreshold(gray);
  const bg = median(gray);
  const isPaper = bg > 128;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  let cornerSumMin = null, cornerSumMax = null, cornerDiffMin = null, cornerDiffMax = null;
  let fgCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      const isFg = isPaper ? v < thresh : v > thresh;
      if (!isFg) continue;
      fgCount++;
      const s = x + y;
      const d = x - y;
      if (s < minSum) { minSum = s; cornerSumMin = [x, y]; }
      if (s > maxSum) { maxSum = s; cornerSumMax = [x, y]; }
      if (d < minDiff) { minDiff = d; cornerDiffMin = [x, y]; }
      if (d > maxDiff) { maxDiff = d; cornerDiffMax = [x, y]; }
    }
  }
  const fgFraction = fgCount / (width * height);
  if (fgFraction < 0.15 || !cornerSumMin || !cornerSumMax || !cornerDiffMin || !cornerDiffMax) {
    return null;
  }
  const quad = [cornerSumMin, cornerDiffMax, cornerSumMax, cornerDiffMin]; // TL, TR, BR, BL
  const bboxW = Math.max(...quad.map((p) => p[0])) - Math.min(...quad.map((p) => p[0]));
  const bboxH = Math.max(...quad.map((p) => p[1])) - Math.min(...quad.map((p) => p[1]));
  if (bboxW < width * 0.2 || bboxH < height * 0.2) return null;
  const area = quadArea(quad);
  const bboxArea = bboxW * bboxH;
  if (bboxArea <= 0 || area / bboxArea < 0.55) return null; // too irregular, not confident
  return { quad, targetWidth: Math.round(bboxW), targetHeight: Math.round(bboxH) };
}

function quadArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function preprocess(imageData, options = {}) {
  const warnings = [];
  const width0 = imageData.width;
  const height0 = imageData.height;
  const { gray: grayRaw } = toGrayscale(imageData);
  let { r, g, b } = extractColorChannels(imageData);
  let gray = grayRaw;
  let width = width0;
  let height = height0;

  // --- Perspective correction (best-effort) ---
  if (options.perspective !== false) {
    const quad = detectQuad(gray, width, height);
    if (quad) {
      const { quad: q, targetWidth, targetHeight } = quad;
      const dst = [[0, 0], [targetWidth, 0], [targetWidth, targetHeight], [0, targetHeight]];
      const h = solveHomography(q, dst);
      const invH = h && invertHomography(h);
      if (invH) {
        const fill = median(gray);
        gray = warpPerspective(gray, width, height, invH, targetWidth, targetHeight, fill);
        r = warpPerspective(r, width, height, invH, targetWidth, targetHeight, fill);
        g = warpPerspective(g, width, height, invH, targetWidth, targetHeight, fill);
        b = warpPerspective(b, width, height, invH, targetWidth, targetHeight, fill);
        width = targetWidth;
        height = targetHeight;
        warnings.push('Applied best-effort perspective correction from a detected quad; verify ROI looks correct.');
      }
    }
  }

  // --- Illumination normalization (vignette / uneven lighting) ---
  const illumRadius = Math.max(8, Math.round(Math.min(width, height) / 6));
  const illum = boxBlur(gray, width, height, illumRadius);
  const targetMean = median(illum);
  const normalized = new Float32Array(width * height);
  for (let i = 0; i < normalized.length; i++) {
    const denom = illum[i] < 1 ? 1 : illum[i];
    normalized[i] = clamp((gray[i] / denom) * targetMean, 0, 255);
  }

  // --- Contrast stretch ---
  const stretched = percentileStretch(normalized, width, height, 0.01, 0.99);

  // --- Deskew (estimated before denoising: a 3x3 median filter erodes the
  // thin diagonal lines a rotated grid/trace produces, which corrupts the
  // edge-orientation histogram this relies on) ---
  let rotationDeg = 0;
  let rotationConfidence = 0;
  if (options.deskew !== false) {
    const est = estimateRotationDeg(stretched, width, height);
    rotationDeg = est.angleDeg;
    rotationConfidence = est.confidence;
  }

  // --- Denoise ---
  const denoised = medianFilter3(stretched, width, height);

  let finalGray = denoised;
  let finalR = r, finalG = g, finalB = b;
  let finalWidth = width, finalHeight = height;
  if (Math.abs(rotationDeg) > 0.15) {
    const fill = median(denoised);
    const rotated = rotateBuffer(denoised, width, height, -rotationDeg * Math.PI / 180, fill);
    finalGray = rotated.data;
    finalWidth = rotated.width;
    finalHeight = rotated.height;
    const rf = median(r), gf = median(g), bf = median(b);
    finalR = rotateBuffer(r, width, height, -rotationDeg * Math.PI / 180, rf).data;
    finalG = rotateBuffer(g, width, height, -rotationDeg * Math.PI / 180, gf).data;
    finalB = rotateBuffer(b, width, height, -rotationDeg * Math.PI / 180, bf).data;
    warnings.push(`Corrected estimated rotation of ${rotationDeg.toFixed(2)} deg.`);
  }

  const backgroundLuma = median(finalGray);
  const { mask: glareMask, fraction: glareFraction } = detectGlare(finalGray, finalWidth, finalHeight);
  if (glareFraction > 0.01) {
    warnings.push(`Glare/saturation detected over ${(glareFraction * 100).toFixed(1)}% of the image.`);
  }

  return {
    width: finalWidth,
    height: finalHeight,
    gray: finalGray,
    color: { r: finalR, g: finalG, b: finalB },
    rotationDeg,
    rotationConfidence,
    glareMask,
    glareFraction,
    backgroundLuma,
    warnings,
  };
}
