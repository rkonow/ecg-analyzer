// Local-only storage for the user's own Anthropic API key and model choice.
// The key never leaves this browser except as the x-api-key header on a
// direct request to api.anthropic.com — it is never bundled, committed, or
// sent to any other endpoint.

const API_KEY_STORAGE_KEY = "ecg-analyzer:anthropic-api-key";
const MODEL_STORAGE_KEY = "ecg-analyzer:anthropic-model";

export const DEFAULT_MODEL = "claude-opus-5";

export const AVAILABLE_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", note: "default, most capable" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "cheaper" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "cheapest" },
];

export function getApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiKey(key) {
  try {
    if (key) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode, disabled cookies, etc). Key just
    // won't persist across reloads — the feature still works for this session.
  }
}

export function getModel() {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    return AVAILABLE_MODELS.some((m) => m.id === stored) ? stored : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setModel(model) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    // ignore
  }
}

// Local-dev convenience: if a gitignored .env file is served alongside the
// app (repo root, KEY=VALUE lines), use its ANTHROPIC_API_KEY as the default
// so a developer isn't retyping their key into the settings field every
// reload. Optional in every sense — a 404 (no .env on this deploy), a
// fetch() failure (e.g. opened via file://, where local fetches are
// blocked), or a missing/blank key all resolve to null silently. This must
// never become a hard dependency for the rest of the app.
export async function loadEnvApiKeyOverride() {
  try {
    const response = await fetch("./.env");
    if (!response.ok) return null;
    const key = parseEnvFile(await response.text()).ANTHROPIC_API_KEY;
    return key ? key : null;
  } catch {
    return null;
  }
}

function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted && value.length >= 2) value = value.slice(1, -1);
    if (key) values[key] = value;
  }
  return values;
}
