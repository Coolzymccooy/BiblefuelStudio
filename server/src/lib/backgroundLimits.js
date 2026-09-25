/**
 * Input-size guards for background clips.
 *
 * Extracted from routes/render.js so the message can be tested. The old error
 * read `backgroundPaths[1] too large (>200MB)`, which had two problems the
 * operator hit directly: it used a ZERO-based index while the UI numbers
 * backgrounds from 1 (so it pointed at the wrong thumbnail), and it named no
 * file — and because the background selection is persisted, the offending clip
 * may have been chosen in an earlier session and long forgotten.
 */

/**
 * A message that names the background, its size, and what to do about it.
 * @param {number} index Zero-based position in backgroundPaths.
 * @param {string} rawPath The path/URL as the client sent it.
 * @param {number} bytes Size in bytes; 0 when unknown.
 * @param {number} maxMb The configured limit.
 */
export function backgroundTooLargeMessage(index, rawPath, bytes, maxMb) {
  const name = String(rawPath || '').split(/[\/]/).pop() || `background ${index + 1}`;
  const mb = bytes ? ` (${Math.round(bytes / 1048576)}MB)` : '';
  // index + 1 to match the numbered badge in the Background panel.
  return `Background ${index + 1} "${name}"${mb} exceeds the ${maxMb}MB limit. `
    + `Remove it in the Background panel, or pick a smaller clip.`;
}

/**
 * Content-Length via HEAD, so an oversized remote is rejected BEFORE it is
 * downloaded in full. Returns 0 when the host declines to say, in which case
 * the caller must fall back to checking the file on disk.
 * @param {string} url
 * @param {typeof globalThis.fetch} [fetchImpl] Injectable for tests.
 */
export async function remoteContentLength(url, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(url, { method: 'HEAD' });
    const len = Number(r.headers.get('content-length'));
    return Number.isFinite(len) && len > 0 ? len : 0;
  } catch {
    return 0;
  }
}
