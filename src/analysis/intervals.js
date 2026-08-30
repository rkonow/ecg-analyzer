// Interval measurement: RR statistics, PR, QRS duration, QT and Bazett QTc.
// Every value here is derived from indices actually located by delineate.js;
// beats missing the needed landmarks are excluded from that interval's
// aggregate (reflected in its `n` count) rather than estimated.

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function stdDev(values, avg) {
  if (values.length < 2) return values.length === 1 ? 0 : null;
  const m = avg ?? mean(values);
  const variance = values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

function summarize(values) {
  if (values.length === 0) return { mean: null, sd: null, n: 0 };
  const m = mean(values);
  return { mean: m, sd: stdDev(values, m), n: values.length };
}

export function computeRRStats(rIndices, samplingRate) {
  if (rIndices.length < 2) {
    return { mean: null, sd: null, min: null, max: null, values: [] };
  }
  const values = [];
  for (let i = 1; i < rIndices.length; i++) {
    values.push(((rIndices[i] - rIndices[i - 1]) / samplingRate) * 1000);
  }
  const m = mean(values);
  return {
    mean: m,
    sd: stdDev(values, m),
    min: Math.min(...values),
    max: Math.max(...values),
    values,
  };
}

export function computeIntervals(beats, samplingRate) {
  const prValues = [];
  const qrsValues = [];
  const qtValues = [];
  const qtcValues = [];

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const qrsOnset = b.qrsOnsetIdx ?? b.qIdx ?? null;
    const qrsOffset = b.qrsOffsetIdx ?? b.sIdx ?? null;

    if (b.p && b.p.onset !== null && qrsOnset !== null) {
      const prMs = ((qrsOnset - b.p.onset) / samplingRate) * 1000;
      if (prMs > 0) prValues.push(prMs);
    }

    if (qrsOnset !== null && qrsOffset !== null && qrsOffset > qrsOnset) {
      qrsValues.push(((qrsOffset - qrsOnset) / samplingRate) * 1000);
    }

    if (qrsOnset !== null && b.t && b.t.offset !== null) {
      const qtMs = ((b.t.offset - qrsOnset) / samplingRate) * 1000;
      if (qtMs > 0) {
        qtValues.push(qtMs);

        const prevRR = i > 0 ? beats[i].rIndex - beats[i - 1].rIndex : null;
        const nextRR = i < beats.length - 1 ? beats[i + 1].rIndex - beats[i].rIndex : null;
        const rrSamples = prevRR ?? nextRR;
        if (rrSamples) {
          const rrSec = rrSamples / samplingRate;
          qtcValues.push(qtMs / Math.sqrt(rrSec));
        }
      }
    }
  }

  return {
    rrMs: computeRRStats(beats.map((b) => b.rIndex), samplingRate),
    prMs: summarize(prValues),
    qrsMs: summarize(qrsValues),
    qtMs: summarize(qtValues),
    qtcMs: { mean: mean(qtcValues), formula: 'Bazett' },
  };
}
