/**
 * Generative-image orchestrator.
 *
 * One entry point: `generateBibleImage` — picks the configured provider(s)
 * in priority order, retries the next on failure, and persists the resulting
 * PNG/JPEG to disk so the existing video pipeline can consume it as a
 * still-image scene.
 *
 * Provider priority (overridable via IMAGE_GEN_PROVIDER):
 *   1. Cloudflare Workers AI — Flux-1-schnell, 10k neurons/day free forever
 *   2. Google Imagen — 100-500/day free on AI Studio
 *
 * Cache: deterministic file name derived from { seriesId, partNumber } so a
 * retried series doesn't burn through quota. Existing files are returned as
 * cache hits.
 *
 * Output: PNG bytes written to OUTPUT_DIR/genImg/{seriesId}/part-{N}.png.
 * Returns a relative `/outputs/genImg/...` URL that resolveAssetPath can
 * turn back into an absolute path for ffmpeg.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { OUTPUT_DIR } from "../paths.js";
import {
  buildBiblePrompt,
  chooseStyleAnchor,
  normalizeSeed,
} from "./prompt.js";
import { generateImageCloudflare, isCloudflareConfigured } from "./providers/cloudflare.js";
import { generateImageImagen, isImagenConfigured } from "./providers/imagen.js";
import { generateImagePollinations, isPollinationsConfigured } from "./providers/pollinations.js";

const SUBDIR = "genImg";

/**
 * Master feature flag. When false, generateBibleImage is a no-op that
 * returns `{ ok: false, skipped: true }` so callers can branch cleanly
 * without env probes.
 *
 * @returns {boolean}
 */
export function isImageGenEnabled() {
  const flag = String(process.env.IMAGE_GEN_ENABLED || "").trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  // Default: enabled IFF at least one provider has credentials/is enabled.
  return isCloudflareConfigured() || isImagenConfigured() || isPollinationsConfigured();
}

/**
 * Returns the ordered provider chain to try, honoring IMAGE_GEN_PROVIDER.
 * `auto` (default) picks all configured providers in their natural order:
 * free providers first (Cloudflare → Pollinations), then paid (Imagen), so a
 * free fallback is exhausted before any paid call.
 *
 * @returns {Array<"cloudflare" | "pollinations" | "imagen">}
 */
export function listProviderChain() {
  const requested = String(process.env.IMAGE_GEN_PROVIDER || "auto").trim().toLowerCase();
  const all = [];
  if (isCloudflareConfigured()) all.push("cloudflare");
  if (isPollinationsConfigured()) all.push("pollinations");
  if (isImagenConfigured()) all.push("imagen");
  if (requested === "auto") return all;
  if (requested === "none") return [];
  if (["cloudflare", "pollinations", "imagen"].includes(requested)) {
    return all.filter((p) => p === requested);
  }
  return all;
}

/**
 * @typedef {object} GenerateBibleImageResult
 * @property {boolean} ok
 * @property {string} [path]          absolute filesystem path of the saved image
 * @property {string} [publicUrl]     `/outputs/genImg/...` style URL (resolveAssetPath-friendly)
 * @property {string} [provider]
 * @property {boolean} [cached]
 * @property {string} [prompt]
 * @property {string} [error]
 * @property {boolean} [skipped]
 */

/**
 * Generate one image for one beat of a series segment.
 *
 * @param {object} args
 * @param {string} args.seriesId
 * @param {number} args.partNumber          1-indexed
 * @param {string} [args.beatType="verse"]  hook | verse | reflection
 * @param {string} [args.verseText=""]
 * @param {string} [args.aspect="portrait"]
 * @param {string} [args.styleAnchor]       optional override, otherwise derived
 * @param {string} [args.rawPrompt]         optional fully-formed prompt to use verbatim, bypassing buildBiblePrompt
 * @returns {Promise<GenerateBibleImageResult>}
 */
export async function generateBibleImage({
  seriesId,
  partNumber,
  beatType = "verse",
  verseText = "",
  aspect = "portrait",
  styleAnchor,
  rawPrompt,
}) {
  if (!isImageGenEnabled()) {
    return { ok: false, skipped: true, error: "image gen disabled (IMAGE_GEN_ENABLED=false or no provider configured)" };
  }

  const safeSeriesId = String(seriesId || "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60) || "anon";
  const part = Math.max(1, Math.floor(Number(partNumber) || 1));

  const dir = path.join(OUTPUT_DIR, SUBDIR, safeSeriesId);
  const file = path.join(dir, `part-${part}.png`);
  const publicUrl = `/outputs/${SUBDIR}/${safeSeriesId}/part-${part}.png`;

  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    return { ok: true, path: file, publicUrl, cached: true };
  }

  // When the caller supplies a fully-formed prompt (e.g. Story Video scenes that
  // already carry their own style anchor), use it verbatim and skip buildBiblePrompt.
  const prompt = (typeof rawPrompt === "string" && rawPrompt.trim())
    ? rawPrompt.trim()
    : buildBiblePrompt({
        beatType,
        verseText,
        styleAnchor: styleAnchor || chooseStyleAnchor(safeSeriesId),
        seriesSeed: safeSeriesId,
      });
  const seed = normalizeSeed(`${safeSeriesId}:${part}`);

  const chain = listProviderChain();
  if (chain.length === 0) {
    return { ok: false, error: "No image-gen providers configured", prompt };
  }

  // Collect EVERY provider's error, not just the last — otherwise a Cloudflare
  // quota failure is masked by the Imagen fallback's "needs billing" error and
  // the operator can't tell which provider to fix.
  const errors = [];
  for (const provider of chain) {
    const result = provider === "cloudflare"
      ? await generateImageCloudflare({ prompt, seed })
      : provider === "pollinations"
        ? await generateImagePollinations({ prompt, seed, aspect })
        : provider === "imagen"
          ? await generateImageImagen({ prompt, aspect })
          : null;

    if (!result) continue;
    if (result.ok && result.imageBuffer && result.imageBuffer.length > 0) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, result.imageBuffer);
        return {
          ok: true,
          path: file,
          publicUrl,
          provider: result.provider,
          cached: false,
          prompt,
        };
      } catch (err) {
        errors.push(`${provider}: write failed (${err?.message || err})`);
        continue;
      }
    }
    const e = `${provider}: ${result.error || "unknown error"}`;
    errors.push(e);
    console.warn(`[IMG-GEN] ${e} — trying next provider`);
  }

  return { ok: false, error: errors.join(" | ") || "all providers failed", prompt };
}

/**
 * Hash a string into a short hex digest. Currently unused externally but
 * handy if we ever switch from `{seriesId, partNumber}` keying to
 * content-addressed caching.
 *
 * @param {string} value
 * @returns {string}
 */
export function hashKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}
