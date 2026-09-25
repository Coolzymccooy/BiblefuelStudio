/**
 * Cloudflare Workers AI adapter.
 *
 * Endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}
 * Auth:
 *   Authorization: Bearer {API_TOKEN}
 *
 * Response shape (current Cloudflare API):
 *   { "result": { "image": "<base64 PNG bytes>" }, "success": true, ... }
 *   (some models answer image/png bytes instead — both handled below)
 *
 * Default model: Leonardo Lucid Origin. It renders the requested aspect
 * NATIVELY (1344×768 landscape / 768×1344 portrait), so a widescreen scene is
 * composed as widescreen instead of a 1024² square cropped to 16:9 with the
 * subject sliced off. Costs a few cents per image; the free daily neuron
 * allowance still covers a video or two. Set CLOUDFLARE_IMAGE_MODEL to
 * @cf/black-forest-labs/flux-1-schnell to go back to the near-free square
 * model (it only accepts prompt/steps/seed — no dimensions).
 */
import { toDimensions } from "../dimensions.js";

// Uses Node 18+ global fetch — no node-fetch dep needed and tests can stub
// globalThis.fetch directly without module mocking.

const ENDPOINT_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_MODEL = "@cf/leonardo/lucid-origin";
const FLUX_SCHNELL = /flux-1-schnell/i;
const REQUEST_TIMEOUT_MS = 45_000;

/** Per-model set of body properties the API 400'd as "not allowed". */
const rejectedProps = new Map();

/** Test hook: forget learned schema rejections. */
export function _resetCloudflareSchemaMemo() { rejectedProps.clear(); }

/**
 * Reads the Workers AI token. Three env names are accepted: the documented
 * CLOUDFLARE_WORKERS_AI_TOKEN, plus the CLOUDFLARE_AI_API_TOKEN /
 * CLOUDFLARE_API_TOKEN names real deployments already carry - the operator
 * HAD Cloudflare configured under those names while every story scene fell
 * through to a retired Imagen model, because this predicate said "not
 * configured".
 *
 * @returns {string}
 */
function readToken() {
  return String(
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN
    || process.env.CLOUDFLARE_AI_API_TOKEN
    || process.env.CLOUDFLARE_API_TOKEN
    || "",
  ).trim();
}

/**
 * @returns {boolean}
 */
export function isCloudflareConfigured() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  return accountId.length > 0 && readToken().length > 0;
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
 * @param {number} [args.steps]   1–8, flux-schnell only (default 4)
 * @param {string} [args.aspect]  portrait (default) | landscape | square — sent as width/height to models that take them
 * @param {string} [args.model]   override model id
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<ImageGenResult>}
 */
export async function generateImageCloudflare({ prompt, seed, steps, model, aspect, signal }) {
  if (!isCloudflareConfigured()) {
    return { ok: false, error: "Cloudflare Workers AI not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_WORKERS_AI_TOKEN)", provider: "cloudflare" };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, error: "prompt required", provider: "cloudflare" };
  }

  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID).trim();
  const token = readToken();
  const modelId = String(model || process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_MODEL).trim();
  const url = `${ENDPOINT_BASE}/${encodeURIComponent(accountId)}/ai/run/${modelId}`;

  /** @type {Record<string, unknown>} */
  const body = { prompt: prompt.trim().slice(0, 2048) };
  if (Number.isFinite(seed)) body.seed = Number(seed);
  if (FLUX_SCHNELL.test(modelId)) {
    if (Number.isFinite(steps)) {
      const clamped = Math.min(8, Math.max(1, Math.floor(Number(steps))));
      body.steps = clamped;
    }
  } else {
    // Dimension-taking models (Leonardo, SDXL family) compose for the aspect
    // we actually need. If a model turns out to reject them, the 400 handler
    // below strips the property and remembers that for the session.
    const { width, height } = toDimensions(aspect);
    body.width = width;
    body.height = height;
  }
  // Drop properties this model is KNOWN to reject (learned from earlier 400s)
  // so later scenes don't pay an extra round-trip each.
  for (const p of rejectedProps.get(modelId) || []) delete body[p];

  // Up to 3 attempts: Cloudflare's schema varies by model and tightens over
  // time - the operator's model rejected `seed` outright ("Additional or
  // unevaluated properties '/seed' not allowed"). On that 400, strip the
  // named property and retry rather than failing the whole scene.
  for (let attempt = 0; attempt < 3; attempt++) {
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
      const rejected = resp.status === 400
        ? /properties\s+'\/(\w+)'/.exec(text)
        : null;
      if (rejected && rejected[1] !== "prompt" && rejected[1] in body) {
        const prop = rejected[1];
        delete body[prop];
        if (!rejectedProps.has(modelId)) rejectedProps.set(modelId, new Set());
        rejectedProps.get(modelId).add(prop);
        continue;
      }
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
  return { ok: false, provider: "cloudflare", model: modelId, error: "Cloudflare: schema retry exhausted" };
}
