import { sobel, findPitch, otsuThreshold, clamp } from './utils.js';

// Profiles are computed only within bbox so that a rotated image's filled
// corner padding (a strong non-periodic edge at the content boundary) does
// not swamp the genuinely periodic grid signal.
function rowColProfiles(mag, width, bbox) {
  const rowProfile = new Float64Array(bbox.height);
  const colProfile = new Float64Array(bbox.width);
  for (let dy = 0; dy < bbox.height; dy++) {
    const y = bbox.y + dy;
    let sum = 0;
    const off = y * width;
    for (let dx = 0; dx < bbox.width; dx++) sum += mag[off + bbox.x + dx];
    rowProfile[dy] = sum;
  }
  for (let dx = 0; dx < bbox.width; dx++) {
    const x = bbox.x + dx;
    let sum = 0;
    for (let dy = 0; dy < bbox.height; dy++) sum += mag[(bbox.y + dy) * width + x];
    colProfile[dx] = sum;
  }
  return { rowProfile, colProfile };
}

// Real printed/rendered ECG grid boxes are always small (nominally 1mm);
// the waveform's own beat-to-beat rhythm is a much coarser periodicity that
// can otherwise be mistaken for a grid pitch (particularly on grid-less
// monitor images). Cap the search range well below typical R-R spacing.
function gridMaxLagFrac(len) {
  return Math.min(0.15, 80 / len);
}

function findPhase(profile, pitch) {
  if (pitch <= 0) return 0;
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < pitch; phase++) {
    let sum = 0;
    for (let pos = phase; pos < profile.length; pos += pitch) sum += profile[pos];
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  return bestPhase;
}

function linePositions(length, pitch, phase) {
  const positions = [];
  for (let pos = phase; pos < length; pos += pitch) positions.push(pos);
  return positions;
}

// Tries to measure the large-box pitch (nominally 5x the small box) directly
// from the profile's autocorrelation; falls back to the 5x convention.
function findLargeBoxPitch(profile, smallPitch) {
  if (smallPitch <= 0) return smallPitch * 5;
  const minLag = Math.max(1, Math.round(smallPitch * 3.5));
  const maxLag = Math.min(profile.length - 2, Math.round(smallPitch * 6.5));
  if (maxLag <= minLag) return smallPitch * 5;
  const { pitch, strength } = findPitch(profile, minLag, (maxLag / profile.length) + 0.001);
  if (pitch > 0 && strength > 0.15 && pitch >= minLag && pitch <= maxLag) return pitch;
  return smallPitch * 5;
}

function contentBoundingBox(gray, width, height) {
  const thresh = otsuThreshold(gray);
  let bg = 0;
  for (let i = 0; i < gray.length; i++) bg += gray[i];
  bg /= gray.length;
  const isPaper = bg > 128;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      const isFg = isPaper ? v < thresh : v > thresh;
      if (!isFg) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height };
  const padX = Math.round(width * 0.02);
  const padY = Math.round(height * 0.02);
  const x = clamp(minX - padX, 0, width - 1);
  const y = clamp(minY - padY, 0, height - 1);
  const w = clamp(maxX + padX, 0, width - 1) - x + 1;
  const h = clamp(maxY + padY, 0, height - 1) - y + 1;
  return { x, y, width: w, height: h };
}

// Detects the ECG grid (small/large box pitch in pixels) via autocorrelation
// of edge-energy row/column projections. Monitor screenshots frequently have
// no printed/rendered grid at all; that is a valid, common outcome, not a
// failure, and callers must fall back to an 'assumed' or 'user' calibration.
export function detectGrid(gray, width, height, rotationDeg = 0) {
  const warnings = [];
  const roiFallbackBbox = contentBoundingBox(gray, width, height);
  // The tight ink-based content bbox is only needed to keep a rotated
  // image's filled corner padding out of the periodicity search; when the
  // image wasn't rotated, using it can backfire (e.g. it can collapse to
  // just a single trace's own band, letting that trace's edges dominate the
  // column profile and mask the grid's vertical-line periodicity).
  const profileBbox = Math.abs(rotationDeg) > 0.5 ? roiFallbackBbox : { x: 0, y: 0, width, height };
  const { mag } = sobel(gray, width, height);
  const { rowProfile, colProfile } = rowColProfiles(mag, width, profileBbox);

  const rowPitchInfo = findPitch(rowProfile, 3, gridMaxLagFrac(rowProfile.length));
  const colPitchInfo = findPitch(colProfile, 3, gridMaxLagFrac(colProfile.length));

  const rowOk = rowPitchInfo.pitch > 1;
  const colOk = colPitchInfo.pitch > 1;

  let detected = false;
  let smallBoxPx = null;
  let largeBoxPx = null;
  let pxPerMm = null;
  let rowPositions = [];
  let colPositions = [];
  let confidence = 0;

  if (rowOk && colOk) {
    const ratio = rowPitchInfo.pitch / colPitchInfo.pitch;
    if (ratio > 0.5 && ratio < 2) {
      detected = true;
      smallBoxPx = (rowPitchInfo.pitch + colPitchInfo.pitch) / 2;
      confidence = (rowPitchInfo.strength + colPitchInfo.strength) / 2;
    } else {
      // Axes disagree. A residual sub-degree rotation smears a "horizontal"
      // grid line across more rows the wider the image is (drift = width *
      // tan(residual)), which can wash out the small-box periodicity on one
      // axis while leaving it intact on the other, or leave only a coarser
      // large-box alias detectable. If the mismatch is a near-integer
      // multiple, trust the smaller pitch - the fine pitch aliasing to a
      // spurious coarser multiple is far more likely than the reverse.
      const bigger = Math.max(rowPitchInfo.pitch, colPitchInfo.pitch);
      const smaller = Math.min(rowPitchInfo.pitch, colPitchInfo.pitch);
      const mult = bigger / smaller;
      if (Math.round(mult) >= 2 && Math.abs(mult - Math.round(mult)) < 0.15) {
        detected = true;
        smallBoxPx = smaller;
        confidence = (rowPitchInfo.pitch < colPitchInfo.pitch ? rowPitchInfo.strength : colPitchInfo.strength) * 0.8;
        warnings.push('Grid pitch on the two axes disagreed by a near-integer multiple; used the finer pitch.');
      } else {
        const useRow = rowPitchInfo.strength >= colPitchInfo.strength;
        const info = useRow ? rowPitchInfo : colPitchInfo;
        if (info.strength > 0.25) {
          detected = true;
          smallBoxPx = info.pitch;
          confidence = info.strength * 0.6;
          warnings.push('Grid pitch on the two axes disagreed; used only the stronger axis, so pixel/mm scale is less certain.');
        }
      }
    }
  }
  if (!detected && (rowOk || colOk)) {
    // Only one axis shows periodicity (e.g. a screenshot with faint
    // horizontal sweep lines only) - usable but noted as lower confidence.
    const info = (rowOk && (!colOk || rowPitchInfo.strength >= colPitchInfo.strength)) ? rowPitchInfo : colPitchInfo;
    if (info.strength > 0.25) {
      detected = true;
      smallBoxPx = info.pitch;
      confidence = info.strength * 0.7;
      warnings.push('Grid periodicity detected on only one axis; pixel/mm scale is less certain.');
    }
  }

  if (detected) {
    pxPerMm = smallBoxPx;
    const largeRow = findLargeBoxPitch(rowProfile, smallBoxPx);
    const largeCol = findLargeBoxPitch(colProfile, smallBoxPx);
    largeBoxPx = (largeRow + largeCol) / 2;

    // Line positions always use the single trusted small-box pitch (not each
    // axis's raw, possibly-mismatched pitch) so a disagreement between axes
    // doesn't produce inconsistent row/column spacing in the overlay/mask.
    const rowPitchRounded = Math.round(smallBoxPx);
    const colPitchRounded = Math.round(smallBoxPx);
    const rowPhase = findPhase(rowProfile, rowPitchRounded);
    const colPhase = findPhase(colProfile, colPitchRounded);
    rowPositions = linePositions(profileBbox.height, rowPitchRounded, rowPhase).map((p) => p + profileBbox.y);
    colPositions = linePositions(profileBbox.width, colPitchRounded, colPhase).map((p) => p + profileBbox.x);
  } else {
    warnings.push('No periodic grid detected (likely a monitor screenshot or grid-less crop); pixel-to-mm scale is unknown.');
  }

  const roiSource = detected && rowPositions.length > 1 && colPositions.length > 1
    ? {
      x: colPositions[0],
      y: rowPositions[0],
      width: colPositions[colPositions.length - 1] - colPositions[0],
      height: rowPositions[rowPositions.length - 1] - rowPositions[0],
    }
    : roiFallbackBbox;

  const roi = {
    x: clamp(roiSource.x, 0, width - 1),
    y: clamp(roiSource.y, 0, height - 1),
    width: clamp(roiSource.width, 1, width - clamp(roiSource.x, 0, width - 1)),
    height: clamp(roiSource.height, 1, height - clamp(roiSource.y, 0, height - 1)),
  };

  return {
    detected,
    smallBoxPx,
    largeBoxPx,
    pxPerMm,
    confidence,
    rowPositions,
    colPositions,
    roi,
    warnings,
  };
}
