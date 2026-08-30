// File-selection validation: type and size only. Pixel-level checks happen
// once the image has actually been decoded.

export const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function validateFile(file) {
  if (!file) {
    return { ok: false, error: "No file was selected." };
  }
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: `Unsupported file type "${file.type || "unknown"}". Use JPG, PNG, or WEBP.`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File is ${mb} MB, which is over the 25 MB limit.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "File is empty." };
  }
  return { ok: true };
}
