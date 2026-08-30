// Dev harness for src/report/**. Loads the fixture JSON under ./fixtures and
// exercises the three public entry points against both a healthy and a
// degraded (nulls/warnings/uncalibrated) sample, with no server-side
// dependency beyond a static file server (e.g. `ao preview`).
import { renderReport, renderWaveform, renderStats } from './render.js';

const root = document.getElementById('report-root');
const status = document.getElementById('dev-status');
const buttons = {
  healthy: document.getElementById('btn-healthy'),
  degraded: document.getElementById('btn-degraded'),
  statsOnly: document.getElementById('btn-stats-only'),
  waveformOnly: document.getElementById('btn-waveform-only'),
};

function setActive(key) {
  for (const [k, btn] of Object.entries(buttons)) {
    btn.setAttribute('aria-pressed', String(k === key));
  }
}

async function loadFixture(name) {
  const res = await fetch(`./fixtures/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load fixture ${name}: ${res.status}`);
  return res.json();
}

function loadAsImageElement(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image element failed to decode blob'));
    img.src = URL.createObjectURL(blob);
  });
}

async function loadImageBitmap(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  // Chrome's createImageBitmap can fail to decode some SVG blobs directly
  // ("source image could not be decoded") even though an <img> element
  // decodes the same blob fine - fall back rather than losing the photo.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      return loadAsImageElement(blob);
    }
  }
  return loadAsImageElement(blob);
}

async function showFullReport(name) {
  setActive(name);
  status.textContent = `loading ${name}...`;
  root.innerHTML = '';
  try {
    const { analysis, extraction } = await loadFixture(name);
    const imageBitmap = await loadImageBitmap('./fixtures/sample-photo.svg').catch((e) => { console.error('imageBitmap load failed', e); return null; });
    renderReport(root, { analysis, extraction, imageBitmap });
    status.textContent = `showing: ${name} fixture`;
  } catch (err) {
    status.textContent = `error: ${err.message}`;
    throw err;
  }
}

async function showStatsOnly() {
  setActive('statsOnly');
  status.textContent = 'loading healthy fixture (renderStats only)...';
  root.innerHTML = '';
  const { analysis } = await loadFixture('healthy');
  const container = document.createElement('div');
  container.style.maxWidth = '640px';
  container.style.margin = '20px auto';
  root.appendChild(container);
  renderStats(container, analysis);
  status.textContent = 'showing: renderStats(container, analysis) standalone';
}

async function showWaveformOnly() {
  setActive('waveformOnly');
  status.textContent = 'loading degraded fixture (renderWaveform only)...';
  root.innerHTML = '';
  const { analysis, extraction } = await loadFixture('degraded');
  const wrap = document.createElement('div');
  wrap.style.maxWidth = '900px';
  wrap.style.height = '340px';
  wrap.style.margin = '20px auto';
  wrap.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  wrap.appendChild(canvas);
  root.appendChild(wrap);
  const lead = extraction.leads[0];
  renderWaveform(canvas, {
    samples: lead.samples,
    samplingRate: extraction.calibration.samplingRate,
    beats: analysis.beats,
    viewport: undefined,
  });
  status.textContent = 'showing: renderWaveform(canvas, {...}) standalone (no calibration badge - by design, see PR notes)';
}

buttons.healthy.addEventListener('click', () => showFullReport('healthy'));
buttons.degraded.addEventListener('click', () => showFullReport('degraded'));
buttons.statsOnly.addEventListener('click', showStatsOnly);
buttons.waveformOnly.addEventListener('click', showWaveformOnly);

// ?fixture=healthy|degraded and &view=stats|waveform let headless tooling
// (no pointer/click automation) load a specific panel directly on open.
const params = new URLSearchParams(location.search);
const view = params.get('view');
const fixture = params.get('fixture') === 'degraded' ? 'degraded' : 'healthy';
if (view === 'stats') showStatsOnly();
else if (view === 'waveform') showWaveformOnly();
else showFullReport(fixture);
