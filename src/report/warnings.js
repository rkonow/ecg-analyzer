// Uncertainty banner: extraction quality, calibration source and every
// warnings[] entry, surfaced prominently rather than buried in a details
// disclosure. This is the single most important correctness requirement in
// the report module - never let confident-looking numbers hide a shaky
// extraction.
import { ensureStylesInjected } from './theme.js';
import { buildChip, buildKv, clearChildren } from './components.js';
import { confidenceBucket, confidenceLabel } from './format.js';

function leadQualityLabel(leads) {
  if (!Array.isArray(leads) || leads.length === 0) return null;
  const qualities = leads.map((l) => l && l.quality).filter((q) => q !== undefined && q !== null);
  if (qualities.length === 0) return null;
  const numeric = qualities.every((q) => typeof q === 'number');
  if (numeric) {
    const min = Math.min(...qualities);
    return { bucket: confidenceBucket(min), label: confidenceLabel(min) };
  }
  const worst = qualities.find((q) => confidenceBucket(q) !== 'good') || qualities[0];
  return { bucket: confidenceBucket(worst), label: String(worst) };
}

/**
 * Render the uncertainty banner into `container`.
 * `extraction` is optional - stats-only callers (renderStats) pass just
 * analysis-level warnings/flags and omit calibration/quality rows.
 */
export function renderUncertaintyBanner(container, { title = 'Data quality & uncertainty', extraction, warnings = [], flags = [] } = {}) {
  ensureStylesInjected();
  clearChildren(container);
  container.className = 'ecg-banner';

  const allWarnings = [...(warnings || []), ...(extraction?.warnings || [])];
  const hasCritical = extraction && extraction.ok === false;
  const calibrationSource = extraction?.calibration?.source;
  const uncalibrated = calibrationSource !== undefined && calibrationSource !== 'grid';

  container.dataset.severity = hasCritical ? 'critical' : (allWarnings.length > 0 || uncalibrated ? 'warning' : 'good');

  const h = document.createElement('h2');
  h.textContent = title;
  container.appendChild(h);

  if (extraction) {
    const row = document.createElement('div');
    row.className = 'ecg-banner-row';

    const gridChip = buildChip(
      extraction.grid?.detected ? 'good' : 'serious',
      extraction.grid?.detected ? 'Grid detected' : 'Grid not detected'
    );
    row.appendChild(gridChip);

    const calChip = buildChip(
      calibrationSource === 'grid' ? 'good' : 'warning',
      calibrationSource ? `Calibration: ${calibrationSource}` : 'Calibration: unknown'
    );
    row.appendChild(calChip);

    const quality = leadQualityLabel(extraction.leads);
    if (quality) {
      row.appendChild(buildChip(quality.bucket, `Lead quality: ${quality.label}`));
    }

    if (uncalibrated) {
      row.appendChild(buildKv('Amplitude values', 'approximate — not calibrated against the grid'));
    }

    container.appendChild(row);
  }

  if (flags && flags.length > 0) {
    const row = document.createElement('div');
    row.className = 'ecg-banner-row';
    for (const flag of flags) {
      row.appendChild(buildChip('warning', String(flag)));
    }
    container.appendChild(row);
  }

  if (allWarnings.length > 0) {
    const list = document.createElement('ul');
    list.className = 'ecg-warning-list';
    for (const w of allWarnings) {
      const li = document.createElement('li');
      li.textContent = String(w);
      list.appendChild(li);
    }
    container.appendChild(list);
  } else if (!extraction) {
    const none = document.createElement('div');
    none.className = 'ecg-banner-row';
    none.textContent = 'No warnings reported.';
    container.appendChild(none);
  }

  return container;
}
