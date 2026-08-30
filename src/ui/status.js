// Drives the header status LED plus an inline progress/error banner.
// Kept deliberately small: four states (idle, busy, ready, error), one
// source of truth so the LED and banner never disagree.

const LED_LABEL = {
  idle: "Idle",
  busy: "Working",
  ready: "Ready",
  error: "Error",
};

const PULSE_LOADER_SVG = `
  <svg class="pulse-loader" width="30" height="16" viewBox="0 0 60 32" fill="none" aria-hidden="true">
    <path d="M0 24 H14 L18 24 L22 6 L28 28 L32 24 H60" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const ALERT_ICON_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.8" />
    <path d="M12 7.5 V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <circle cx="12" cy="16.2" r="1" fill="currentColor" />
  </svg>
`;

export function createStatusController({ ledEl, bannerSlotEl }) {
  const ledText = ledEl.querySelector(".status-led__text");

  function setLed(state) {
    ledEl.dataset.state = state;
    ledText.textContent = LED_LABEL[state] || state;
  }

  function clearBanner() {
    bannerSlotEl.innerHTML = "";
  }

  function setIdle() {
    setLed("idle");
    clearBanner();
  }

  function setBusy(message) {
    setLed("busy");
    bannerSlotEl.innerHTML = `
      <div class="status-banner" data-tone="busy">
        ${PULSE_LOADER_SVG}
        <span class="status-banner__msg">${escapeHtml(message)}</span>
      </div>
    `;
  }

  function setReady() {
    setLed("ready");
    clearBanner();
  }

  function setError(message, { onRetry } = {}) {
    setLed("error");
    bannerSlotEl.innerHTML = `
      <div class="status-banner" data-tone="error" role="alert">
        ${ALERT_ICON_SVG}
        <span class="status-banner__msg">${escapeHtml(message)}</span>
        ${onRetry ? '<button type="button" class="btn" id="status-retry-btn">Try again</button>' : ""}
      </div>
    `;
    if (onRetry) {
      bannerSlotEl.querySelector("#status-retry-btn").addEventListener("click", onRetry);
    }
  }

  return { setIdle, setBusy, setReady, setError };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
