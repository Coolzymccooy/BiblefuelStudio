/**
 * Cloudflare Workers AI adapter — FLUX-1-schnell (free tier: 10,000 neurons
 * per day forever, ~200–300 images depending on size).
 *
 * Endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell
 * Auth:
 *   Authorization: Bearer {API_TOKEN}
 *
 * Response shape (current Cloudflare API):
 *   { "result": { "image": "<base64 PNG bytes>" }, "success": true, ... }
 *
 * Notes:
 *  - Flux ignores negative prompts; we don't send one.
 *  - Flux accepts an integer `seed` for reproducibility — we always pass it.
 *  - Output is square 1024x1024 by default; the ffmpeg scene graph scales/
 *    crops to whatever aspect the video needs.
 */

// Uses Node 18+ global fetch — no node-fetch dep needed and tests can stub
// globalThis.fetch directly without module mocking.

const ENDPOINT_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * @returns {boolean}
 */
export function isCloudflareConfigured() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = String(process.env.CLOUDFLARE_WORKERS_AI_TOKEN || "").trim();
  return accountId.length > 0 && token.length > 0;
}

/**
 * @typedef {object} ImageGenResult
 * @property {boolean} ok
 * @property {Buffer} [imageBuffer]
 * @property {string} [contentType]
 * @property {string} [provider]
 * @property {string} [model]
 * @property {string} [error]
 * @property {number} [status]
 */

/**
 * Generate a single image via Cloudflare Workers AI.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {number} [args.seed]
 * @param {number} [args.steps]   1–8 for flux-schnell (default 4)
 * @param {string} [args.model]   override model id
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<ImageGenResult>}
 */
export async function generateImageCloudflare({ prompt, seed, steps, model, signal }) {
  if (!isCloudflareConfigured()) {
    return { ok: false, error: "Cloudflare Workers AI not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_WORKERS_AI_TOKEN)", provider: "cloudflare" };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, error: "prompt required", provider: "cloudflare" };
  }

  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID).trim();
  const token = String(process.env.CLOUDFLARE_WORKERS_AI_TOKEN).trim();
  const modelId = String(model || process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_MODEL).trim();
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(accountId)}/ai/run/${modelId}`;

  /** @type {Record<string, unknown>} */
  const body = { prompt: prompt.trim().slice(0, 2048) };
  if (Number.isFinite(seed)) body.seed = Number(seed);
  if (Number.isFinite(steps)) {
    const clamped = Math.min(8, Math.max(1, Math.floor(Number(steps))));
    body.steps = clamped;
  }

  const ctrl = new AbortController();
  const timeoutTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        provider: "cloudflare",
        model: modelId,
        status: resp.status,
        error: `Cloudflare ${resp.status}: ${text.slice(0, 300)}`,
      };
    }

    // Cloudflare can return either application/json (FLUX models) or
    // image/png (some older models). Handle both.
    const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const data = await resp.json();
      if (data?.success === false) {
        const msg = Array.isArray(data?.errors) && data.errors.length > 0
          ? data.errors.map((e) => e?.message || e).join("; ")
          : "unknown Cloudflare error";
        return { ok: false, provider: "cloudflare", model: modelId, error: msg };
      }
      const b64 = data?.result?.image;
      if (typeof b64 !== "string" || b64.length === 0) {
        return { ok: false, provider: "cloudflare", model: modelId, error: "Cloudflare response missing result.image" };
      }
      return {
        ok: true,
        provider: "cloudflare",
        model: modelId,
        imageBuffer: Buffer.from(b64, "base64"),
        contentType: "image/png",
      };
    }

    // Binary fallback.
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) {
      return { ok: false, provider: "cloudflare", model: modelId, error: "Cloudflare returned empty body" };
    }
    return {
      ok: true,
      provider: "cloudflare",
      model: modelId,
      imageBuffer: buf,
      contentType: contentType || "image/png",
    };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Cloudflare request timed out" : String(err?.message || err);
    return { ok: false, provider: "cloudflare", model: modelId, error: msg };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
