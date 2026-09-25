/**
 * Google Gemini Imagen adapter — free tier on Google AI Studio
 * (100–500 images/day depending on quota tier).
 *
 * Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:predict?key={API_KEY}
 *
 * Default model: imagen-3.0-generate-002 (free tier eligible). Override via
 * env IMAGEN_MODEL.
 *
 * Request shape:
 *   {
 *     instances: [{ prompt: "..." }],
 *     parameters: { sampleCount: 1, aspectRatio: "9:16" | "1:1" | "16:9" }
 *   }
 *
 * Response shape:
 *   {
 *     predictions: [{ bytesBase64Encoded: "...", mimeType: "image/png" }]
 *   }
 *
 * Notes:
 *  - Imagen DOES support aspect ratio natively, so we pass it through.
 *  - Imagen embeds an invisible SynthID watermark (no visible badge) — that
 *    is part of Google's ToS and is acceptable for commercial use.
 */

// Uses Node 18+ global fetch — same rationale as the Cloudflare adapter.

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Imagen 3.x was retired May 2026 in favor of Imagen 4. The "fast" variant
// has the cheapest cost per image — appropriate for SaaS volume rendering.
// NOTE (verified 2026-05-20): Imagen models on the Gemini API require a
// PAID Google AI Studio plan. The free tier explicitly lists image-gen
// quota as 0 — only call this provider when the user has billing enabled.
const DEFAULT_MODEL = "imagen-4.0-fast-generate-001";
const REQUEST_TIMEOUT_MS = 45_000;

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
 * Map our internal aspect names to Imagen aspect-ratio strings.
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
 * Generate a single image via Google Imagen.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {string} [args.aspect]    portrait | square | landscape
 * @param {string} [args.model]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<import("./cloudflare.js").ImageGenResult>}
 */
/**
 * Model id discovered via ListModels after the configured default 404'd.
 * Google retires/renames Imagen ids under v1beta faster than this codebase
 * ships (imagen-3.0 retired May 2026; imagen-4.0-fast-generate-001 started
 * 404ing Aug 2026) - so on a model-not-found we ask the API what IS there
 * instead of hardcoding a new name that will rot the same way.
 */
let discoveredModel = null;

/** Test hook: forget the discovered model. */
export function _resetImagenDiscovery() { discoveredModel = null; }

/**
 * Ask ListModels for a current Imagen model that supports predict.
 * Prefers a "fast" variant (cheapest per image).
 *
 * @param {string} apiKey
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function discoverImagenModel(apiKey, signal) {
  try {
    const resp = await fetch(`${ENDPOINT_BASE}?key=${encodeURIComponent(apiKey)}&pageSize=200`, { signal });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    const models = Array.isArray(data?.models) ? data.models : [];
    const imagen = models.filter((m) =>
      String(m?.name || "").includes("imagen")
      && (Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : []).includes("predict"));
    if (imagen.length === 0) return null;
    const pick = imagen.find((m) => String(m.name).includes("fast")) || imagen[0];
    return String(pick.name).replace(/^models\//, "");
  } catch {
    return null;
  }
}

export async function generateImageImagen({ prompt, aspect, model, signal }) {
  if (!isImagenConfigured()) {
    return {
      ok: false,
      provider: "imagen",
      error: "Google Imagen not configured (IMAGEN_API_KEY / GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY)",
    };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, provider: "imagen", error: "prompt required" };
  }

  const apiKey = readApiKey();
  // An EXPLICIT model (arg or env) is respected verbatim - discovery only
  // replaces our own shipped default, never the operator's pin.
  const forced = String(model || process.env.IMAGEN_MODEL || "").trim();

  const body = {
    instances: [{ prompt: prompt.trim().slice(0, 2048) }],
    parameters: {
      sampleCount: 1,
      aspectRatio: toAspectRatio(aspect),
    },
  };

  let modelId = forced || discoveredModel || DEFAULT_MODEL;

  // At most two attempts: the configured model, then (on a model-not-found
  // 404 with no explicit pin) a ListModels-discovered replacement.
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `${ENDPOINT_BASE}/${encodeURIComponent(modelId)}:predict?key=${encodeURIComponent(apiKey)}`;

    const ctrl = new AbortController();
    const timeoutTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const modelGone = resp.status === 404 && /is not found for API version|not supported for predict/i.test(text);
        if (modelGone && !forced && attempt === 0) {
          const found = await discoverImagenModel(apiKey, ctrl.signal);
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
          error: `Imagen ${resp.status}: ${text.slice(0, 300)}`,
        };
      }

      const data = await resp.json();
      const pred = Array.isArray(data?.predictions) ? data.predictions[0] : null;
      const b64 = pred?.bytesBase64Encoded;
      if (typeof b64 !== "string" || b64.length === 0) {
        const filtered = pred?.raiFilteredReason || pred?.safetyAttributes?.categories?.join(",");
        const reason = filtered ? `safety filter (${filtered})` : "missing predictions[0].bytesBase64Encoded";
        return { ok: false, provider: "imagen", model: modelId, error: `Imagen response: ${reason}` };
      }
      return {
        ok: true,
        provider: "imagen",
        model: modelId,
        imageBuffer: Buffer.from(b64, "base64"),
        contentType: String(pred?.mimeType || "image/png"),
      };
    } catch (err) {
      const msg = err?.name === "AbortError" ? "Imagen request timed out" : String(err?.message || err);
      return { ok: false, provider: "imagen", model: modelId, error: msg };
    } finally {
      clearTimeout(timeoutTimer);
    }
  }
  return { ok: false, provider: "imagen", model: modelId, error: "Imagen: model discovery retry exhausted" };
}
