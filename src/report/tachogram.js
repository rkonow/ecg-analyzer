// RR interval / heart-rate tachogram: a single-series line chart over time,
// with a crosshair+tooltip hover layer and a table-view fallback (dataviz
// accessibility rule: a table view always exists alongside a chart).
import { ensureStylesInjected } from './theme.js';
import { clearChildren } from './components.js';
import { fmtNum, EM_DASH, isFiniteNumber } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VB_W = 600;
const VB_H = 200;
const MARGIN = { left: 42, right: 12, top: 10, bottom: 26 };

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildPoints(analysis) {
  const values = analysis?.intervals?.rrMs?.values;
  const beats = analysis?.beats;
  if (!Array.isArray(values) || values.length === 0 || !Array.isArray(beats)) return [];
  const points = [];
  for (let i = 0; i < values.length; i++) {
    const rr = values[i];
    if (!isFiniteNumber(rr)) continue;
    const beat = beats[i + 1] || beats[i];
    const tSec = beat && isFiniteNumber(beat.tSec) ? beat.tSec : null;
    if (tSec === null) continue;
    points.push({ tSec, rrMs: rr, hrBpm: 60000 / rr, beatIndex: i });
  }
  return points;
}

function niceTicks(min, max, count) {
  if (min === max) return [min];
  const span = max - min;
  const step = span / count;
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push(min + step * i);
  return ticks;
}

function buildChart(points) {
  const wrap = document.createElement('div');
  wrap.className = 'ecg-tacho-wrap';

  if (points.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ecg-compare-placeholder';
    empty.textContent = 'No RR interval data available.';
    wrap.appendChild(empty);
    return wrap;
  }

  const times = points.map((p) => p.tSec);
  const rrs = points.map((p) => p.rrMs);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const rrMin = Math.min(...rrs);
  const rrMax = Math.max(...rrs);
  const rrPad = Math.max((rrMax - rrMin) * 0.15, 20);
  const yMin = rrMin - rrPad;
  const yMax = rrMax + rrPad;

  const plotW = VB_W - MARGIN.left - MARGIN.right;
  const plotH = VB_H - MARGIN.top - MARGIN.bottom;
  const xFor = (t) => MARGIN.left + ((t - tMin) / (tMax - tMin || 1)) * plotW;
  const yFor = (rr) => MARGIN.top + plotH - ((rr - yMin) / (yMax - yMin || 1)) * plotH;

  const svg = svgEl('svg', {
    class: 'ecg-tachogram-svg',
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    role: 'img',
    'aria-label': 'RR interval tachogram over time. Use the table view for exact values.',
    preserveAspectRatio: 'none',
  });

  const yTicks = niceTicks(yMin, yMax, 4);
  for (const yv of yTicks) {
    const y = yFor(yv);
    svg.appendChild(svgEl('line', { class: 'ecg-gridline', x1: MARGIN.left, x2: VB_W - MARGIN.right, y1: y, y2: y }));
    const label = svgEl('text', { class: 'ecg-axis-tick', x: MARGIN.left - 6, y: y + 3, 'text-anchor': 'end' });
    label.textContent = yv.toFixed(0);
    svg.appendChild(label);
  }
  const xTicks = niceTicks(tMin, tMax, 4);
  for (const tv of xTicks) {
    const x = xFor(tv);
    const label = svgEl('text', { class: 'ecg-axis-tick', x, y: VB_H - MARGIN.bottom + 14, 'text-anchor': 'middle' });
    label.textContent = `${tv.toFixed(1)}s`;
    svg.appendChild(label);
  }

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.tSec).toFixed(1)} ${yFor(p.rrMs).toFixed(1)}`).join(' ');
  svg.appendChild(svgEl('path', { class: 'ecg-tacho-line', d: pathD }));

  const pointEls = points.map((p) => {
    const c = svgEl('circle', { class: 'ecg-tacho-point', cx: xFor(p.tSec), cy: yFor(p.rrMs), r: 3 });
    svg.appendChild(c);
    return c;
  });

  const crosshair = svgEl('line', { class: 'ecg-tacho-crosshair', y1: MARGIN.top, y2: VB_H - MARGIN.bottom, x1: -100, x2: -100 });
  svg.appendChild(crosshair);

  const tooltip = document.createElement('div');
  tooltip.className = 'ecg-beat-tooltip';
  tooltip.setAttribute('role', 'status');
  wrap.style.position = 'relative';

  const showAt = (index) => {
    const p = points[index];
    crosshair.setAttribute('x1', xFor(p.tSec));
    crosshair.setAttribute('x2', xFor(p.tSec));
    pointEls.forEach((el, i) => el.setAttribute('r', i === index ? 4.5 : 3));
    clearChildren(tooltip);
    const title = document.createElement('div');
    title.className = 'ecg-tooltip-title';
    title.textContent = `t = ${p.tSec.toFixed(2)} s`;
    const dl = document.createElement('dl');
    for (const [label, value] of [['RR', `${p.rrMs.toFixed(0)} ms`], ['HR', `${p.hrBpm.toFixed(0)} bpm`]]) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    tooltip.append(title, dl);
    const rect = wrap.getBoundingClientRect();
    const xCss = (xFor(p.tSec) / VB_W) * rect.width;
    tooltip.style.left = `${Math.min(rect.width - 170, Math.max(4, xCss + 10))}px`;
    tooltip.style.top = '4px';
    tooltip.classList.add('ecg-visible');
  };
  const hide = () => {
    crosshair.setAttribute('x1', -100);
    crosshair.setAttribute('x2', -100);
    pointEls.forEach((el) => el.setAttribute('r', 3));
    tooltip.classList.remove('ecg-visible');
  };

  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const xCss = ev.clientX - rect.left;
    const xUser = (xCss / rect.width) * VB_W;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(xFor(p.tSec) - xUser);
      if (d < best) { best = d; nearest = i; }
    });
    showAt(nearest);
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', hide);
  svg.tabIndex = 0;
  svg.addEventListener('focus', () => showAt(0));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (ev) => {
    const current = pointEls.findIndex((el) => Number(el.getAttribute('r')) > 3);
    const idx = current === -1 ? 0 : current;
    if (ev.key === 'ArrowRight') { showAt(Math.min(points.length - 1, idx + 1)); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { showAt(Math.max(0, idx - 1)); ev.preventDefault(); }
  });

  wrap.append(svg, tooltip);
  return wrap;
}

function buildTable(points) {
  const scroll = document.createElement('div');
  scroll.className = 'ecg-data-table-scroll';
  const table = document.createElement('table');
  table.className = 'ecg-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Beat', 'Time (s)', 'RR (ms)', 'HR (bpm)']) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const p of points) {
    const tr = document.createElement('tr');
    const cells = [
      String(p.beatIndex + 1),
      fmtNum(p.tSec, { decimals: 2 }),
      fmtNum(p.rrMs, { decimals: 0 }),
      fmtNum(p.hrBpm, { decimals: 0 }),
    ];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) cell.scope = 'row';
      cell.textContent = text || EM_DASH;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  scroll.hidden = true;
  return scroll;
}

/** Render the RR/HR tachogram (+ table-view toggle) into `container`. */
export function renderTachogram(container, analysis) {
  ensureStylesInjected();
  clearChildren(container);
  container.classList.add('ecg-report');

  const points = buildPoints(analysis);
  container.appendChild(buildChart(points));

  const toggleWrap = document.createElement('div');
  toggleWrap.className = 'ecg-table-toggle-wrap';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ecg-btn ecg-no-print';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.textContent = 'View as table';
  const table = buildTable(points);
  toggle.addEventListener('click', () => {
    const showing = !table.hidden;
    table.hidden = showing;
    toggle.setAttribute('aria-pressed', String(!showing));
    toggle.textContent = showing ? 'View as table' : 'Hide table';
  });
  toggleWrap.append(toggle, table);
  container.appendChild(toggleWrap);
}
