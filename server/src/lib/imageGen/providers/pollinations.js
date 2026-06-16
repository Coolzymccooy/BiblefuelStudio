/**
 * Pollinations.ai adapter — free, keyless text-to-image (FLUX-based).
 *
 * Endpoint (GET, returns the image bytes directly):
 *   https://image.pollinations.ai/prompt/{urlencoded prompt}?width=..&height=..&seed=..&model=flux&nologo=true
 *
 * Why it's gated behind an env flag rather than auto-enabled: it needs no API
 * key, so without a flag it would silently become every deployment's image
 * provider. Enable explicitly with POLLINATIONS_ENABLED=true (or by setting a
 * POLLINATIONS_TOKEN for higher rate limits / nologo).
 *
 * Notes:
 *  - Generation is on-demand and can be slow, so the timeout is generous.
 *  - Pollinations occasionally returns a 200 with an HTML/JSON error page; we
 *    guard on the response content-type so we never cache a non-image as a PNG.
 *  - Free/anonymous use is rate-limited and offers no SLA — it's a fallback,
 *    not a primary. Review their terms before commercial use.
 */

// Uses Node 18+ global fetch — same rationale as the Cloudflare/Imagen adapters.

const ENDPOINT_BASE = "https://image.pollinations.ai/prompt";
// On-demand generation behind a free queue can take a while; give it room.
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * @returns {boolean}
 */
export function isPollinationsConfigured() {
  const flag = String(process.env.POLLINATIONS_ENABLED || "").trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  return String(process.env.POLLINATIONS_TOKEN || "").trim().length > 0;
}

/**
 * Map our internal aspect names to concrete pixel dimensions. Kept modest so
 * the free queue returns reasonably fast; the ffmpeg scene graph scales/crops.
 *
 * @param {string} [aspect]
 * @returns {{ width: number, height: number }}
 */
function toDimensions(aspect) {
  const a = String(aspect || "").toLowerCase();
  if (a === "landscape" || a === "16:9") return { width: 1344, height: 768 };
  if (a === "square" || a === "1:1") return { width: 1024, height: 1024 };
  return { width: 768, height: 1344 }; // portrait (≈9:16) — the Story default
}

/**
 * Generate a single image via Pollinations.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {number} [args.seed]
 * @param {string} [args.aspect]   portrait | square | landscape
 * @param {string} [args.model]    override model id (default "flux")
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<import("./cloudflare.js").ImageGenResult>}
 */
export async function generateImagePollinations({ prompt, seed, aspect, model, signal }) {
  if (!isPollinationsConfigured()) {
    return { ok: false, provider: "pollinations", error: "Pollinations not enabled (set POLLINATIONS_ENABLED=true)" };
  }
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, provider: "pollinations", error: "prompt required" };
  }

  const { width, height } = toDimensions(aspect);
  const modelId = String(model || process.env.POLLINATIONS_MODEL || "flux").trim();
  const token = String(process.env.POLLINATIONS_TOKEN || "").trim();

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: modelId,
    nologo: "true",
  });
  if (Number.isFinite(seed)) params.set("seed", String(Number(seed)));
  if (token) params.set("token", token);

  const url = `${ENDPOINT_BASE}/${encodeURIComponent(prompt.trim().slice(0, 2048))}?${params.toString()}`;

  const ctrl = new AbortController();
  const timeoutTimer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    const headers = { Accept: "image/*" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(url, { headers, signal: ctrl.signal });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, provider: "pollinations", model: modelId, status: resp.status, error: `Pollinations ${resp.status}: ${text.slice(0, 200)}` };
    }

    const contentType = String(resp.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) {
      return { ok: false, provider: "pollinations", model: modelId, error: "Pollinations returned an empty body" };
    }
    // Guard against 200-status error pages (HTML/JSON) being cached as an image.
    if (!contentType.startsWith("image/")) {
      return { ok: false, provider: "pollinations", model: modelId, error: `Pollinations returned a non-image response (${contentType || "unknown content-type"})` };
    }
    return { ok: true, provider: "pollinations", model: modelId, imageBuffer: buf, contentType: contentType || "image/jpeg" };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "Pollinations request timed out" : String(err?.message || err);
    return { ok: false, provider: "pollinations", model: modelId, error: msg };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
