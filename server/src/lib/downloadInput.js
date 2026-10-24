import fs from "fs";
import { downloadPublicUrl, isUrlGuardError } from "./safeDownload.js";
import { MAX_INPUT_MB } from "./backgroundLimits.js";
import { isUrlLike } from "./inputUrl.js";

/**
 * True for a URL in ANY form ffmpeg would open as one (`http:/x`, `tcp:`, ...),
 * false for a local filesystem path. See inputUrl.js.
 */
export function isRemoteUrl(p) {
  return isUrlLike(p);
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_VALID_BYTES = 1024;

/**
 * Download a remote URL to `destPath`, retrying on transient network failures
 * (the Pexels TLS resets — error -10054 / ECONNRESET — that used to kill a
 * whole render when a background URL was streamed straight into ffmpeg).
 *
 * Each attempt goes through downloadPublicUrl, so the host is vetted (no
 * loopback, private or metadata addresses), every redirect is re-vetted and the
 * body is capped at `maxBytes`. A refusal (URL_SCHEME, URL_PRIVATE,
 * URL_REDIRECTS, URL_TOO_LARGE) is rethrown at once with its `.code` (and
 * `.declaredBytes`): retrying cannot change the answer.
 *
 * Returns `destPath` on success; throws after exhausting retries. A partial /
 * too-small file is deleted between attempts so a retry starts clean.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {{
 *   retries?: number,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   fetchImpl?: Function,
 *   lookup?: Function,
 *   unvettedHostsForTests?: Iterable<string>,
 * }} [opts] `fetchImpl`, `lookup` and `unvettedHostsForTests` are test seams.
 */
export async function downloadToFile(url, destPath, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const downloadOpts = {
    maxBytes: opts.maxBytes ?? MAX_INPUT_MB * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.unvettedHostsForTests ? { unvettedHostsForTests: opts.unvettedHostsForTests } : {}),
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await downloadPublicUrl(url, destPath, downloadOpts);
      const size = fs.statSync(destPath).size;
      if (size < MIN_VALID_BYTES) throw new Error(`downloaded file too small (${size} bytes)`);
      return destPath;
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(destPath); } catch {}
      if (isUrlGuardError(err)) throw err;
      if (attempt < retries) {
        // Linear backoff: 400ms, 800ms, …
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw new Error(`download failed for ${url}: ${lastErr?.message || lastErr}`);
}
