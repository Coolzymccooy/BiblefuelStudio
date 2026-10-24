/**
 * Remote (http/https) render inputs: localise them before ffmpeg sees them,
 * and turn a failed fetch into an HTTP answer.
 *
 * ffmpeg fetches a URL input itself, with no SSRF check at all, so every
 * request- or store-supplied URL must become a local file first. localiseInput
 * downloads through ensureLocalPath (and so downloadPublicUrl): loopback,
 * private and metadata hosts are refused, redirects re-vetted, size capped.
 */
import { ensureLocalPath } from "./remoteCache.js";
import { isRemoteUrl } from "./downloadInput.js";
import { isUrlGuardError, urlGuardMessage } from "./safeDownload.js";
import { backgroundTooLargeMessage } from "./backgroundLimits.js";

// ffmpeg used to stream these inputs, so there was no size floor at all. A
// short voice clip or a small still is legitimately far under the 256 KB the
// cache demands of video clips; 1 KB still rejects an empty error page.
const SMALL_MEDIA_MIN_BYTES = 1024;

/**
 * A local path for `value`: remote URLs are downloaded (cached), anything else
 * (local path, library id, /outputs alias, nullish) is returned unchanged.
 * Refusals throw with `.code` (URL_PRIVATE, URL_SCHEME, ...).
 * @param {string|null|undefined} value
 * @param {object} [opts] passed to ensureLocalPath (minBytes, maxBytes, test seams).
 */
export async function localiseInput(value, opts = {}) {
  if (!isRemoteUrl(value)) return value;
  return ensureLocalPath(value, { minBytes: SMALL_MEDIA_MIN_BYTES, ...opts });
}

/**
 * HTTP answer for a remote input that could not be fetched. A refusal is the
 * caller's fault (400, "<code>: <sentence>"); anything else is upstream (502).
 * @param {Error} err
 * @param {string} what e.g. "video", "music track 2"
 * @returns {{ status: number, error: string }}
 */
export function remoteInputFailure(err, what) {
  if (isUrlGuardError(err)) return { status: 400, error: urlGuardMessage(err) };
  return { status: 502, error: `Failed to fetch ${what}: ${err?.message || err}` };
}

/**
 * As remoteInputFailure, but an oversized background gets the message that
 * names the clip and its size, as the on-disk size check does.
 * @param {Error} err
 * @param {number} index zero-based background position
 * @param {string} rawPath the path/URL as the client sent it
 * @param {number} maxMb
 */
export function backgroundFetchFailure(err, index, rawPath, maxMb) {
  if (err?.code === "URL_TOO_LARGE") {
    return { status: 400, error: backgroundTooLargeMessage(index, rawPath, err.declaredBytes || 0, maxMb) };
  }
  return remoteInputFailure(err, `background ${index + 1}`);
}
