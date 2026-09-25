import fetch from "node-fetch";
import fs from "fs";
import { pipeline } from "stream/promises";

/** True for an http(s) URL (vs a local filesystem path). */
export function isRemoteUrl(p) {
  return /^https?:\/\//i.test(String(p || ""));
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_VALID_BYTES = 1024;

/**
 * Download a remote URL to `destPath`, retrying on transient network failures
 * (the Pexels TLS resets — error -10054 / ECONNRESET — that used to kill a
 * whole render when a background URL was streamed straight into ffmpeg).
 *
 * Returns `destPath` on success; throws after exhausting retries. A partial /
 * too-small file is deleted between attempts so a retry starts clean.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {{ retries?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function downloadToFile(url, destPath, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl || fetch;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await doFetch(url, { signal: controller.signal, redirect: "follow" });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      // node-fetch v3 exposes a Node Readable as `body`, so we can pipe it
      // straight to disk — constant memory, no full-buffer in RAM.
      await pipeline(resp.body, fs.createWriteStream(destPath));
      const size = fs.statSync(destPath).size;
      if (size < MIN_VALID_BYTES) throw new Error(`downloaded file too small (${size} bytes)`);
      return destPath;
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(destPath); } catch {}
      if (attempt < retries) {
        // Linear backoff: 400ms, 800ms, …
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`download failed for ${url}: ${lastErr?.message || lastErr}`);
}
