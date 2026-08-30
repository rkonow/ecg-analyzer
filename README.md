# ECG Analyzer

A client-side tool that reads a photo of a printed ECG strip, extracts the
waveform traces, and reports basic rhythm and interval measurements.

> **Research and educational use only. Not a medical device. Not for
> diagnosis. Do not use for clinical decisions.**

## Running it

No build step, no package manager, no framework. It's a static site.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Any static file server works — the app
is plain HTML/CSS/JS served as-is.

All processing happens in the browser. The uploaded image is never sent to
a server; there is no backend.

## Architecture

Four independent modules, wired together by a pipeline orchestrator, with
no build tooling and no bundler — everything is a native ES module loaded
directly by the browser.

```
File (jpg/png/webp)
  │  drag-drop or file picker, validated, EXIF-corrected
  ▼
ImageData                         src/ui/decode.js
  │
  ▼
extractTraces(imageData, options) src/vision/extract.js
  │  → leads[], grid calibration, warnings
  ▼
analyzeLead(samples, rate, opts)  src/analysis/analyze.js
  │  → heart rate, rhythm, intervals, beats
  ▼
renderReport(container, {...})    src/report/render.js
  │  → waveform view + stats
  ▼
Results view (with persistent medical disclaimer)
```

`src/app.js` is the orchestrator. It dynamically `import()`s each of the
three modules above; if a module isn't present yet or throws, the
orchestrator falls back to contract-shaped fixture data from
`src/ui/fixtures.js` (extraction/analysis) or a minimal built-in renderer
(report), so the app is runnable end to end at every point during
development — not just once all four pieces exist.

### Directory layout

```
index.html            single-page shell: dropzone + calibration + results
src/app.js             pipeline orchestrator (dynamic imports, fallbacks)
src/ui/                dropzone, validation, decode/EXIF, status, calibration,
                        fixtures — file ownership: app shell & upload UI
src/vision/extract.js  image → waveform trace extraction (owned separately)
src/analysis/analyze.js waveform → rhythm/interval analysis (owned separately)
src/report/render.js   report/visualization rendering (owned separately)
styles/                design tokens, layout, components
```

### Module contract

The three processing modules are developed independently against this
fixed contract:

```js
// src/vision/extract.js
export function extractTraces(imageData, options) -> {
  ok: boolean, warnings: string[],
  grid: { detected, smallBoxPx, largeBoxPx, pxPerMm, mmPerSecond, mmPerMV },
  calibration: { samplingRate, mvPerUnit, source },
  roi: { x, y, width, height },
  leads: [ { label: string, samples: number[], quality: number } ],
  debug: { overlay: ImageData|null }
}

// src/analysis/analyze.js
export function analyzeLead(samples, samplingRate, options) -> {
  ok, warnings: string[],
  heartRate: { bpm, method, confidence },
  rhythm: { regular, classification, note },
  beats: [ { index, tSec, rIndex, p, q, r, s, t } ],
  intervals: { rrMs, prMs, qrsMs, qtMs, qtcMs },
  hrv: { sdnnMs, rmssdMs, pnn50 },
  axis: { degrees, note },
  flags: string[]
}

// src/report/render.js
export function renderReport(container, { analysis, extraction, imageBitmap }) -> void
export function renderWaveform(canvas, { samples, samplingRate, beats, viewport }) -> void
export function renderStats(container, analysis) -> void
```

`options` carries the calibration panel's overrides:
`{ paperSpeedMmPerSec, gainMmPerMv, samplingRateHz }` — defaults `25`,
`10`, `500`. These exist because phone photos of ECG strips often lack a
reliable printed scale.

## Browser support

Requires `createImageBitmap` and ES module `<script type="module">`
support (all current evergreen browsers). No CDN dependencies for core
functionality.
