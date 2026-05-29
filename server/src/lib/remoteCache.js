// Download remote (Pexels CDN, generated artwork) URLs to a local cache
// before feeding them to FFmpeg. Streaming HTTP inputs through FFmpeg
// directly worked when the network held, but Pexels' CDN occasionally
// drops mid-transfer with WSAECONNRESET (Windows error -10054), and
// `-stream_loop -1` makes things worse — every loop re-fetches the file,
// so a network blip kills the render. A local copy is bulletproof.
//
// Files are keyed by a SHA-1 of the URL so the same Pexels id is reused
// across renders (zero re-downloads). Cache lives under OUTPUT_DIR/cache
// to share the existing static `/outputs/...` mount and skip new routing.
//
// Integrity matters: stream.pipeline resolves SUCCESSFULLY even when the
// server closes the connection before sending Content-Length bytes, which
// previously left truncated files in the cache that ffmpeg would happily
// re-use until it hit the corrupted tail and crashed with "Conversion
// failed!". We compare the on-disk size to Content-Length and reject any
// mismatch (and any obviously-tiny "complete" file under MIN_USABLE_BYTES).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import fetch from "node-fetch";
import { OUTPUT_DIR } from "./paths.js";

const CACHE_DIR = path.join(OUTPUT_DIR, "cache", "remote-bg");
// A 22s portrait Pexels clip is typically 10–50 MB. Anything smaller than
// 256 KB on a "complete" download is almost certainly a CDN error page,
// preflight redirect body, or an aborted stream — reject it.
const MIN_USABLE_BYTES = 256 * 1024;
const MAX_DOWNLOAD_ATTEMPTS = 3;

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function urlExtension(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    const ext = (last.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
    if (ext) return ext;
  } catch { /* fall through */ }
  return "mp4";
}

/**
 * Resolve a path to a local file. Local paths pass through unchanged.
 * HTTP(S) URLs are downloaded to the cache (or reused if already cached
 * AND large enough to be plausibly valid) and the local cache file path
 * is returned.
 *
 * @param {string} pathOrUrl  Path or URL to materialize.
 * @returns {Promise<string>} Local filesystem path that FFmpeg can read.
 */
export async function ensureLocalPath(pathOrUrl) {
  const value = String(pathOrUrl || "").trim();
  if (!value) return value;
  if (!/^https?:\/\//i.test(value)) return value;

  ensureCacheDir();
  const hash = crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
  const ext = urlExtension(value);
  const outFile = path.join(CACHE_DIR, `${hash}.${ext}`);

  // Already cached? Re-use only if large enough to be plausibly complete.
  // Anything smaller than MIN_USABLE_BYTES is almost certainly a corrupt
  // leftover from a partial download — delete it and re-fetch.
  if (fs.existsSync(outFile)) {
    const size = fs.statSync(outFile).size;
    if (size >= MIN_USABLE_BYTES) return outFile;
    console.warn(`[remoteCache] discarding ${path.basename(outFile)} (${size}B < ${MIN_USABLE_BYTES}B)`);
    try { fs.unlinkSync(outFile); } catch { /* ignore */ }
  }

  // Download with retries. Verify the on-disk size matches Content-Length
  // (when the server provides it) — `stream.pipeline` resolves even when
  // the source aborts mid-stream, so without this check we'd silently
  // cache truncated files and ffmpeg would crash mid-render with
  // "Conversion failed!".
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    const tmpFile = `${outFile}.part`;
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try {
      const resp = await fetch(value);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${value}`);
      const expectedSize = Number(resp.headers.get("content-length")) || 0;
      await pipeline(resp.body, fs.createWriteStream(tmpFile));
      const actualSize = fs.statSync(tmpFile).size;
      if (expectedSize > 0 && actualSize !== expectedSize) {
        throw new Error(`truncated: got ${actualSize}B expected ${expectedSize}B`);
      }
      if (actualSize < MIN_USABLE_BYTES) {
        throw new Error(`too small: ${actualSize}B < ${MIN_USABLE_BYTES}B`);
      }
      fs.renameSync(tmpFile, outFile);
      return outFile;
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      console.warn(`[remoteCache] attempt ${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS} failed for ${value}: ${err?.message || err}`);
    }
  }
  throw new Error(`remoteCache: failed to download ${value} after ${MAX_DOWNLOAD_ATTEMPTS} attempts: ${lastErr?.message || lastErr}`);
}
