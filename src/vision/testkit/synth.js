// Synthetic ECG image generator for the dev.html self-test harness.
// Not part of the public extraction API - test-only.

function gaussian(t, center, width, amp) {
  const d = (t - center) / width;
  return amp * Math.exp(-0.5 * d * d);
}

function beatShape(tInCycle, cycleLen) {
  return (
    gaussian(tInCycle, 0.16 * cycleLen, 0.022 * cycleLen, 0.15) +
    gaussian(tInCycle, 0.34 * cycleLen, 0.008 * cycleLen, -0.15) +
    gaussian(tInCycle, 0.365 * cycleLen, 0.011 * cycleLen, 1.2) +
    gaussian(tInCycle, 0.39 * cycleLen, 0.009 * cycleLen, -0.28) +
    gaussian(tInCycle, 0.58 * cycleLen, 0.05 * cycleLen, 0.3)
  );
}

// Generates a finely-sampled ground truth ECG-like waveform in mV.
export function generateGroundTruth({ durationSec = 4, heartRateBpm = 72, internalRate = 2000 }) {
  const cycleLen = 60 / heartRateBpm;
  const n = Math.round(durationSec * internalRate);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / internalRate;
    const tInCycle = t % cycleLen;
    values[i] = beatShape(tInCycle, cycleLen);
  }
  return { values, sampleRate: internalRate, durationSec, heartRateBpm };
}

function sampleGroundTruth(gt, tSec) {
  const idx = tSec * gt.sampleRate;
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, gt.values.length - 1);
  const f = idx - i0;
  const v0 = gt.values[Math.min(i0, gt.values.length - 1)];
  const v1 = gt.values[i1];
  return v0 + (v1 - v0) * f;
}

export function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawGrid(ctx, widthPx, heightPx, pxPerMm, smallColor, largeColor) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = smallColor;
  for (let x = 0; x < widthPx; x += pxPerMm) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, heightPx); ctx.stroke();
  }
  for (let y = 0; y < heightPx; y += pxPerMm) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(widthPx, y + 0.5); ctx.stroke();
  }
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = largeColor;
  for (let x = 0; x < widthPx; x += pxPerMm * 5) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, heightPx); ctx.stroke();
  }
  for (let y = 0; y < heightPx; y += pxPerMm * 5) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(widthPx, y + 0.5); ctx.stroke();
  }
}

export function drawTrace(ctx, widthPx, centerY, pxPerMm, mmPerSecond, mmPerMV, gt, traceColor, lineWidth) {
  ctx.strokeStyle = traceColor;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = 0; x < widthPx; x++) {
    const tSec = x / (pxPerMm * mmPerSecond);
    const v = sampleGroundTruth(gt, tSec);
    const y = centerY - v * mmPerMV * pxPerMm;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function addGlare(ctx, widthPx, heightPx, cx, cy, radius) {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, widthPx, heightPx);
}

export function addNoise(imageData, stdDev, rand) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() + rand() + rand() - 1.5) * stdDev * 1.5; // approx gaussian
    data[i] = Math.min(255, Math.max(0, data[i] + n));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + n));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + n));
  }
}

// Renders a synthetic ECG image (paper or monitor style) with optional
// rotation, glare, and noise, and returns { imageData, groundTruth, meta }.
export function renderSyntheticImage(opts) {
  const {
    widthPx = 900,
    heightPx = 420,
    pxPerMm = 6,
    mmPerSecond = 25,
    mmPerMV = 10,
    heartRateBpm = 72,
    style = 'paper', // 'paper' | 'monitor'
    rotationDeg = 0,
    glare = false,
    noiseStd = 0,
    seed = 1,
  } = opts;

  const rand = mulberry32(seed);
  const durationSec = widthPx / (pxPerMm * mmPerSecond) + 0.2;
  const gt = generateGroundTruth({ durationSec, heartRateBpm });

  const base = document.createElement('canvas');
  base.width = widthPx;
  base.height = heightPx;
  const ctx = base.getContext('2d');

  const isPaper = style === 'paper';
  ctx.fillStyle = isPaper ? '#efe2d9' : '#050705';
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (isPaper) {
    drawGrid(ctx, widthPx, heightPx, pxPerMm, 'rgba(255,150,150,0.55)', 'rgba(240,90,90,0.8)');
  } else if (opts.monitorGrid) {
    drawGrid(ctx, widthPx, heightPx, pxPerMm, 'rgba(60,90,60,0.5)', 'rgba(70,110,70,0.7)');
  }

  const centerY = heightPx / 2;
  const traceColor = isPaper ? (opts.traceColor || '#151515') : (opts.traceColor || '#39ff6a');
  drawTrace(ctx, widthPx, centerY, pxPerMm, mmPerSecond, mmPerMV, gt, traceColor, isPaper ? 2 : 2.2);

  if (glare) {
    addGlare(ctx, widthPx, heightPx, widthPx * (opts.glareX ?? 0.7), heightPx * (opts.glareY ?? 0.35), Math.min(widthPx, heightPx) * (opts.glareRadius ?? 0.28));
  }

  let finalCanvas = base;
  if (Math.abs(rotationDeg) > 0.001) {
    const rad = (rotationDeg * Math.PI) / 180;
    const newW = Math.round(Math.abs(widthPx * Math.cos(rad)) + Math.abs(heightPx * Math.sin(rad)));
    const newH = Math.round(Math.abs(widthPx * Math.sin(rad)) + Math.abs(heightPx * Math.cos(rad)));
    const rc = document.createElement('canvas');
    rc.width = newW; rc.height = newH;
    const rctx = rc.getContext('2d');
    rctx.fillStyle = isPaper ? '#efe2d9' : '#050705';
    rctx.fillRect(0, 0, newW, newH);
    rctx.translate(newW / 2, newH / 2);
    rctx.rotate(rad);
    rctx.drawImage(base, -widthPx / 2, -heightPx / 2);
    finalCanvas = rc;
  }

  const fctx = finalCanvas.getContext('2d');
  const imageData = fctx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
  if (noiseStd > 0) addNoise(imageData, noiseStd, rand);
  fctx.putImageData(imageData, 0, 0);

  return {
    imageData,
    canvas: finalCanvas,
    groundTruth: gt,
    meta: { widthPx, heightPx, pxPerMm, mmPerSecond, mmPerMV, style, rotationDeg, glare, noiseStd, heartRateBpm },
  };
}
