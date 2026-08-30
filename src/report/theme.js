// Theme tokens live as CSS custom properties in report.css so the canvas-drawn
// waveform and the DOM chrome always agree on one palette. This module reads
// them at runtime and injects the stylesheet once, without a build step.

let stylesInjected = false;

export function ensureStylesInjected() {
  if (stylesInjected || document.getElementById('ecg-report-styles')) {
    stylesInjected = true;
    return;
  }
  const link = document.createElement('link');
  link.id = 'ecg-report-styles';
  link.rel = 'stylesheet';
  link.href = new URL('./report.css', import.meta.url).href;
  document.head.appendChild(link);
  stylesInjected = true;
}

const cache = new WeakMap();

/** Read a --token off an element's computed style (falls back to documentElement). */
export function themeColor(el, name, fallback = '#ffffff') {
  const target = el && el.isConnected ? el : document.documentElement;
  let bucket = cache.get(target);
  if (!bucket) {
    bucket = new Map();
    cache.set(target, bucket);
  }
  if (bucket.has(name)) return bucket.get(name);
  const value = getComputedStyle(target).getPropertyValue(name).trim();
  const resolved = value || fallback;
  bucket.set(name, resolved);
  return resolved;
}
