import { validateFile } from "./ui/validate.js";
import { createDropzone } from "./ui/dropzone.js";
import { decodeImageFile } from "./ui/decode.js";
import { createStatusController } from "./ui/status.js";
import { createCalibrationPanel } from "./ui/calibration.js";
import { createAiPanel } from "./ui/aiPanel.js";
import * as fixtures from "./ui/fixtures.js";

const dropzoneEl = document.getElementById("dropzone");
const uploadViewEl = document.getElementById("upload-view");
const resultsViewEl = document.getElementById("results-view");
const previewCanvas = document.getElementById("preview-canvas");
const previewFilenameEl = document.getElementById("preview-filename");
const previewDimensionsEl = document.getElementById("preview-dimensions");
const noticesSlotEl = document.getElementById("notices-slot");
const reportRootEl = document.getElementById("report-root");
const replaceBtn = document.getElementById("replace-btn");
const calibrationFieldsEl = document.getElementById("calibration-fields");
const aiPanelRootEl = document.getElementById("ai-panel-root");

const status = createStatusController({
  ledEl: document.querySelector(".status-led"),
  bannerSlotEl: document.getElementById("status-banner-slot"),
});

const calibration = createCalibrationPanel(calibrationFieldsEl);
const aiPanel = createAiPanel(aiPanelRootEl);

createDropzone(dropzoneEl, { onFile: handleFile });

replaceBtn.addEventListener("click", resetToUpload);

status.setIdle();

async function handleFile(file) {
  status.setBusy("Checking file…");

  const validation = validateFile(file);
  if (!validation.ok) {
    status.setError(validation.error, { onRetry: resetToUpload });
    return;
  }

  try {
    status.setBusy("Decoding image…");
    const decoded = await decodeImageFile(file);

    showPreview(decoded, file);

    const options = calibration.getValues();

    status.setBusy("Extracting waveform traces…");
    const extraction = await runExtractTraces(decoded.imageData, options);

    const lead = extraction.leads && extraction.leads[0];
    if (!lead || !Array.isArray(lead.samples) || lead.samples.length === 0) {
      throw new Error("No lead traces were found in this image.");
    }

    const samplingRate =
      options.samplingRateHz || (extraction.calibration && extraction.calibration.samplingRate) || 500;

    status.setBusy("Analyzing rhythm…");
    const analysis = await runAnalyzeLead(lead.samples, samplingRate, options);

    status.setBusy("Rendering report…");
    showResultsView();
    renderNotices([...(extraction.warnings || []), ...(analysis.warnings || [])]);
    await runRenderReport(reportRootEl, { analysis, extraction, imageBitmap: decoded.imageBitmap });
    aiPanel.setImage(decoded.canvas);

    status.setReady();
  } catch (err) {
    console.error("[ecg-analyzer]", err);
    status.setError(
      err && err.message ? err.message : "Something went wrong while processing this image.",
      { onRetry: resetToUpload }
    );
  }
}

async function runExtractTraces(imageData, options) {
  try {
    const mod = await import("./vision/extract.js");
    return mod.extractTraces(imageData, options);
  } catch (err) {
    console.warn("[ecg-analyzer] vision module unavailable, using fixture data:", err);
    return fixtures.extractTraces(imageData, options);
  }
}

async function runAnalyzeLead(samples, samplingRate, options) {
  try {
    const mod = await import("./analysis/analyze.js");
    return mod.analyzeLead(samples, samplingRate, options);
  } catch (err) {
    console.warn("[ecg-analyzer] analysis module unavailable, using fixture data:", err);
    return fixtures.analyzeLead(samples, samplingRate, options);
  }
}

async function runRenderReport(container, payload) {
  try {
    const mod = await import("./report/render.js");
    container.innerHTML = "";
    mod.renderReport(container, payload);
  } catch (err) {
    console.warn("[ecg-analyzer] report module unavailable, using fallback renderer:", err);
    renderFallbackReport(container, payload);
  }
}

function showPreview(decoded, file) {
  const ctx = previewCanvas.getContext("2d");
  previewCanvas.width = decoded.width;
  previewCanvas.height = decoded.height;
  ctx.drawImage(decoded.canvas, 0, 0);
  previewFilenameEl.textContent = file.name;
  previewDimensionsEl.textContent = `${decoded.width} × ${decoded.height}px`;
}

function showResultsView() {
  uploadViewEl.hidden = true;
  resultsViewEl.hidden = false;
}

function resetToUpload() {
  resultsViewEl.hidden = true;
  uploadViewEl.hidden = false;
  reportRootEl.innerHTML = "";
  noticesSlotEl.innerHTML = "";
  aiPanel.reset();
  status.setIdle();
}

function renderNotices(warnings) {
  const unique = [...new Set(warnings.filter(Boolean))];
  if (unique.length === 0) {
    noticesSlotEl.innerHTML = "";
    return;
  }
  noticesSlotEl.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span class="eyebrow">Notices</span>
      </div>
      <div class="panel-body">
        <ul class="notice-list">
          ${unique.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

// Minimal fallback report, used only until src/report/render.js lands.
function renderFallbackReport(container, { analysis }) {
  const hr = analysis.heartRate || {};
  const intervals = analysis.intervals || {};

  const stat = (label, value, unit) => `
    <div class="stat-tile">
      <span class="stat-tile__label">${label}</span>
      <span class="stat-tile__value num">${value ?? "—"}${unit ? `<span class="unit">${unit}</span>` : ""}</span>
    </div>
  `;

  const intervalRow = (label, data) =>
    data
      ? `<tr><td>${label}</td><td class="num">${fmt(data.mean)}</td><td class="num">${fmt(data.sd)}</td></tr>`
      : "";

  container.innerHTML = `
    <div class="fallback-report">
      <div class="fallback-report__stats">
        ${stat("Heart rate", fmt(hr.bpm), "bpm")}
        ${stat("Rhythm", (analysis.rhythm && analysis.rhythm.classification) || "—")}
        ${stat("QTc", fmt(intervals.qtcMs && intervals.qtcMs.mean), "ms")}
        ${stat("Axis", fmt(analysis.axis && analysis.axis.degrees), "°")}
      </div>
      <table class="fallback-report__table">
        <thead>
          <tr><th>Interval</th><th>Mean</th><th>SD</th></tr>
        </thead>
        <tbody>
          ${intervalRow("RR", intervals.rrMs)}
          ${intervalRow("PR", intervals.prMs)}
          ${intervalRow("QRS", intervals.qrsMs)}
          ${intervalRow("QT", intervals.qtMs)}
        </tbody>
      </table>
    </div>
  `;
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return typeof value === "number" ? Math.round(value * 10) / 10 : value;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
