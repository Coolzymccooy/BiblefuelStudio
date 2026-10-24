/**
 * The one test for "is this media input a URL or a file path?".
 *
 * ffmpeg/ffprobe decide by the prefix, not by `//`: `http:/host/x`,
 * `http:host/x`, `tcp:`, `gopher:`, `concat:`, `subfile,...:` all open a
 * protocol. A check for `^https?://` let those through to ffmpeg as "local
 * files", which it then fetched with no SSRF guard. So: anything that starts
 * with a scheme (letters, then letters/digits/+.-, then a colon) is a URL,
 * except a Windows drive path (`C:\...`, `C:/...`). Callers download http(s)
 * through the guarded downloader and refuse every other scheme.
 */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;
const SUBFILE_PREFIX = /^subfile,/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUrlLike(value) {
  const text = String(value ?? "").trim();
  if (!text || WINDOWS_DRIVE.test(text)) return false;
  return SCHEME_PREFIX.test(text) || SUBFILE_PREFIX.test(text);
}
