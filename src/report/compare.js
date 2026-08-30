// Side-by-side original photo vs recovered trace, so the user can sanity
// check the extraction against the source image. Prefers
// extraction.debug.overlay; falls back to redrawing the recovered samples
// when no overlay was produced.
import { ensureStylesInjected } from './theme.js';
import { clearChildren } from './components.js';
import { renderWaveform } from './waveform.js';

function placeholder(cell, text) {
  const el = document.createElement('div');
  el.className = 'ecg-compare-placeholder';
  el.textContent = text;
  cell.appendChild(el);
}

function isDrawable(source) {
  return source && typeof source === 'object' && Number.isFinite(source.width) && Number.isFinite(source.height);
}

function renderOriginalCell(cell, imageBitmap) {
  clearChildren(cell);
  if (!isDrawable(imageBitmap)) {
    placeholder(cell, 'No source image available.');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  try {
    canvas.getContext('2d').drawImage(imageBitmap, 0, 0);
    cell.appendChild(canvas);
  } catch {
    placeholder(cell, 'Unable to render the source image.');
  }
}

function overlaySource(overlay) {
  if (typeof overlay === 'string') return overlay;
  if (overlay && typeof overlay === 'object') {
    if (typeof overlay.url === 'string') return overlay.url;
    if (typeof overlay.dataUrl === 'string') return overlay.dataUrl;
    if (typeof overlay.src === 'string') return overlay.src;
  }
  return null;
}

function buildFallbackTrace(lead, samplingRate) {
  const wrap = document.createElement('div');
  wrap.className = 'ecg-waveform-wrap';
  wrap.style.height = '260px';
  const canvas = document.createElement('canvas');
  canvas.style.height = '260px';
  wrap.appendChild(canvas);
  renderWaveform(canvas, { samples: lead.samples, samplingRate, beats: [] });
  return wrap;
}

function renderOverlayCell(cell, extraction) {
  clearChildren(cell);
  const overlay = extraction?.debug?.overlay;
  const url = overlaySource(overlay);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Extraction overlay: detected grid and traced waveform over the original photo';
    cell.appendChild(img);
    return;
  }
  if (isDrawable(overlay)) {
    const canvas = document.createElement('canvas');
    canvas.width = overlay.width;
    canvas.height = overlay.height;
    try {
      canvas.getContext('2d').drawImage(overlay, 0, 0);
      cell.appendChild(canvas);
      return;
    } catch { /* fall through to sample-based fallback */ }
  }

  const lead = extraction?.leads?.[0];
  const samplingRate = extraction?.calibration?.samplingRate;
  if (lead && Array.isArray(lead.samples) && lead.samples.length > 0 && Number.isFinite(samplingRate)) {
    cell.appendChild(buildFallbackTrace(lead, samplingRate));
    const note = document.createElement('div');
    note.className = 'ecg-compare-caption';
    note.textContent = 'No extraction overlay was provided — showing the recovered samples only.';
    cell.appendChild(note);
    return;
  }
  placeholder(cell, 'No extraction overlay or recovered samples available.');
}

/** Render the original-vs-recovered side-by-side panel into `container`. */
export function renderCompare(container, { imageBitmap, extraction } = {}) {
  ensureStylesInjected();
  clearChildren(container);
  container.classList.add('ecg-report');

  const grid = document.createElement('div');
  grid.className = 'ecg-compare-grid';

  const originalCol = document.createElement('div');
  const originalCell = document.createElement('div');
  originalCell.className = 'ecg-compare-cell';
  renderOriginalCell(originalCell, imageBitmap);
  const originalCaption = document.createElement('div');
  originalCaption.className = 'ecg-compare-caption';
  originalCaption.textContent = 'Original photo';
  originalCol.append(originalCell, originalCaption);

  const overlayCol = document.createElement('div');
  const overlayCell = document.createElement('div');
  overlayCell.className = 'ecg-compare-cell';
  renderOverlayCell(overlayCell, extraction);
  const overlayCaption = document.createElement('div');
  overlayCaption.className = 'ecg-compare-caption';
  overlayCaption.textContent = 'Recovered extraction';
  overlayCol.append(overlayCell, overlayCaption);

  grid.append(originalCol, overlayCol);
  container.appendChild(grid);
}
