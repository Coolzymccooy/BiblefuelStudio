/**
 * Together AI — FLUX.1-schnell-Free.
 *
 * A third free generator behind Cloudflare, so a spent daily quota does not
 * stop a render. Quality sits below Lucid Origin (it is the same FLUX schnell
 * class as Cloudflare's older default), so this is a fallback, never the
 * primary. Together describes the free endpoint as promotional, so treat it
 * as free until it isn't — Cloudflare stays first in the chain.
 */
import { toDimensions } from "../dimensions.js";

const ENDPOINT = "https://api.together.xyz/v1/images/generations";
const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell-Free";
const REQUEST_TIMEOUT_MS = 60_000;

export function isTogetherConfigured() {
  return String(process.env.TOGETHER_API_KEY || "").trim().length > 0;
}

/**
 * Generate a single image via Together AI.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {number} [args.seed]
 * @param {string} [args.aspect]   portrait | square | landscape
 * @param {string} [args.model]    override model id
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<import("./cloudflare.js").ImageGenResult>}
 */
export async function generateImageTogether({ prompt, seed, aspect, model, signal }) {
  const modelId = String(model || process.env.TOGETHER_IMAGE_MODEL || DEFAULT_MODEL).trim();
  if (!isTogetherConfigured()) {
    return { ok: false, provider: "together", error: "Together not configured (set TOGETHER_API_KEY)" };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, provider: "together", model: modelId, error: "prompt required" };
  }

  const { width, height } = toDimensions(aspect);
  const body = { model: modelId, prompt: prompt.trim().slice(0, 4000), width, height, n: 1, response_format: "b64_json" };
  if (Number.isFinite(seed)) body.seed = Number(seed);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(process.env.TOGETHER_API_KEY).trim()}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, provider: "together", model: modelId, error: `Together ${resp.status}: ${text.slice(0, 200)}` };
    }
    const json = await resp.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, provider: "together", model: modelId, error: "Together returned no image data" };
    return { ok: true, provider: "together", model: modelId, imageBuffer: Buffer.from(b64, "base64") };
  } catch (e) {
    return { ok: false, provider: "together", model: modelId, error: `Together request failed: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
