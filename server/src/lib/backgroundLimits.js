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

/** Largest input file (MB) accepted for renders and URL imports; MAX_INPUT_MB overrides. */
export const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);
