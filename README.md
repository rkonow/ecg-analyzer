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

All processing happens in the browser by default. The uploaded image is
never sent to a server; there is no backend — with one explicit exception,
described below.

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
                        AI panel UI, fixtures — file ownership: app shell & upload UI
src/ai/                Claude API client + local key storage for the optional
                        AI interpretation panel — file ownership: app shell & upload UI
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

## AI interpretation (optional, opt-in)

The results view includes a separate "AI interpretation (Claude)" panel.
It is a supplement, not a replacement: the local pipeline above keeps its
own numbers, and this panel shows a second, independently-generated,
descriptive-only read of the same photo — clearly labeled apart from the
local report.

This is the one place in the app that talks to a server:

- **Bring your own key.** Paste your own Anthropic API key into the
  panel's settings. It's stored only in `localStorage`, in your browser,
  and is read only to set the `x-api-key` header on a direct request to
  `api.anthropic.com`. It is never bundled, logged, committed, or sent
  anywhere else. The app ships with no key baked in — without one, the
  "Analyze" button stays disabled.
- **Opt-in per use.** Nothing is sent until you click **"Analyze with
  Claude AI (sends your photo to Anthropic)"** — the exact disclosure is
  visible above the button before you click it.
- **Model choice.** Defaults to Claude Opus 5; Claude Sonnet 5 and Claude
  Haiku 4.5 are available as cheaper alternatives in the same settings.
- **Implementation.** `src/ai/interpret.js` calls `POST
  /v1/messages` directly via `fetch()` (no SDK, matching the rest of the
  app's no-build-step constraint), with a forced tool call
  (`report_ecg_interpretation`) so the response is structured JSON rather
  than free text, and a prompt that explicitly asks for descriptive
  observations only — never a diagnosis — and to say plainly when the
  image is unreadable. `src/ai/keyStore.js` owns the `localStorage`
  read/write for the key and model choice.

## Browser support

Requires `createImageBitmap` and ES module `<script type="module">`
support (all current evergreen browsers). No CDN dependencies for core
functionality.
