// Calibration settings panel. Phone photos of ECG strips often lack a
// reliable printed scale, so these values are user-overridable and get
// threaded through as the `options` argument to extractTraces/analyzeLead.

const DEFAULTS = {
  paperSpeedMmPerSec: 25,
  gainMmPerMv: 10,
  samplingRateHz: 500,
};

const FIELDS = [
  { key: "paperSpeedMmPerSec", label: "Paper speed", unit: "mm/s", min: 1, step: 1 },
  { key: "gainMmPerMv", label: "Gain", unit: "mm/mV", min: 1, step: 1 },
  { key: "samplingRateHz", label: "Sampling rate", unit: "Hz", min: 50, step: 10 },
];

export function createCalibrationPanel(root) {
  const values = { ...DEFAULTS };

  root.innerHTML = `
    <div class="calibration__grid">
      ${FIELDS.map(
        (f) => `
        <div class="field">
          <label for="cal-${f.key}">${f.label}</label>
          <div class="field__control">
            <input
              type="number"
              id="cal-${f.key}"
              name="${f.key}"
              value="${values[f.key]}"
              min="${f.min}"
              step="${f.step}"
              inputmode="decimal"
            />
            <span class="field__unit">${f.unit}</span>
          </div>
        </div>`
      ).join("")}
    </div>
    <div class="calibration__footer">
      <p class="calibration__note">Defaults match standard ECG paper: 25&nbsp;mm/s, 10&nbsp;mm/mV.</p>
      <button type="button" class="btn btn--ghost" id="cal-reset">Reset defaults</button>
    </div>
  `;

  const inputs = {};
  for (const f of FIELDS) {
    const input = root.querySelector(`#cal-${f.key}`);
    inputs[f.key] = input;
    input.addEventListener("input", () => {
      const parsed = parseFloat(input.value);
      values[f.key] = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULTS[f.key];
    });
  }

  root.querySelector("#cal-reset").addEventListener("click", () => {
    for (const f of FIELDS) {
      values[f.key] = DEFAULTS[f.key];
      inputs[f.key].value = DEFAULTS[f.key];
    }
  });

  return {
    getValues() {
      return { ...values };
    },
  };
}
