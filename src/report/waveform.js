// Canvas ECG grid + trace renderer. Draws standard clinical graph paper
// (25 mm/s, 10 mm/mV, 1 mm minor / 5 mm major) and the sample trace on top,
// crisp at any devicePixelRatio, with self-contained pan/zoom.
import { themeColor, ensureStylesInjected } from './theme.js';
import { renderAnnotations, drawIntervalShading } from './annotations.js';

const MM_PER_SECOND = 25;
const MM_PER_MV = 10;
const MIN_SPAN_SEC = 0.4;

const TIME_STEP_CANDIDATES = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
const MV_STEP_CANDIDATES = [0.1, 0.2, 0.5, 1, 2, 5];

function pickNiceStep(pxPerUnit, minPx, candidates) {
  for (const step of candidates) {
    if (step * pxPerUnit >= minPx) return step;
  }
  return candidates[candidates.length - 1];
}

function clampViewport(viewport, totalDurationSec) {
  const v = viewport && typeof viewport === 'object' ? viewport : {};
  let startSec = Number.isFinite(v.startSec) ? v.startSec : 0;
  let endSec = Number.isFinite(v.endSec) ? v.endSec : totalDurationSec;
  if (endSec <= startSec) endSec = startSec + MIN_SPAN_SEC;
  let span = Math.min(Math.max(endSec - startSec, MIN_SPAN_SEC), Math.max(totalDurationSec, MIN_SPAN_SEC));
  startSec = Math.max(0, Math.min(startSec, Math.max(0, totalDurationSec - span)));
  endSec = startSec + span;
  return { startSec, endSec };
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cssWidth, cssHeight, dpr };
}

function computeLayout(cssWidth, cssHeight, viewport, hasBeats) {
  const marginLeft = 46;
  const marginRight = 12;
  const marginTop = 10;
  const marginBottom = 22 + (hasBeats ? 42 : 0);

  const plotLeft = marginLeft;
  const plotTop = marginTop;
  const plotWidth = Math.max(1, cssWidth - marginLeft - marginRight);
  const plotHeight = Math.max(1, cssHeight - marginTop - marginBottom);
  const plotBottom = plotTop + plotHeight;

  // Physical gain is fixed at the clinical standard (10 mm/mV), so amplitude
  // scale follows time scale directly - both axes stay in true mm.
  const spanSec = viewport.endSec - viewport.startSec;
  const pxPerMm = plotWidth / (spanSec * MM_PER_SECOND);
  const pxPerSec = pxPerMm * MM_PER_SECOND;
  const pxPerMv = MM_PER_MV * pxPerMm;
  const baselineY = plotTop + plotHeight * 0.55;
  const bracketBandTop = plotBottom + 22;

  return {
    marginLeft, marginRight, marginTop, marginBottom,
    plotLeft, plotTop, plotWidth, plotHeight, plotBottom, bracketBandTop,
    pxPerMm, pxPerSec, pxPerMv, baselineY,
    viewport,
    xForSec: (t) => plotLeft + (t - viewport.startSec) * pxPerSec,
    secForX: (x) => viewport.startSec + (x - plotLeft) / pxPerSec,
    yForMv: (mv) => baselineY - mv * pxPerMv,
  };
}

function drawGrid(ctx, layout) {
  const { plotLeft, plotTop, plotWidth, plotHeight, plotBottom, pxPerMm, viewport } = layout;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();

  const minor = themeColor(ctx.canvas, '--ecg-grid-minor', 'rgba(233,99,118,0.16)');
  const major = themeColor(ctx.canvas, '--ecg-grid-major', 'rgba(233,99,118,0.42)');
  const baseline = themeColor(ctx.canvas, '--ecg-grid-baseline', 'rgba(233,99,118,0.6)');

  const mmSec = 1 / MM_PER_SECOND;
  const firstLineIdx = Math.floor(viewport.startSec / mmSec);
  const lastLineIdx = Math.ceil(viewport.endSec / mmSec);
  for (let i = firstLineIdx; i <= lastLineIdx; i++) {
    const t = i * mmSec;
    const x = layout.xForSec(t);
    ctx.strokeStyle = i % 5 === 0 ? major : minor;
    ctx.lineWidth = i % 5 === 0 ? 1 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, plotTop);
    ctx.lineTo(Math.round(x) + 0.5, plotBottom);
    ctx.stroke();
  }

  const mvTop = -(plotTop - layout.baselineY) / layout.pxPerMv;
  const mvBottom = -(plotBottom - layout.baselineY) / layout.pxPerMv;
  const mmMv = 1 / MM_PER_MV;
  const firstRow = Math.floor(Math.min(mvTop, mvBottom) / mmMv);
  const lastRow = Math.ceil(Math.max(mvTop, mvBottom) / mmMv);
  for (let i = firstRow; i <= lastRow; i++) {
    const mv = i * mmMv;
    const y = layout.yForMv(mv);
    ctx.strokeStyle = i % 5 === 0 ? major : minor;
    ctx.beginPath();
    ctx.moveTo(plotLeft, Math.round(y) + 0.5);
    ctx.lineTo(plotLeft + plotWidth, Math.round(y) + 0.5);
    ctx.stroke();
  }

  ctx.strokeStyle = baseline;
  ctx.lineWidth = 1.25;
  const y0 = layout.yForMv(0);
  ctx.beginPath();
  ctx.moveTo(plotLeft, Math.round(y0) + 0.5);
  ctx.lineTo(plotLeft + plotWidth, Math.round(y0) + 0.5);
  ctx.stroke();

  ctx.restore();
}

function drawTrace(ctx, layout, samples, samplingRate) {
  const { viewport, plotLeft, plotWidth } = layout;
  const startIdx = Math.max(0, Math.floor(viewport.startSec * samplingRate) - 1);
  const endIdx = Math.min(samples.length - 1, Math.ceil(viewport.endSec * samplingRate) + 1);
  if (endIdx <= startIdx) return;

  const trace = themeColor(ctx.canvas, '--ecg-trace', '#f5f5f2');
  const glow = themeColor(ctx.canvas, '--ecg-trace-glow', 'rgba(245,245,242,0.28)');

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, layout.plotTop, plotWidth, layout.plotHeight);
  ctx.clip();

  ctx.beginPath();
  for (let i = startIdx; i <= endIdx; i++) {
    const x = layout.xForSec(i / samplingRate);
    const y = layout.yForMv(samples[i]);
    if (i === startIdx) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = glow;
  ctx.lineWidth = 5;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 6;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = trace;
  ctx.lineWidth = 1.75;
  ctx.stroke();

  ctx.restore();
}

function drawAxes(ctx, layout) {
  const { plotLeft, plotTop, plotWidth, plotBottom, viewport } = layout;
  const muted = themeColor(ctx.canvas, '--ecg-ink-muted', '#6b6b68');
  const secondary = themeColor(ctx.canvas, '--ecg-ink-secondary', '#a8a8a3');
  const font = themeColor(ctx.canvas, '--ecg-font-mono', 'ui-monospace, monospace');

  ctx.save();
  ctx.font = `10px ${font}`;
  ctx.fillStyle = muted;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;

  // time axis
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom + 0.5);
  ctx.lineTo(plotLeft + plotWidth, plotBottom + 0.5);
  ctx.stroke();
  const timeStep = pickNiceStep(layout.pxPerSec, 56, TIME_STEP_CANDIDATES);
  const firstTick = Math.ceil(viewport.startSec / timeStep) * timeStep;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = firstTick; t <= viewport.endSec + 1e-9; t += timeStep) {
    const x = layout.xForSec(t);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, plotBottom);
    ctx.lineTo(x + 0.5, plotBottom + 4);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(timeStep < 1 ? 2 : 0)}s`, x, plotBottom + 6);
  }

  // mV axis
  ctx.beginPath();
  ctx.moveTo(plotLeft + 0.5, plotTop);
  ctx.lineTo(plotLeft + 0.5, plotBottom);
  ctx.stroke();
  const mvStep = pickNiceStep(layout.pxPerMv, 28, MV_STEP_CANDIDATES);
  const mvTopVal = -(plotTop - layout.baselineY) / layout.pxPerMv;
  const mvBottomVal = -(plotBottom - layout.baselineY) / layout.pxPerMv;
  const firstMvTick = Math.ceil(Math.min(mvTopVal, mvBottomVal) / mvStep) * mvStep;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let mv = firstMvTick; mv <= Math.max(mvTopVal, mvBottomVal) + 1e-9; mv += mvStep) {
    const y = layout.yForMv(mv);
    ctx.beginPath();
    ctx.moveTo(plotLeft - 4, y + 0.5);
    ctx.lineTo(plotLeft, y + 0.5);
    ctx.stroke();
    ctx.fillText(mv.toFixed(mvStep < 1 ? 1 : 0), plotLeft - 7, y);
  }

  ctx.save();
  ctx.translate(12, plotTop + layout.plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = secondary;
  ctx.fillText('mV', 0, 0);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.fillStyle = secondary;
  ctx.fillText('seconds', plotLeft + plotWidth - 34, plotBottom + 6);

  ctx.restore();
}

function cleanupPrevious(canvas) {
  if (canvas.__ecgCleanup) {
    try { canvas.__ecgCleanup(); } catch { /* ignore */ }
  }
  canvas.__ecgCleanup = null;
}

/**
 * Draw the ECG grid + trace (+ optional per-beat annotations) into `canvas`.
 * Self-contained: manages HiDPI sizing, resize, and pan/zoom/hover interaction.
 */
export function renderWaveform(canvas, { samples, samplingRate, beats, viewport } = {}) {
  ensureStylesInjected();
  cleanupPrevious(canvas);

  const safeSamples = Array.isArray(samples) ? samples : [];
  const safeRate = Number.isFinite(samplingRate) && samplingRate > 0 ? samplingRate : 250;
  const safeBeats = Array.isArray(beats) ? beats : [];
  const totalDurationSec = safeSamples.length / safeRate;
  const resolvedViewport = clampViewport(viewport, totalDurationSec);

  canvas.__ecgLastArgs = { samples: safeSamples, samplingRate: safeRate, beats: safeBeats, viewport: resolvedViewport, totalDurationSec };

  const { ctx, cssWidth, cssHeight } = sizeCanvas(canvas);
  const layout = computeLayout(cssWidth, cssHeight, resolvedViewport, safeBeats.length > 0);
  canvas.__ecgLayout = layout;

  const bg = themeColor(canvas, '--ecg-grid-bg', '#160b0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  drawGrid(ctx, layout);
  if (safeBeats.length > 0) drawIntervalShading(ctx, layout, safeBeats, safeSamples, safeRate);
  drawTrace(ctx, layout, safeSamples, safeRate);
  drawAxes(ctx, layout);

  let annotationCleanup = null;
  if (safeBeats.length > 0) {
    annotationCleanup = renderAnnotations({
      canvas, ctx, layout, beats: safeBeats, samples: safeSamples, samplingRate: safeRate,
    });
  }

  const cleanups = [];
  if (annotationCleanup) cleanups.push(annotationCleanup);
  cleanups.push(attachPanZoom(canvas));
  cleanups.push(attachResizeObserver(canvas));

  canvas.__ecgCleanup = () => cleanups.forEach((fn) => fn && fn());
}

function redrawFromStoredArgs(canvas, nextViewport) {
  const last = canvas.__ecgLastArgs;
  if (!last) return;
  renderWaveform(canvas, {
    samples: last.samples,
    samplingRate: last.samplingRate,
    beats: last.beats,
    viewport: nextViewport || last.viewport,
  });
}

function attachResizeObserver(canvas) {
  if (typeof ResizeObserver === 'undefined') return null;
  const ro = new ResizeObserver(() => {
    const last = canvas.__ecgLastArgs;
    if (!last) return;
    window.requestAnimationFrame(() => redrawFromStoredArgs(canvas, last.viewport));
  });
  ro.observe(canvas);
  return () => ro.disconnect();
}

function attachPanZoom(canvas) {
  let dragging = false;
  let dragStartX = 0;
  let dragStartViewport = null;

  const onPointerDown = (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true;
    dragStartX = ev.clientX;
    dragStartViewport = { ...canvas.__ecgLastArgs.viewport };
    canvas.setPointerCapture?.(ev.pointerId);
  };
  const onPointerMove = (ev) => {
    if (!dragging) return;
    const layout = canvas.__ecgLayout;
    if (!layout) return;
    const dxPx = ev.clientX - dragStartX;
    const dSec = -dxPx / layout.pxPerSec;
    const span = dragStartViewport.endSec - dragStartViewport.startSec;
    const total = canvas.__ecgLastArgs.totalDurationSec;
    let startSec = dragStartViewport.startSec + dSec;
    startSec = Math.max(0, Math.min(startSec, Math.max(0, total - span)));
    redrawFromStoredArgs(canvas, { ...dragStartViewport, startSec, endSec: startSec + span });
  };
  const endDrag = () => { dragging = false; dragStartViewport = null; };

  const onWheel = (ev) => {
    const layout = canvas.__ecgLayout;
    if (!layout) return;
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const xCss = ev.clientX - rect.left;
    const anchorSec = layout.secForX(xCss);
    const factor = Math.exp(ev.deltaY * 0.0015);
    zoomAround(canvas, anchorSec, factor);
  };

  const onKeyDown = (ev) => {
    const last = canvas.__ecgLastArgs;
    if (!last) return;
    if (ev.key === 'ArrowLeft') { applyPan(canvas, -0.1); ev.preventDefault(); }
    else if (ev.key === 'ArrowRight') { applyPan(canvas, 0.1); ev.preventDefault(); }
    else if (ev.key === '+' || ev.key === '=') { applyZoom(canvas, 0.8); ev.preventDefault(); }
    else if (ev.key === '-' || ev.key === '_') { applyZoom(canvas, 1.25); ev.preventDefault(); }
    else if (ev.key === 'Home' || ev.key === '0') { resetViewport(canvas); ev.preventDefault(); }
  };

  canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
  if (!canvas.getAttribute('aria-label')) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'ECG waveform. Drag or arrow keys to pan, scroll or plus/minus to zoom, Home to reset. Individual beats are keyboard-focusable below the trace.');
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKeyDown);
  };
}

function zoomAround(canvas, anchorSec, factor) {
  const last = canvas.__ecgLastArgs;
  if (!last) return;
  const { startSec, endSec } = last.viewport;
  const span = Math.max(MIN_SPAN_SEC, (endSec - startSec) * factor);
  const total = last.totalDurationSec;
  const ratio = (anchorSec - startSec) / (endSec - startSec || 1);
  let newStart = anchorSec - ratio * span;
  let newSpan = Math.min(span, Math.max(total, MIN_SPAN_SEC));
  newStart = Math.max(0, Math.min(newStart, Math.max(0, total - newSpan)));
  redrawFromStoredArgs(canvas, { startSec: newStart, endSec: newStart + newSpan });
}

/** Zoom the time axis by `factor` (<1 zooms in, >1 zooms out) around the viewport center. */
export function applyZoom(canvas, factor) {
  const last = canvas.__ecgLastArgs;
  if (!last) return;
  const center = (last.viewport.startSec + last.viewport.endSec) / 2;
  zoomAround(canvas, center, factor);
}

/** Pan by a fraction of the current visible span (negative = earlier in time). */
export function applyPan(canvas, fractionOfSpan) {
  const last = canvas.__ecgLastArgs;
  if (!last) return;
  const span = last.viewport.endSec - last.viewport.startSec;
  const total = last.totalDurationSec;
  let startSec = last.viewport.startSec + fractionOfSpan * span;
  startSec = Math.max(0, Math.min(startSec, Math.max(0, total - span)));
  redrawFromStoredArgs(canvas, { ...last.viewport, startSec, endSec: startSec + span });
}

/** Reset the viewport to show the full recording. */
export function resetViewport(canvas) {
  const last = canvas.__ecgLastArgs;
  if (!last) return;
  redrawFromStoredArgs(canvas, { startSec: 0, endSec: last.totalDurationSec });
}
