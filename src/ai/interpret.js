// Calls the Anthropic Messages API directly from the browser to get a
// separate, descriptive AI read of the uploaded ECG photo. This is a
// deliberate exception to the rest of the app's "nothing leaves the device"
// property: it only runs when the user explicitly opts in (see src/ui/aiPanel.js),
// and only after they've supplied their own API key.
//
// Plain fetch(), no SDK — the SDK's browser guard (`dangerouslyAllowBrowser`)
// exists for this exact scenario and just sets the header below itself.

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "report_ecg_interpretation";

// Effort control is only accepted by the newest tier; older/cheaper models
// (e.g. Haiku 4.5) reject an unrecognized output_config.effort with a 400.
const MODELS_WITH_EFFORT_CONTROL = new Set(["claude-opus-5", "claude-sonnet-5"]);

const MAX_LONG_EDGE_PX = 2000; // matches roughly what Claude's own resolution tiers use
const JPEG_QUALITY = 0.9;

const PROMPT = `You are looking at a photo of a printed or displayed ECG (electrocardiogram) strip.

Give a plain, descriptive read of what is visible in the image — not a diagnosis. Report only what you can actually observe:
- An approximate heart rate in beats per minute, if a repeating waveform is clearly visible (omit or set null if you can't estimate one)
- A plain-language impression of the rhythm (e.g. "appears regular", "appears irregular", "unable to determine")
- Any notable visual findings (artifacts, irregular spacing, unclear leads, poor image quality, etc.)
- An overall impression, in plain language

If the image is blurry, cropped, poorly lit, rotated, or otherwise unreadable, say so plainly instead of guessing at values. Call the report_ecg_interpretation tool with your observations.`;

const TOOL = {
  name: TOOL_NAME,
  description:
    "Report a descriptive (non-diagnostic) reading of a photographed ECG strip: approximate heart rate, a plain-language rhythm impression, notable visual findings, an overall impression, and your confidence in the read.",
  input_schema: {
    type: "object",
    properties: {
      heartRateBpm: {
        type: ["number", "null"],
        description: "Approximate heart rate in beats per minute, or null if it can't be estimated from the image.",
      },
      rhythmImpression: {
        type: "string",
        description: "Plain-language impression of the rhythm, e.g. 'appears regular' or 'unable to determine'.",
      },
      notableFindings: {
        type: "array",
        items: { type: "string" },
        description: "Notable visual observations (artifacts, image quality issues, unusual spacing, etc). Empty array if none.",
      },
      overallImpression: {
        type: "string",
        description: "A short, plain-language overall impression of the image. Must state plainly if the image is unreadable.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Confidence in this read, given image quality and legibility.",
      },
    },
    required: ["rhythmImpression", "notableFindings", "overallImpression", "confidence"],
  },
};

export async function interpretEcgImage({ canvas, apiKey, model }) {
  if (!apiKey) {
    return { ok: false, error: { kind: "no-key", message: "Add your Anthropic API key above to use this feature." } };
  }

  let imageBase64;
  try {
    imageBase64 = await canvasToJpegBase64(canvas);
  } catch (err) {
    return { ok: false, error: { kind: "encode-failed", message: "Could not prepare this image for upload." } };
  }

  const requestBody = {
    model,
    max_tokens: 4096,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  };
  if (MODELS_WITH_EFFORT_CONTROL.has(model)) {
    requestBody.output_config = { effort: "low" };
  }

  let response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Required for a direct browser fetch to be accepted; this is the same
        // header the official SDK sends when constructed with dangerouslyAllowBrowser.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    // fetch() throws a generic TypeError for both a real network failure and a
    // CORS rejection — the browser doesn't expose which. If this consistently
    // fires despite the header above, that's a CORS rejection worth surfacing upstream.
    return {
      ok: false,
      error: {
        kind: "network",
        message:
          "Could not reach the Anthropic API (network error or the request was blocked). Check your connection and try again.",
      },
    };
  }

  if (!response.ok) {
    return { ok: false, error: await classifyErrorResponse(response) };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { kind: "invalid-response", message: "Received an unreadable response from the API." } };
  }

  const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === TOOL_NAME);
  if (!toolUse) {
    return { ok: false, error: { kind: "invalid-response", message: "Claude did not return a structured interpretation." } };
  }

  return { ok: true, data: toolUse.input };
}

async function classifyErrorResponse(response) {
  let message = `Request failed with status ${response.status}.`;
  try {
    const body = await response.json();
    if (body && body.error && body.error.message) message = body.error.message;
  } catch {
    // non-JSON error body; keep the generic message
  }

  if (response.status === 401) {
    return { kind: "auth", status: 401, message: "Your API key was rejected. Check that it's correct and active." };
  }
  if (response.status === 429) {
    return { kind: "rate-limit", status: 429, message: "Rate limit reached. Wait a moment and try again." };
  }
  return { kind: "unknown", status: response.status, message };
}

async function canvasToJpegBase64(canvas, maxLongEdge = MAX_LONG_EDGE_PX) {
  const longEdge = Math.max(canvas.width, canvas.height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;

  let source = canvas;
  if (scale < 1) {
    const resized = document.createElement("canvas");
    resized.width = Math.round(canvas.width * scale);
    resized.height = Math.round(canvas.height * scale);
    resized.getContext("2d").drawImage(canvas, 0, 0, resized.width, resized.height);
    source = resized;
  }

  const blob = await new Promise((resolve, reject) => {
    source.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", JPEG_QUALITY);
  });

  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
