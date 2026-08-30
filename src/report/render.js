// Public entry point for the ECG results/report module. Orchestrates the
// waveform, annotations, stats, tachogram, compare and print panels into one
// report. See individual files for the pieces: waveform.js, annotations.js,
// stats.js, tachogram.js, compare.js, warnings.js, print.js.
import { ensureStylesInjected } from './theme.js';
import { clearChildren } from './components.js';
import { renderUncertaintyBanner } from './warnings.js';
import { renderWaveform as drawWaveform, applyZoom, applyPan, resetViewport } from './waveform.js';
import { renderStats as drawStats } from './stats.js';
import { renderTachogram } from './tachogram.js';
import { renderCompare } from './compare.js';
import { buildPrintButton, setupPrintLayout } from './print.js';

const DISCLAIMER_TEXT =
  'Research and educational use only. Not a medical device. Not for diagnosis. Do not use for clinical decisions.';

function panelWithHeading(title, extraClass = '') {
  const panel = document.createElement('section');
  panel.className = `ecg-panel ${extraClass}`.trim();
  const h2 = document.createElement('h2');
  h2.textContent = title;
  panel.appendChild(h2);
  const body = document.createElement('div');
  panel.appendChild(body);
  return { panel, body };
}

function buildWaveformPanel({ extraction, analysis }) {
  const { panel, body } = panelWithHeading('Waveform');
  panel.classList.add('ecg-waveform-panel');
  clearChildren(body);

  const head = document.createElement('div');
  head.className = 'ecg-panel-head';
  const hint = document.createElement('span');
  hint.className = 'ecg-hero-caption ecg-no-print';
  hint.textContent = 'Drag to pan · scroll to zoom';
  head.appendChild(hint);
  const toolbar = document.createElement('div');
  toolbar.className = 'ecg-toolbar ecg-no-print';

  const wrap = document.createElement('div');
  wrap.className = 'ecg-waveform-wrap';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  const lead = extraction?.leads?.[0];
  const samplingRate = extraction?.calibration?.samplingRate;
  const calibrationSource = extraction?.calibration?.source;

  if (calibrationSource !== undefined && calibrationSource !== 'grid') {
    wrap.classList.add('ecg-uncalibrated');
  }

  const makeBtn = (label, onClick, ariaLabel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ecg-btn';
    btn.textContent = label;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', onClick);
    return btn;
  };
  toolbar.append(
    makeBtn('−', () => applyZoom(canvas, 1.4), 'Zoom out'),
    makeBtn('+', () => applyZoom(canvas, 0.7), 'Zoom in'),
    makeBtn('◀', () => applyPan(canvas, -0.2), 'Pan earlier'),
    makeBtn('▶', () => applyPan(canvas, 0.2), 'Pan later'),
    makeBtn('Reset', () => resetViewport(canvas), 'Reset waveform view')
  );
  head.appendChild(toolbar);
  body.append(head, wrap);

  if (!lead || !Array.isArray(lead.samples) || lead.samples.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ecg-compare-placeholder';
    empty.textContent = 'No waveform samples available.';
    wrap.appendChild(empty);
    return panel;
  }

  drawWaveform(canvas, {
    samples: lead.samples,
    samplingRate: Number.isFinite(samplingRate) ? samplingRate : 250,
    beats: analysis?.beats,
    viewport: undefined,
  });

  return panel;
}

/** Draw the ECG grid, trace and (if given) beat annotations into `canvas`. */
export function renderWaveform(canvas, opts) {
  drawWaveform(canvas, opts);
}

/** Render the heart rate / rhythm / interval / RR / HRV stats panel into `container`. */
export function renderStats(container, analysis) {
  drawStats(container, analysis);
}

/** Render the full ECG report (waveform, annotations, stats, tachogram, compare, disclaimer) into `container`. */
export function renderReport(container, { analysis, extraction, imageBitmap } = {}) {
  ensureStylesInjected();
  clearChildren(container);
  container.classList.add('ecg-report');

  const a = analysis || {};
  const e = extraction || {};

  const header = document.createElement('header');
  header.className = 'ecg-header';
  const titleWrap = document.createElement('div');
  const h1 = document.createElement('h1');
  h1.textContent = 'ECG Report';
  const subtitle = document.createElement('div');
  subtitle.className = 'ecg-subtitle';
  const leadLabel = e.leads?.[0]?.label;
  const beatCount = Array.isArray(a.beats) ? a.beats.length : null;
  subtitle.textContent = [
    leadLabel ? `Lead ${leadLabel}` : null,
    beatCount !== null ? `${beatCount} beats analyzed` : null,
  ].filter(Boolean).join(' · ') || 'No lead metadata available';
  titleWrap.append(h1, subtitle);

  const headerToolbar = document.createElement('div');
  headerToolbar.className = 'ecg-toolbar';
  headerToolbar.appendChild(buildPrintButton());

  header.append(titleWrap, headerToolbar);
  container.appendChild(header);

  const banner = document.createElement('div');
  renderUncertaintyBanner(banner, {
    extraction: extraction ? e : undefined,
    warnings: a.warnings,
    flags: a.flags,
  });
  container.appendChild(banner);

  container.appendChild(buildWaveformPanel({ extraction: e, analysis: a }));

  const grid = document.createElement('div');
  grid.className = 'ecg-grid-two';

  const { panel: statsPanel, body: statsBody } = panelWithHeading('Statistics');
  drawStats(statsBody, a);
  grid.appendChild(statsPanel);

  const { panel: tachoPanel, body: tachoBody } = panelWithHeading('RR interval / heart-rate tachogram');
  renderTachogram(tachoBody, a);
  grid.appendChild(tachoPanel);

  container.appendChild(grid);

  const { panel: comparePanel, body: compareBody } = panelWithHeading('Original photo vs. recovered trace');
  renderCompare(compareBody, { imageBitmap, extraction: e });
  container.appendChild(comparePanel);

  const disclaimer = document.createElement('footer');
  disclaimer.className = 'ecg-disclaimer';
  const strong = document.createElement('strong');
  strong.textContent = DISCLAIMER_TEXT;
  disclaimer.appendChild(strong);
  container.appendChild(disclaimer);

  setupPrintLayout(container);
}
