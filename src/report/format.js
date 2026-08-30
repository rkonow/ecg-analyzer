// Number/unit formatting helpers shared across the report module.
// Rule: never print "null", "NaN" or a fabricated value - an em dash stands in
// for anything missing.

export const EM_DASH = '—';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Format a single number, or EM_DASH when null/undefined/NaN. */
export function fmtNum(value, { decimals = 0, unit = '', signed = false } = {}) {
  if (!isFiniteNumber(value)) return EM_DASH;
  const sign = signed && value > 0 ? '+' : '';
  const text = `${sign}${value.toFixed(decimals)}`;
  return unit ? `${text} ${unit}` : text;
}

/** Format a percentage already expressed as a 0..1 fraction. */
export function fmtPercent(value, decimals = 0) {
  if (!isFiniteNumber(value)) return EM_DASH;
  return `${(value * 100).toFixed(decimals)} %`;
}

/**
 * Format a {mean, sd, min, max, n|values} stat block as "mean ± sd unit (n=…)".
 * Any missing piece degrades gracefully to an em dash rather than hiding the row.
 */
export function fmtMeanSd(stat, { decimals = 0, unit = '' } = {}) {
  if (!stat || typeof stat !== 'object') {
    return { mean: EM_DASH, sd: EM_DASH, n: EM_DASH, minMax: EM_DASH, summary: EM_DASH };
  }
  const n = isFiniteNumber(stat.n)
    ? stat.n
    : Array.isArray(stat.values)
      ? stat.values.length
      : null;
  const mean = fmtNum(stat.mean, { decimals, unit });
  const sd = fmtNum(stat.sd, { decimals, unit });
  const minMax = isFiniteNumber(stat.min) && isFiniteNumber(stat.max)
    ? `${stat.min.toFixed(decimals)}–${stat.max.toFixed(decimals)} ${unit}`.trim()
    : EM_DASH;
  const summary = sd === EM_DASH ? mean : `${mean} ± ${sd}`;
  return { mean, sd, n: isFiniteNumber(n) ? String(n) : EM_DASH, minMax, summary };
}

/** Normalize a numeric (0..1) or string confidence value to a status bucket. */
export function confidenceBucket(confidence) {
  if (typeof confidence === 'string') {
    const s = confidence.toLowerCase();
    if (['high', 'good'].includes(s)) return 'good';
    if (['medium', 'moderate', 'fair'].includes(s)) return 'warning';
    if (['low', 'poor'].includes(s)) return 'serious';
    return 'unknown';
  }
  if (isFiniteNumber(confidence)) {
    if (confidence >= 0.8) return 'good';
    if (confidence >= 0.5) return 'warning';
    return 'serious';
  }
  return 'unknown';
}

export function confidenceLabel(confidence) {
  if (typeof confidence === 'string') return confidence;
  if (isFiniteNumber(confidence)) return `${Math.round(confidence * 100)}%`;
  return EM_DASH;
}

export { isFiniteNumber };
