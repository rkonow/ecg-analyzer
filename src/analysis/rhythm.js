// Conservative rhythm classification from RR variability and P-wave
// presence. Never emits a diagnosis, only a descriptive label plus the
// reasoning behind it.

const REGULAR_CV_THRESHOLD = 0.10; // sd/mean below this is called regular
const IRREGULARLY_IRREGULAR_CV_THRESHOLD = 0.20;
const P_WAVE_PRESENT_FRACTION = 0.7;

export function classifyRhythm(rrValuesMs, beats) {
  if (rrValuesMs.length < 2 || beats.length < 3) {
    return {
      regular: null,
      classification: 'indeterminate',
      note: 'Fewer than 3 beats detected; insufficient data to assess rhythm regularity.',
    };
  }

  const mean = rrValuesMs.reduce((a, b) => a + b, 0) / rrValuesMs.length;
  const variance = rrValuesMs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rrValuesMs.length;
  const sd = Math.sqrt(variance);
  const cv = mean > 0 ? sd / mean : 0;
  const regular = cv < REGULAR_CV_THRESHOLD;

  const pWaveFraction = beats.filter((b) => b.p !== null).length / beats.length;
  const hasConsistentP = pWaveFraction >= P_WAVE_PRESENT_FRACTION;

  if (regular) {
    if (hasConsistentP) {
      return {
        regular: true,
        classification: 'sinus',
        note: `RR intervals are regular (sd/mean = ${(cv * 100).toFixed(1)}%) and a P wave precedes ${Math.round(pWaveFraction * 100)}% of QRS complexes, consistent with sinus rhythm.`,
      };
    }
    return {
      regular: true,
      classification: 'indeterminate',
      note: `RR intervals are regular (sd/mean = ${(cv * 100).toFixed(1)}%) but a clear P wave could not be located before most QRS complexes, so sinus origin cannot be confirmed.`,
    };
  }

  if (cv >= IRREGULARLY_IRREGULAR_CV_THRESHOLD && !hasConsistentP) {
    return {
      regular: false,
      classification: 'possible atrial fibrillation - irregularly irregular',
      note: `RR intervals vary widely with no discernible pattern (sd/mean = ${(cv * 100).toFixed(1)}%) and no consistent P wave was found before QRS complexes (${Math.round(pWaveFraction * 100)}% of beats). This combination is suggestive of, but not diagnostic for, atrial fibrillation.`,
    };
  }

  return {
    regular: false,
    classification: 'irregular',
    note: `RR intervals are irregular (sd/mean = ${(cv * 100).toFixed(1)}%). ${hasConsistentP ? 'P waves are present before most QRS complexes.' : 'P waves could not be consistently located.'}`,
  };
}
