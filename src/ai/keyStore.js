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
