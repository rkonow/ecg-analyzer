// Per-beat P/Q/R/S/T annotation layer: markers, interval shading/brackets,
// and the hover/tap/keyboard-reachable beat inspector.
import { themeColor } from './theme.js';
import { fmtNum, EM_DASH } from './format.js';

const WAVE_KEYS = ['p', 'q', 'r', 's', 't'];

function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolve a single wave entry to {tSec, amplitudeMv} or null if unplaceable.
 * Q/R/S carry {index, amplitudeMv}; P/T carry {onset, peak, offset,
 * amplitudeMv} (analyze.js's delineate.js) - `peak` is their position.
 */
function resolveWave(wave, samples, samplingRate) {
  if (!wave) return null;
  const idx = Number.isFinite(wave.index)
    ? wave.index
    : Number.isFinite(wave.peak)
      ? wave.peak
      : null;
  const tSec = Number.isFinite(wave.tSec) ? wave.tSec : (idx !== null ? idx / samplingRate : null);
  if (tSec === null) return null;
  const amplitudeMv = Number.isFinite(wave.amplitudeMv)
    ? wave.amplitudeMv
    : (idx !== null && Number.isFinite(samples[idx]) ? samples[idx] : null);
  return { tSec, amplitudeMv };
}

/** Resolve every wave on a beat, falling back to rIndex for R when needed. */
function resolveBeatWaves(beat, samples, samplingRate) {
  const waves = {};
  for (const key of WAVE_KEYS) {
    waves[key] = resolveWave(beat[key], samples, samplingRate);
  }
  if (!waves.r && Number.isFinite(beat.rIndex)) {
    waves.r = resolveWave({ index: beat.rIndex, tSec: beat.tSec }, samples, samplingRate);
  }
  return waves;
}

function deriveIntervals(waves) {
  const prMs = waves.p && waves.q ? (waves.q.tSec - waves.p.tSec) * 1000 : null;
  const qrsMs = waves.q && waves.s ? (waves.s.tSec - waves.q.tSec) * 1000 : null;
  const qtMs = waves.q && waves.t ? (waves.t.tSec - waves.q.tSec) * 1000 : null;
  return { prMs, qrsMs, qtMs };
}

/** Translucent vertical wash for PR / QRS / QT spans, drawn under the trace. */
export function drawIntervalShading(ctx, layout, beats, samples, samplingRate) {
  const prColor = themeColor(ctx.canvas, '--ecg-bracket-pr', '#3987e5');
  const qrsColor = themeColor(ctx.canvas, '--ecg-bracket-qrs', '#d95926');
  const qtColor = themeColor(ctx.canvas, '--ecg-bracket-qt', '#9085e9');
  const { plotTop, plotHeight, viewport } = layout;

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.plotLeft, plotTop, layout.plotWidth, plotHeight);
  ctx.clip();

  for (const beat of beats) {
    if (beat.tSec < viewport.startSec - 1 || beat.tSec > viewport.endSec + 1) continue;
    const waves = resolveBeatWaves(beat, samples, samplingRate);
    const spans = [
      [waves.p, waves.q, prColor],
      [waves.q, waves.s, qrsColor],
      [waves.q, waves.t, qtColor],
    ];
    for (const [from, to, color] of spans) {
      if (!from || !to) continue;
      const x1 = layout.xForSec(from.tSec);
      const x2 = layout.xForSec(to.tSec);
      ctx.fillStyle = hexToRgba(color, 0.08);
      ctx.fillRect(Math.min(x1, x2), plotTop, Math.abs(x2 - x1), plotHeight);
    }
  }
  ctx.restore();
}

function drawMarker(ctx, x, y, color, bg, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBrackets(ctx, layout, beats, samples, samplingRate) {
  const prColor = themeColor(ctx.canvas, '--ecg-bracket-pr', '#3987e5');
  const qrsColor = themeColor(ctx.canvas, '--ecg-bracket-qrs', '#d95926');
  const qtColor = themeColor(ctx.canvas, '--ecg-bracket-qt', '#9085e9');
  const rows = [6, 18, 30].map((dy) => layout.bracketBandTop + dy);

  const drawSpan = (from, to, color, y) => {
    if (!from || !to) return;
    const x1 = layout.xForSec(from.tSec);
    const x2 = layout.xForSec(to.tSec);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.moveTo(x1, y - 3);
    ctx.lineTo(x1, y + 3);
    ctx.moveTo(x2, y - 3);
    ctx.lineTo(x2, y + 3);
    ctx.stroke();
  };

  ctx.save();
  for (const beat of beats) {
    if (beat.tSec < layout.viewport.startSec - 1 || beat.tSec > layout.viewport.endSec + 1) continue;
    const waves = resolveBeatWaves(beat, samples, samplingRate);
    drawSpan(waves.p, waves.q, prColor, rows[0]);
    drawSpan(waves.q, waves.s, qrsColor, rows[1]);
    drawSpan(waves.q, waves.t, qtColor, rows[2]);
  }
  ctx.restore();
}

function drawMarkers(ctx, layout, beats, samples, samplingRate) {
  const markerColor = themeColor(ctx.canvas, '--ecg-marker', '#7fb4f2');
  const bg = themeColor(ctx.canvas, '--ecg-grid-bg', '#160b0d');
  const labelColor = themeColor(ctx.canvas, '--ecg-ink-secondary', '#a8a8a3');
  const font = themeColor(ctx.canvas, '--ecg-font-mono', 'ui-monospace, monospace');

  ctx.save();
  ctx.font = `bold 10px ${font}`;
  ctx.textAlign = 'center';

  for (const beat of beats) {
    if (beat.tSec < layout.viewport.startSec - 0.5 || beat.tSec > layout.viewport.endSec + 0.5) continue;
    const waves = resolveBeatWaves(beat, samples, samplingRate);
    for (const key of WAVE_KEYS) {
      const w = waves[key];
      if (!w) continue;
      const x = layout.xForSec(w.tSec);
      const y = layout.yForMv(w.amplitudeMv ?? 0);
      const radius = key === 'r' ? 4.5 : 3.5;
      drawMarker(ctx, x, y, markerColor, bg, radius);
      const above = (w.amplitudeMv ?? 0) >= 0;
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillStyle = labelColor;
      ctx.fillText(key.toUpperCase(), x, above ? y - radius - 4 : y + radius + 4);
    }
  }
  ctx.restore();
}

function buildBeatDetail(beat, waves, intervals) {
  const rows = WAVE_KEYS.map((key) => {
    const w = waves[key];
    const time = w ? fmtNum(w.tSec, { decimals: 3, unit: 's' }) : EM_DASH;
    const amp = w && Number.isFinite(w.amplitudeMv) ? fmtNum(w.amplitudeMv, { decimals: 2, unit: 'mV' }) : EM_DASH;
    return { label: key.toUpperCase(), time, amp };
  });
  return {
    title: `Beat ${Number.isFinite(beat.index) ? beat.index + 1 : ''}`.trim(),
    rows,
    pr: fmtNum(intervals.prMs, { decimals: 0, unit: 'ms' }),
    qrs: fmtNum(intervals.qrsMs, { decimals: 0, unit: 'ms' }),
    qt: fmtNum(intervals.qtMs, { decimals: 0, unit: 'ms' }),
  };
}

function ensureWrap(canvas) {
  const parent = canvas.parentElement;
  if (!parent) return null;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  // Guarantees the CSS custom properties (theme tokens) resolve even when
  // renderWaveform is called standalone, outside renderReport's root.
  if (!parent.closest('.ecg-report')) {
    parent.classList.add('ecg-report');
  }
  return parent;
}

function ensureChild(parent, selector, tagName, className) {
  let el = parent.querySelector(selector);
  if (!el) {
    el = document.createElement(tagName);
    el.className = className;
    parent.appendChild(el);
  }
  return el;
}

function renderTooltip(tooltipEl, detail, x, y, wrapWidth) {
  tooltipEl.textContent = '';
  const title = document.createElement('div');
  title.className = 'ecg-tooltip-title';
  title.textContent = detail.title;
  const dl = document.createElement('dl');
  for (const row of detail.rows) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = `${row.time} · ${row.amp}`;
    dl.append(dt, dd);
  }
  const summaryDt = document.createElement('dt');
  summaryDt.textContent = 'PR / QRS / QT';
  const summaryDd = document.createElement('dd');
  summaryDd.textContent = `${detail.pr} / ${detail.qrs} / ${detail.qt}`;
  dl.append(summaryDt, summaryDd);
  tooltipEl.append(title, dl);

  const tooltipWidth = 190;
  let left = x + 12;
  if (left + tooltipWidth > wrapWidth) left = x - tooltipWidth - 12;
  tooltipEl.style.left = `${Math.max(4, left)}px`;
  tooltipEl.style.top = `${Math.max(4, y - 10)}px`;
  tooltipEl.classList.add('ecg-visible');
}

function buildLegend(parent) {
  const legend = ensureChild(parent, '.ecg-legend', 'div', 'ecg-legend');
  legend.textContent = '';
  legend.setAttribute('aria-hidden', 'true');
  const items = [
    { label: 'PR interval', varName: '--ecg-bracket-pr' },
    { label: 'QRS complex', varName: '--ecg-bracket-qrs' },
    { label: 'QT interval', varName: '--ecg-bracket-qt' },
    { label: 'P·Q·R·S·T markers', varName: '--ecg-marker' },
  ];
  for (const item of items) {
    const wrap = document.createElement('span');
    wrap.className = 'ecg-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'ecg-legend-swatch';
    swatch.style.background = `var(${item.varName})`;
    const label = document.createElement('span');
    label.textContent = item.label;
    wrap.append(swatch, label);
    legend.appendChild(wrap);
  }
}

/**
 * Draw markers + brackets on the canvas and wire the DOM beat-inspector
 * (hover, tap, keyboard focus) as sibling elements over the plot area.
 * Returns a cleanup function.
 */
export function renderAnnotations({ canvas, ctx, layout, beats, samples, samplingRate }) {
  drawBrackets(ctx, layout, beats, samples, samplingRate);
  drawMarkers(ctx, layout, beats, samples, samplingRate);

  const wrap = ensureWrap(canvas);
  if (!wrap) return null;

  buildLegend(wrap);
  const tooltip = ensureChild(wrap, '.ecg-beat-tooltip', 'div', 'ecg-beat-tooltip');
  tooltip.setAttribute('role', 'status');
  const hits = ensureChild(wrap, '.ecg-beat-hits', 'div', 'ecg-beat-hits ecg-no-print');
  Object.assign(hits.style, {
    position: 'absolute',
    left: `${layout.plotLeft}px`,
    top: `${layout.plotTop}px`,
    width: `${layout.plotWidth}px`,
    height: `${layout.plotHeight}px`,
    pointerEvents: 'none',
  });
  hits.textContent = '';

  const listeners = [];
  let pinned = false;

  const hideTooltip = () => {
    tooltip.classList.remove('ecg-visible');
  };

  for (const beat of beats) {
    if (beat.tSec < layout.viewport.startSec - 0.5 || beat.tSec > layout.viewport.endSec + 0.5) continue;
    const waves = resolveBeatWaves(beat, samples, samplingRate);
    const intervals = deriveIntervals(waves);
    const detail = buildBeatDetail(beat, waves, intervals);
    const xCenter = layout.xForSec(beat.tSec) - layout.plotLeft;
    const width = 26;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ecg-beat-hit-btn';
    btn.setAttribute(
      'aria-label',
      `${detail.title}: P ${detail.rows[0].time}, Q ${detail.rows[1].time}, R ${detail.rows[2].time}, S ${detail.rows[3].time}, T ${detail.rows[4].time}. PR ${detail.pr}, QRS ${detail.qrs}, QT ${detail.qt}.`
    );
    Object.assign(btn.style, {
      position: 'absolute',
      left: `${xCenter - width / 2}px`,
      top: '0px',
      width: `${width}px`,
      height: '100%',
      background: 'transparent',
      border: 'none',
      padding: '0',
      margin: '0',
      cursor: 'pointer',
      pointerEvents: 'auto',
    });

    const show = () => {
      renderTooltip(tooltip, detail, layout.xForSec(beat.tSec), layout.plotTop, wrap.clientWidth || canvas.clientWidth);
    };
    const onEnter = () => { if (!pinned) show(); };
    const onLeave = () => { if (!pinned) hideTooltip(); };
    const onFocus = () => show();
    const onBlur = () => { if (!pinned) hideTooltip(); };
    const onClick = () => {
      if (pinned) { pinned = false; hideTooltip(); }
      else { pinned = true; show(); }
    };

    btn.addEventListener('pointerenter', onEnter);
    btn.addEventListener('pointerleave', onLeave);
    btn.addEventListener('focus', onFocus);
    btn.addEventListener('blur', onBlur);
    btn.addEventListener('click', onClick);
    listeners.push(() => {
      btn.removeEventListener('pointerenter', onEnter);
      btn.removeEventListener('pointerleave', onLeave);
      btn.removeEventListener('focus', onFocus);
      btn.removeEventListener('blur', onBlur);
      btn.removeEventListener('click', onClick);
    });

    hits.appendChild(btn);
  }

  return () => {
    listeners.forEach((fn) => fn());
    hideTooltip();
  };
}
