// Stats panel: heart rate, rhythm, interval table, RR statistics, HRV.
// Every number is unit-labelled; every missing value renders as an em dash -
// never "null", "NaN", or a guessed number.
import { ensureStylesInjected } from './theme.js';
import { buildChip, clearChildren } from './components.js';
import { renderUncertaintyBanner } from './warnings.js';
import { fmtNum, fmtMeanSd, confidenceBucket, confidenceLabel, EM_DASH, isFiniteNumber } from './format.js';

// hrv.js always reports pnn50 as an already-computed 0-100 percentage
// (nn50 / diffs.length * 100) - format it directly, never rescale.
function fmtPnn50(value) {
  return isFiniteNumber(value) ? `${value.toFixed(1)} %` : EM_DASH;
}

function buildHeartRateSection(heartRate) {
  const section = document.createElement('div');
  section.className = 'ecg-stat-row';

  const heroWrap = document.createElement('div');
  const hero = document.createElement('div');
  hero.className = 'ecg-hero ecg-mono';
  const bpm = heartRate?.bpm;
  hero.textContent = isFiniteNumber(bpm) ? bpm.toFixed(0) : EM_DASH;
  const unit = document.createElement('span');
  unit.className = 'ecg-hero-unit';
  unit.textContent = ' bpm';
  hero.appendChild(unit);
  heroWrap.appendChild(hero);

  const caption = document.createElement('div');
  caption.className = 'ecg-hero-caption';
  caption.textContent = heartRate?.method ? `Method: ${heartRate.method}` : 'Method: —';
  heroWrap.appendChild(caption);

  section.appendChild(heroWrap);

  const bucket = confidenceBucket(heartRate?.confidence);
  const label = confidenceLabel(heartRate?.confidence);
  section.appendChild(buildChip(bucket, label === EM_DASH ? 'Confidence: —' : `Confidence: ${label}`));

  return section;
}

function buildRhythmSection(rhythm) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'ecg-stat-row';

  const bucket = rhythm?.regular === true ? 'good' : rhythm?.regular === false ? 'serious' : 'unknown';
  const label = rhythm?.regular === true ? 'Regular' : rhythm?.regular === false ? 'Irregular' : 'Regularity unknown';
  row.appendChild(buildChip(bucket, label));

  const classification = document.createElement('strong');
  classification.textContent = rhythm?.classification || EM_DASH;
  row.appendChild(classification);
  wrap.appendChild(row);

  if (rhythm?.note) {
    const note = document.createElement('div');
    note.className = 'ecg-rhythm-note';
    note.textContent = rhythm.note;
    wrap.appendChild(note);
  }
  return wrap;
}

function buildIntervalTable(intervals) {
  const table = document.createElement('table');
  table.className = 'ecg-table';
  const caption = document.createElement('caption');
  caption.textContent = 'Intervals (mean ± sd, n beats)';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const h of ['Interval', 'Mean ± SD', 'n']) {
    const th = document.createElement('th');
    th.textContent = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // intervals.js only ever reports {mean, sd, n} for PR/QRS/QT (no
  // min/max - that's RR-only, shown separately) and {mean, formula} for
  // QTc (no sd/n at all), so there is no "range" column to show here.
  const rows = [
    ['PR', intervals?.prMs],
    ['QRS', intervals?.qrsMs],
    ['QT', intervals?.qtMs],
    [intervals?.qtcMs?.formula ? `QTc (${intervals.qtcMs.formula})` : 'QTc', intervals?.qtcMs],
  ];
  for (const [label, stat] of rows) {
    const formatted = fmtMeanSd(stat, { decimals: 0, unit: 'ms' });
    const tr = document.createElement('tr');
    const cells = [label, formatted.summary, formatted.n];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) cell.scope = 'row';
      cell.textContent = text;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function buildRrSection(rrMs) {
  const wrap = document.createElement('div');
  const subhead = document.createElement('div');
  subhead.className = 'ecg-subhead';
  subhead.textContent = 'RR interval statistics';
  wrap.appendChild(subhead);

  const formatted = fmtMeanSd(rrMs, { decimals: 0, unit: 'ms' });
  const grid = document.createElement('div');
  grid.className = 'ecg-stat-grid';
  const tiles = [
    ['Mean', formatted.mean],
    ['SD', formatted.sd],
    ['Range', formatted.minMax],
    ['n', formatted.n],
  ];
  for (const [label, value] of tiles) {
    grid.appendChild(buildStatTile(label, value));
  }
  wrap.appendChild(grid);
  return wrap;
}

function buildStatTile(label, value) {
  const tile = document.createElement('div');
  tile.className = 'ecg-stat-tile';
  const l = document.createElement('div');
  l.className = 'ecg-stat-label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'ecg-stat-value ecg-mono';
  v.textContent = value;
  tile.append(l, v);
  return tile;
}

function buildHrvSection(hrv) {
  const wrap = document.createElement('div');
  const subhead = document.createElement('div');
  subhead.className = 'ecg-subhead';
  subhead.textContent = 'Heart rate variability';
  wrap.appendChild(subhead);

  const grid = document.createElement('div');
  grid.className = 'ecg-stat-grid';
  grid.appendChild(buildStatTile('SDNN', fmtNum(hrv?.sdnnMs, { decimals: 1, unit: 'ms' })));
  grid.appendChild(buildStatTile('RMSSD', fmtNum(hrv?.rmssdMs, { decimals: 1, unit: 'ms' })));
  grid.appendChild(buildStatTile('pNN50', fmtPnn50(hrv?.pnn50)));
  wrap.appendChild(grid);
  return wrap;
}

function buildAxisSection(axis) {
  const wrap = document.createElement('div');
  const subhead = document.createElement('div');
  subhead.className = 'ecg-subhead';
  subhead.textContent = 'Electrical axis';
  wrap.appendChild(subhead);
  const row = document.createElement('div');
  row.className = 'ecg-stat-row';
  row.appendChild(buildStatTile('Axis', fmtNum(axis?.degrees, { decimals: 0, unit: '°' })));
  wrap.appendChild(row);
  if (axis?.note) {
    const note = document.createElement('div');
    note.className = 'ecg-rhythm-note';
    note.textContent = axis.note;
    wrap.appendChild(note);
  }
  return wrap;
}

/** Render the stats panel (heart rate, rhythm, intervals, RR, HRV, axis, warnings) into `container`. */
export function renderStats(container, analysis) {
  ensureStylesInjected();
  clearChildren(container);
  container.classList.add('ecg-report');

  const a = analysis || {};

  const banner = document.createElement('div');
  renderUncertaintyBanner(banner, { title: 'Analysis warnings', warnings: a.warnings, flags: a.flags });
  if ((a.warnings && a.warnings.length) || (a.flags && a.flags.length)) {
    container.appendChild(banner);
  }

  container.appendChild(buildHeartRateSection(a.heartRate));
  container.appendChild(buildRhythmSection(a.rhythm));
  container.appendChild(buildIntervalTable(a.intervals));
  container.appendChild(buildRrSection(a.intervals?.rrMs));
  container.appendChild(buildHrvSection(a.hrv));
  container.appendChild(buildAxisSection(a.axis));
}
