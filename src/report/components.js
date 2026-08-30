// Tiny shared DOM builders used across the stats, warnings and compare panels.

/** A status chip: colored dot + icon-free label, per the dataviz "icon+label,
 * never color alone" rule the label text itself carries the meaning. */
export function buildChip(status, label) {
  const el = document.createElement('span');
  el.className = 'ecg-chip';
  el.dataset.status = status || 'unknown';
  el.textContent = label;
  return el;
}

/** A muted-label / mono-value pair used in the uncertainty banner. */
export function buildKv(label, value) {
  const wrap = document.createElement('span');
  wrap.className = 'ecg-kv';
  const l = document.createElement('span');
  l.textContent = `${label}:`;
  const v = document.createElement('span');
  v.className = 'ecg-mono';
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

export function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
