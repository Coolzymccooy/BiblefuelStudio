/**
 * Google image adapter: the paid last resort after Cloudflare and Pollinations.
 *
 * Default model: gemini-2.5-flash-image (about $0.04 a picture, billing
 * needed: the free tier's image quota is 0). The Imagen models this adapter
 * was written for stopped being offered to our key (imagen-4.0-fast 404s and
 * ListModels lists no Imagen at all), so every scene that both free
 * providers failed ended FAILED.
 *
 * Two Google APIs, chosen by the model id:
 *   gemini-*  POST {BASE}/{MODEL}:generateContent   (key in x-goog-api-key)
 *     { contents: [{ parts: [{ text }] }],
 *       generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } } }
 *     -> candidates[0].content.parts[].inlineData { mimeType, data }
 *   imagen-*  POST {BASE}/{MODEL}:predict?key=...
 *     { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }
 *     -> predictions[0] { bytesBase64Encoded, mimeType }
 *
 * IMAGEN_MODEL pins a model (either kind) and is never replaced. Without a
 * pin, a model-not-found 404 asks ListModels for a live image model once.
 *
 * Google embeds an invisible SynthID watermark (no visible badge), which is
 * acceptable for commercial use.
 */

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Reads the configured Google Gemini API key. Two env names are accepted
 * because GEMINI_API_KEY is already documented for the script-gen path;
 * IMAGEN_API_KEY lets users wire a separate key with its own quota if they
 * want to isolate image-gen spend from script-gen spend.
 *
 * @returns {string}
 */
function readApiKey() {
  const specific = String(process.env.IMAGEN_API_KEY || "").trim();
  if (specific) return specific;
  return String(process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "").trim();
}

/**
 * @returns {boolean}
 */
export function isImagenConfigured() {
  return readApiKey().length > 0;
}

/**
 * Map our internal aspect names to Google aspect-ratio strings.
 *
 * @param {string} [aspect]
 * @returns {"9:16" | "1:1" | "16:9"}
 */
function toAspectRatio(aspect) {
  const a = String(aspect || "").toLowerCase();
  if (a === "landscape" || a === "16:9") return "16:9";
  if (a === "square" || a === "1:1") return "1:1";
  return "9:16";
}

/**
 * Model id discovered via ListModels after the shipped default 404'd. Google
 * retires and renames image models faster than this codebase ships, so on a
 * model-not-found we ask the API what IS there.
 */
let discoveredModel = null;

/** Test hook: forget the discovered model. */
export function _resetImagenDiscovery() { discoveredModel = null; }

/** @param {{ name?: string }} m */
const modelName = (m) => String(m?.name || "").replace(/^models\//, "");
/** @param {{ supportedGenerationMethods?: string[] }} m */
const methodsOf = (m) => (Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : []);

/**
 * The best live image model: a released Gemini flash image model first, then
 * any Gemini image model, then an Imagen model (a fast one if there is one).
 *
 * @param {Array<{ name?: string, supportedGenerationMethods?: string[] }>} models
 * @returns {string | null}
 */
export function pickImageModel(models) {
  const gemini = models.filter((m) => /^gemini-.*image/.test(modelName(m)) && methodsOf(m).includes("generateContent"));
  const released = gemini.filter((m) => !/preview/.test(modelName(m)));
  const geminiPick = released.find((m) => /flash-image/.test(modelName(m)) && !/lite/.test(modelName(m)))
    || released[0] || gemini[0];
  if (geminiPick) return modelName(geminiPick);
  const imagen = models.filter((m) => modelName(m).includes("imagen") && methodsOf(m).includes("predict"));
  const imagenPick = imagen.find((m) => modelName(m).includes("fast")) || imagen[0];
  return imagenPick ? modelName(imagenPick) : null;
}

/**
 * @param {string} apiKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function discoverImageModel(apiKey, signal) {
  try {
    const resp = await fetch(`${ENDPOINT_BASE}?pageSize=200`, { headers: { "x-goog-api-key": apiKey }, signal });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return pickImageModel(Array.isArray(data?.models) ? data.models : []);
  } catch {
    return null;
  }
}

/** @param {string} modelId */
const isGeminiModel = (modelId) => modelId.startsWith("gemini-");

/**
 * The request for one picture from `modelId`.
 * @param {string} modelId
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} aspectRatio
 * @returns {{ url: string, init: RequestInit }}
 */
function buildRequest(modelId, apiKey, prompt, aspectRatio) {
  if (isGeminiModel(modelId)) {
    return {
      url: `${ENDPOINT_BASE}/${encodeURIComponent(modelId)}:generateContent`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
        }),
      },
    };
  }
  return {
    url: `${ENDPOINT_BASE}/${encodeURIComponent(modelId)}:predict?key=${encodeURIComponent(apiKey)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }),
    },
  };
}

/**
 * The picture in a successful response, or why there is none.
 * @param {string} modelId
 * @param {any} data
 * @returns {{ b64: string, mimeType: string } | { reason: string }}
 */
function readPicture(modelId, data) {
  if (isGeminiModel(modelId)) {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const image = parts.find((p) => typeof p?.inlineData?.data === "string" && p.inlineData.data.length > 0);
    if (image) return { b64: image.inlineData.data, mimeType: String(image.inlineData.mimeType || "image/png") };
    const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || "no picture in the response";
    return { reason: `refused or empty (${reason})` };
  }
  const pred = Array.isArray(data?.predictions) ? data.predictions[0] : null;
  if (typeof pred?.bytesBase64Encoded === "string" && pred.bytesBase64Encoded.length > 0) {
    return { b64: pred.bytesBase64Encoded, mimeType: String(pred?.mimeType || "image/png") };
  }
  const filtered = pred?.raiFilteredReason || pred?.safetyAttributes?.categories?.join(",");
  return { reason: filtered ? `safety filter (${filtered})` : "missing predictions[0].bytesBase64Encoded" };
}

/**
 * Generate a single image from Google.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {string} [args.aspect]    portrait | square | landscape
 * @param {string} [args.model]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<import("./cloudflare.js").ImageGenResult>}
 */
export async function generateImageImagen({ prompt, aspect, model, signal }) {
  if (!isImagenConfigured()) {
    return {
      ok: false,
      provider: "imagen",
      error: "Google image backup not configured (IMAGEN_API_KEY / GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY)",
    };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, provider: "imagen", error: "prompt required" };
  }

  const apiKey = readApiKey();
  // An EXPLICIT model (arg or env) is respected verbatim - discovery only
  // replaces our own shipped default, never the operator's pin.
  const forced = String(model || process.env.IMAGEN_MODEL || "").trim();
  const text = prompt.trim().slice(0, 2048);
  const aspectRatio = toAspectRatio(aspect);

  let modelId = forced || discoveredModel || DEFAULT_MODEL;

  // At most two attempts: the configured model, then (on a model-not-found
  // 404 with no explicit pin) a ListModels-discovered replacement.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { url, init } = buildRequest(modelId, apiKey, text, aspectRatio);
    const ctrl = new AbortController();
    const timeoutTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        const modelGone = resp.status === 404 && /is not found for API version|not supported for (predict|generateContent)/i.test(body);
        if (modelGone && !forced && attempt === 0) {
          const found = await discoverImageModel(apiKey, ctrl.signal);
          if (found && found !== modelId) {
            discoveredModel = found;
            modelId = found;
            continue; // retry once with the live model id
          }
        }
        return {
          ok: false,
          provider: "imagen",
          model: modelId,
          status: resp.status,
          error: `Google image ${resp.status} (${modelId}): ${body.slice(0, 300)}`,
        };
      }

      const picture = readPicture(modelId, await resp.json());
      if ("reason" in picture) {
        return { ok: false, provider: "imagen", model: modelId, error: `Google image response: ${picture.reason}` };
      }
      return {
        ok: true,
        provider: "imagen",
        model: modelId,
        imageBuffer: Buffer.from(picture.b64, "base64"),
        contentType: picture.mimeType,
      };
    } catch (err) {
      const msg = err?.name === "AbortError" ? "Google image request timed out" : String(err?.message || err);
      return { ok: false, provider: "imagen", model: modelId, error: msg };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }
  return { ok: false, provider: "imagen", model: modelId, error: "Google image: model discovery retry exhausted" };
}
