import { interpretEcgImage } from "../ai/interpret.js";
import { getApiKey, setApiKey, getModel, setModel, AVAILABLE_MODELS } from "../ai/keyStore.js";
import { PULSE_LOADER_SVG, ALERT_ICON_SVG } from "./status.js";

const TRIGGER_LABEL = "Analyze with Claude AI (sends your photo to Anthropic)";

export function createAiPanel(root) {
  let canvas = null;

  root.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel__header">
        <span class="ai-panel__badge" aria-hidden="true">AI</span>
        <div class="ai-panel__heading">
          <p class="ai-panel__title">AI interpretation (Claude) &mdash; descriptive only, not a medical device</p>
          <p class="ai-panel__subtitle">A separate, AI-generated read of this image. Not part of the local analysis above.</p>
        </div>
        <button type="button" class="btn btn--ghost ai-panel__settings-toggle">Settings</button>
      </div>

      <div class="ai-panel__settings" hidden>
        <div class="field">
          <label for="ai-api-key">Anthropic API key</label>
          <div class="field__control">
            <input type="password" id="ai-api-key" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." />
          </div>
          <p class="ai-panel__hint">Stored only in this browser's local storage. Sent only to api.anthropic.com.</p>
        </div>
        <div class="field">
          <label for="ai-model">Model</label>
          <div class="field__control">
            <select id="ai-model">
              ${AVAILABLE_MODELS.map((m) => `<option value="${m.id}">${m.label} (${m.note})</option>`).join("")}
            </select>
          </div>
        </div>
        <button type="button" class="btn btn--ghost ai-panel__clear-key">Clear stored key</button>
      </div>

      <div class="ai-panel__body"></div>
    </div>
  `;

  const settingsToggle = root.querySelector(".ai-panel__settings-toggle");
  const settingsEl = root.querySelector(".ai-panel__settings");
  const apiKeyInput = root.querySelector("#ai-api-key");
  const modelSelect = root.querySelector("#ai-model");
  const clearKeyBtn = root.querySelector(".ai-panel__clear-key");
  const bodyEl = root.querySelector(".ai-panel__body");

  apiKeyInput.value = getApiKey();
  modelSelect.value = getModel();

  settingsToggle.addEventListener("click", () => {
    settingsEl.hidden = !settingsEl.hidden;
  });

  apiKeyInput.addEventListener("input", () => {
    setApiKey(apiKeyInput.value.trim());
    renderIdle();
  });

  modelSelect.addEventListener("change", () => {
    setModel(modelSelect.value);
  });

  clearKeyBtn.addEventListener("click", () => {
    apiKeyInput.value = "";
    setApiKey("");
    renderIdle();
  });

  function renderIdle() {
    const hasKey = Boolean(getApiKey());
    bodyEl.innerHTML = `
      <p class="ai-panel__disclosure">
        Clicking below sends the image you uploaded to Anthropic's API for a separate AI-generated read.
        This is the only network request this app makes with your image.
      </p>
      <button type="button" class="btn ai-panel__trigger" ${hasKey ? "" : "disabled"}>${TRIGGER_LABEL}</button>
      ${hasKey ? "" : `<p class="ai-panel__no-key-hint">Add your Anthropic API key above to enable this.</p>`}
    `;
    const trigger = bodyEl.querySelector(".ai-panel__trigger");
    if (trigger) trigger.addEventListener("click", runAnalysis);
  }

  function renderBusy() {
    bodyEl.innerHTML = `
      <div class="status-banner" data-tone="busy">
        ${PULSE_LOADER_SVG}
        <span class="status-banner__msg">Contacting Claude&hellip;</span>
      </div>
    `;
  }

  function renderError(error) {
    const canRetry = error.kind !== "no-key";
    bodyEl.innerHTML = `
      <div class="status-banner" data-tone="error" role="alert">
        ${ALERT_ICON_SVG}
        <span class="status-banner__msg">${escapeHtml(error.message)}</span>
        ${canRetry ? '<button type="button" class="btn ai-panel__retry">Try again</button>' : ""}
      </div>
    `;
    const retry = bodyEl.querySelector(".ai-panel__retry");
    if (retry) retry.addEventListener("click", renderIdle);
    if (!canRetry) {
      const hint = document.createElement("p");
      hint.className = "ai-panel__no-key-hint";
      hint.textContent = "Add your Anthropic API key above, then try again.";
      bodyEl.appendChild(hint);
    }
  }

  function renderResult(data) {
    const findings = Array.isArray(data.notableFindings) ? data.notableFindings : [];
    bodyEl.innerHTML = `
      <div class="ai-result">
        <div class="ai-result__row">
          <span class="ai-result__label">Heart rate</span>
          <span class="ai-result__value num">${
            typeof data.heartRateBpm === "number" ? `${Math.round(data.heartRateBpm)} <span class="unit">bpm (approx.)</span>` : "not estimated"
          }</span>
        </div>
        <div class="ai-result__row">
          <span class="ai-result__label">Rhythm impression</span>
          <span class="ai-result__value">${escapeHtml(data.rhythmImpression || "—")}</span>
        </div>
        ${
          findings.length
            ? `<div class="ai-result__block">
                <span class="ai-result__label">Notable findings</span>
                <ul class="notice-list">${findings.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
              </div>`
            : ""
        }
        <div class="ai-result__block">
          <span class="ai-result__label">Overall impression</span>
          <p class="ai-result__impression">${escapeHtml(data.overallImpression || "—")}</p>
        </div>
        <span class="ai-result__confidence" data-level="${escapeHtml(data.confidence || "low")}">Confidence: ${escapeHtml(
      data.confidence || "unknown"
    )}</span>
      </div>
      <button type="button" class="btn btn--ghost ai-panel__retry">Run again</button>
    `;
    bodyEl.querySelector(".ai-panel__retry").addEventListener("click", renderIdle);
  }

  async function runAnalysis() {
    if (!canvas) return;
    renderBusy();
    const result = await interpretEcgImage({ canvas, apiKey: getApiKey(), model: getModel() });
    if (result.ok) {
      renderResult(result.data);
    } else {
      renderError(result.error);
    }
  }

  renderIdle();

  return {
    setImage(newCanvas) {
      canvas = newCanvas;
      renderIdle();
    },
    reset() {
      canvas = null;
      renderIdle();
    },
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
