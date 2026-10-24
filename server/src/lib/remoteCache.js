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
// Every download is SSRF-vetted (downloadPublicUrl): a user-supplied URL
// must never make the server fetch loopback, private or metadata addresses.
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
import { OUTPUT_DIR } from "./paths.js";
import { downloadPublicUrl, assertPublicHttpUrl, isUrlGuardError } from "./safeDownload.js";
import { MAX_INPUT_MB } from "./backgroundLimits.js";
import { isUrlLike } from "./inputUrl.js";

const CACHE_DIR = path.join(OUTPUT_DIR, "cache", "remote-bg");
// A 22s portrait Pexels clip is typically 10–50 MB. Anything smaller than
// 256 KB on a "complete" download is almost certainly a CDN error page,
// preflight redirect body, or an aborted stream — reject it.
const MIN_USABLE_BYTES = 256 * 1024;
const MAX_DOWNLOAD_ATTEMPTS = 3;
// A 200 MB clip on a slow CDN needs minutes; downloadPublicUrl's 60 s default
// would cut legitimate backgrounds off. A stalled body still dies after its
// 30 s idle timeout.
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

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

/** The cached copy when it exists and is big enough to be plausibly complete. */
function reusableCacheFile(outFile, minBytes) {
  if (!fs.existsSync(outFile)) return null;
  const size = fs.statSync(outFile).size;
  if (size >= minBytes) return outFile;
  console.warn(`[remoteCache] discarding ${path.basename(outFile)} (${size}B < ${minBytes}B)`);
  try { fs.unlinkSync(outFile); } catch { /* ignore */ }
  return null;
}

/**
 * One vetted download to `tmpFile`, checked against the declared size and the
 * usable floor. `stream.pipeline` can resolve even when the source aborts
 * mid-stream, so without the size check a truncated file would be cached and
 * ffmpeg would crash mid-render with "Conversion failed!".
 */
async function downloadOnce(url, tmpFile, downloadOpts, minBytes) {
  const { declaredBytes } = await downloadPublicUrl(url, tmpFile, downloadOpts);
  const actualSize = fs.statSync(tmpFile).size;
  if (declaredBytes > 0 && actualSize !== declaredBytes) {
    throw new Error(`truncated: got ${actualSize}B expected ${declaredBytes}B`);
  }
  if (actualSize < minBytes) {
    throw new Error(`too small: ${actualSize}B < ${minBytes}B`);
  }
}

async function vetBeforeCacheUse(value, opts) {
  try {
    await assertPublicHttpUrl(value, vetOptionsFrom(opts));
  } catch (err) {
    if (isUrlGuardError(err)) throw err;
  }
}

function vetOptionsFrom(opts) {
  return {
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.unvettedHostsForTests ? { unvettedHostsForTests: opts.unvettedHostsForTests } : {}),
  };
}

function downloadOptionsFrom(opts) {
  return {
    maxBytes: opts.maxBytes ?? MAX_INPUT_MB * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.unvettedHostsForTests ? { unvettedHostsForTests: opts.unvettedHostsForTests } : {}),
  };
}

/**
 * Resolve a path to a local file. Local paths pass through unchanged.
 * Any URL-like value (see inputUrl.js) is treated as remote: http(s) URLs are downloaded to the cache (or reused if already cached
 * AND large enough to be plausibly valid) and the local cache file path
 * is returned.
 *
 * Downloads go through downloadPublicUrl: loopback, private and metadata
 * hosts are refused, every redirect is re-vetted and the body is capped at
 * `maxBytes`. A refusal (URL_SCHEME, URL_PRIVATE, URL_REDIRECTS,
 * URL_TOO_LARGE) is thrown at once with its `.code`; it is never retried.
 *
 * @param {string} pathOrUrl  Path or URL to materialize.
 * @param {{
 *   minBytes?: number, // smallest download accepted; default 256 KB (video clips)
 *   maxBytes?: number, // default MAX_INPUT_MB
 *   timeoutMs?: number,
 *   fetchImpl?: Function, lookup?: Function, unvettedHostsForTests?: Iterable<string>,
 * }} [opts] the last three are test seams.
 * @returns {Promise<string>} Local filesystem path that FFmpeg can read.
 */
export async function ensureLocalPath(pathOrUrl, opts = {}) {
  const value = String(pathOrUrl || "").trim();
  if (!value) return value;
  // Any scheme, not just "http://": ffmpeg also opens `http:/host`, `tcp:`...
  // Non-http schemes are refused (URL_SCHEME) by downloadPublicUrl.
  if (!isUrlLike(value)) return value;

  const minBytes = opts.minBytes ?? MIN_USABLE_BYTES;
  ensureCacheDir();
  const hash = crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
  const outFile = path.join(CACHE_DIR, `${hash}.${urlExtension(value)}`);
  // A cache hit is still vetted: the cache is keyed by the URL alone, so a
  // file cached (or planted) for a name that now resolves privately must not
  // be handed out as if it had been fetched safely. A lookup that merely
  // fails (DNS outage) is not a refusal: the copy was vetted when cached.
  await vetBeforeCacheUse(value, opts);
  const cached = reusableCacheFile(outFile, minBytes);
  if (cached) return cached;

  const downloadOpts = downloadOptionsFrom(opts);
  // Unique per download: two renders of one URL at once must not unlink or
  // truncate each other's temp file.
  const tmpFile = `${outFile}.${crypto.randomBytes(6).toString("hex")}.part`;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt++) {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try {
      await downloadOnce(value, tmpFile, downloadOpts, minBytes);
      fs.renameSync(tmpFile, outFile);
      return outFile;
    } catch (err) {
      lastErr = err;
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (isUrlGuardError(err)) throw err;
      console.warn(`[remoteCache] attempt ${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS} failed for ${value}: ${err?.message || err}`);
    }
  }
  throw new Error(`remoteCache: failed to download ${value} after ${MAX_DOWNLOAD_ATTEMPTS} attempts: ${lastErr?.message || lastErr}`);
}
