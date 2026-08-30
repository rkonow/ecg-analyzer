// Shared numeric/CV/DSP primitives used by the extraction pipeline.
// No dependencies beyond Canvas ImageData and typed arrays.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { gray, width, height };
}

// Separable box blur, O(width*height) via sliding window sums.
export function boxBlur(src, width, height, radius) {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const win = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[row + clamp(x, 0, width - 1)];
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win;
      const addX = clamp(x + radius + 1, 0, width - 1);
      const subX = clamp(x - radius, 0, width - 1);
      sum += src[row + addX] - src[row + subX];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[clamp(y, 0, height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / win;
      const addY = clamp(y + radius + 1, 0, height - 1);
      const subY = clamp(y - radius, 0, height - 1);
      sum += tmp[addY * width + x] - tmp[subY * width + x];
    }
  }
  return out;
}

export function medianFilter3(src, width, height) {
  const out = new Float32Array(width * height);
  const win = new Float32Array(9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = clamp(x + dx, 0, width - 1);
          const yy = clamp(y + dy, 0, height - 1);
          win[n++] = src[yy * width + xx];
        }
      }
      win.sort();
      out[y * width + x] = win[4];
    }
  }
  return out;
}

export function percentileStretch(src, width, height, loPct = 0.01, hiPct = 0.99) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < src.length; i++) {
    hist[clamp(Math.round(src[i]), 0, 255)]++;
  }
  const total = width * height;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc / total >= loPct) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc / total >= 1 - hiPct) { hi = v; break; }
  }
  if (hi <= lo) return src.slice();
  const scale = 255 / (hi - lo);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = clamp((src[i] - lo) * scale, 0, 255);
  }
  return out;
}

export function otsuThreshold(src) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < src.length; i++) hist[clamp(Math.round(src[i]), 0, 255)]++;
  const total = src.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

export function sobel(src, width, height) {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  const ang = new Float32Array(width * height);
  const at = (x, y) => src[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gxv =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gyv =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const idx = y * width + x;
      gx[idx] = gxv;
      gy[idx] = gyv;
      mag[idx] = Math.sqrt(gxv * gxv + gyv * gyv);
      ang[idx] = Math.atan2(gyv, gxv);
    }
  }
  return { gx, gy, mag, ang };
}

export function bilinearSample(src, width, height, x, y, fallback = 0) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return fallback;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const v00 = src[y0 * width + x0];
  const v10 = src[y0 * width + x1];
  const v01 = src[y1 * width + x0];
  const v11 = src[y1 * width + x1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

// Rotates a single-channel buffer about its center by angleRad (radians,
// positive = clockwise in image coords). Expands the canvas to fit the full
// rotated content and fills new corners with fillValue.
export function rotateBuffer(src, width, height, angleRad, fillValue) {
  if (Math.abs(angleRad) < 1e-6) {
    return { data: src.slice(), width, height };
  }
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const newWidth = Math.round(Math.abs(width * cos) + Math.abs(height * sin));
  const newHeight = Math.round(Math.abs(width * sin) + Math.abs(height * cos));
  const out = new Float32Array(newWidth * newHeight).fill(fillValue);
  const cx = width / 2;
  const cy = height / 2;
  const ncx = newWidth / 2;
  const ncy = newHeight / 2;
  for (let oy = 0; oy < newHeight; oy++) {
    for (let ox = 0; ox < newWidth; ox++) {
      const dx = ox - ncx;
      const dy = oy - ncy;
      const sx = dx * cos + dy * sin + cx;
      const sy = -dx * sin + dy * cos + cy;
      out[oy * newWidth + ox] = bilinearSample(src, width, height, sx, sy, fillValue);
    }
  }
  return { data: out, width: newWidth, height: newHeight };
}

// Normalized autocorrelation for lags [minLag, maxLag].
export function autocorrelation(signal, minLag, maxLag) {
  const n = signal.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  const centered = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    centered[i] = signal[i] - mean;
    energy += centered[i] * centered[i];
  }
  const out = new Float64Array(maxLag - minLag + 1);
  if (energy <= 1e-9) return { lags: out, minLag };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += centered[i] * centered[i + lag];
    out[lag - minLag] = sum / energy;
  }
  return { lags: out, minLag };
}

// Finds the strongest periodic pitch in a 1-D signal by locating the first
// prominent local maximum of the autocorrelation beyond a minimum lag.
export function findPitch(signal, minLag = 3, maxLagFrac = 0.34) {
  const maxLag = Math.max(minLag + 1, Math.floor(signal.length * maxLagFrac));
  const { lags } = autocorrelation(signal, minLag, maxLag);
  const threshold = 0.15; // minimum acceptable normalized autocorrelation
  for (let i = 1; i < lags.length - 1; i++) {
    const v = lags[i];
    if (!(v > lags[i - 1] && v >= lags[i + 1] && v > threshold)) continue;
    const lag = i + minLag;
    // Require the 2nd harmonic to also show elevated autocorrelation, so an
    // isolated noise spike at a small lag isn't mistaken for real
    // periodicity (a genuine periodic signal repeats at integer multiples).
    const harmonicIdx = lag * 2 - minLag;
    if (harmonicIdx < lags.length && lags[harmonicIdx] < threshold * 0.4) continue;
    return { pitch: lag, strength: v };
  }
  return { pitch: 0, strength: 0 };
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v];
}

// Linear resampling from an arbitrary time base to a uniform grid.
// srcTimes must be non-decreasing. Returns Float32Array of length dstTimes.length.
export function resampleLinear(values, srcTimes, dstTimes) {
  const out = new Float32Array(dstTimes.length);
  const n = values.length;
  if (n === 0) return out;
  if (n === 1) { out.fill(values[0]); return out; }
  let j = 0;
  for (let i = 0; i < dstTimes.length; i++) {
    const t = dstTimes[i];
    while (j < n - 2 && srcTimes[j + 1] < t) j++;
    const t0 = srcTimes[j];
    const t1 = srcTimes[j + 1];
    const v0 = values[j];
    const v1 = values[j + 1];
    const span = t1 - t0;
    const f = span > 1e-9 ? clamp((t - t0) / span, 0, 1) : 0;
    out[i] = v0 + (v1 - v0) * f;
  }
  return out;
}

// Fills NaN runs in-place via linear interpolation. Leading/trailing NaNs are
// filled with the nearest known value. Returns the number of interpolated samples.
export function interpolateGaps(values) {
  const n = values.length;
  let filled = 0;
  let firstKnown = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(values[i])) { firstKnown = i; break; }
  }
  if (firstKnown === -1) return { filled: n };
  for (let i = 0; i < firstKnown; i++) { values[i] = values[firstKnown]; filled++; }
  let lastKnown = firstKnown;
  let i = firstKnown + 1;
  while (i < n) {
    if (!Number.isNaN(values[i])) { lastKnown = i; i++; continue; }
    let j = i;
    while (j < n && Number.isNaN(values[j])) j++;
    const v0 = values[lastKnown];
    const v1 = j < n ? values[j] : v0;
    const span = j - lastKnown;
    for (let k = i; k < j; k++) {
      values[k] = v0 + (v1 - v0) * ((k - lastKnown) / span);
      filled++;
    }
    lastKnown = j - 1;
    i = j;
  }
  return { filled };
}

export function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(arr) {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

// Solves an 8-unknown homography mapping src quad -> dst quad via Gauss
// elimination on the linear system, returned as a row-major 3x3 array
// (h22 fixed to 1).
export function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(h, x, y) {
  const w = h[2][0] * x + h[2][1] * y + h[2][2];
  const px = (h[0][0] * x + h[0][1] * y + h[0][2]) / w;
  const py = (h[1][0] * x + h[1][1] * y + h[1][2]) / w;
  return [px, py];
}

export function invertHomography(h) {
  const [[a, b, c], [d, e, f], [g, i, j]] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  return [
    [(e * j - f * i) * invDet, (c * i - b * j) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * j) * invDet, (a * j - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * i - e * g) * invDet, (b * g - a * i) * invDet, (a * e - b * d) * invDet],
  ];
}

// Warps src (dstWidth x dstHeight output) by sampling src at the position
// each output pixel maps to under invH (inverse homography: dst -> src).
export function warpPerspective(src, width, height, invH, dstWidth, dstHeight, fillValue) {
  const out = new Float32Array(dstWidth * dstHeight);
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const [sx, sy] = applyHomography(invH, x, y);
      out[y * dstWidth + x] = bilinearSample(src, width, height, sx, sy, fillValue);
    }
  }
  return out;
}
