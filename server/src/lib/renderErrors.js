/**
 * Translate a failed ffmpeg render (exit code + raw stderr) into a single,
 * concise message a non-technical user can act on.
 *
 * The full ffmpeg stderr is always preserved server-side (console log + a
 * `captioned-stderr-*.txt` sidecar); the UI only ever sees the string returned
 * here. Each branch ends in a short `(ref: ...)` tag so a user can quote it in
 * a support request and we can grep the matching server log.
 *
 * Deliberately leaks NO ffmpeg internals (option names, lib versions, filter
 * graph) — those scare users and mean nothing to them.
 *
 * @param {number} code     ffmpeg process exit code
 * @param {string} [stderr] raw ffmpeg stderr (any length; only scanned, never echoed)
 * @returns {string} user-facing message ending in `(ref: <tag>)`
 */
export function friendlyRenderError(code, stderr = "") {
  const s = String(stderr).toLowerCase();
  const ref = (message, tag) => `${message} (ref: ${tag})`;

  // Malformed ffmpeg argument vector — a bug on our side, never the user's
  // files. (This is the class of failure the FFmpeg 5.1 `-/filter_complex`
  // mismatch produced.)
  if (/unrecognized option|error splitting the argument list|option not found/.test(s)) {
    return ref(
      "The video renderer hit an internal setup error on our side — your files are fine. Please report this and we'll fix it.",
      "render-config",
    );
  }

  // An input file couldn't be opened or decoded.
  if (/no such file|could not open file|error opening input|invalid data found|does not contain any stream/.test(s)) {
    return ref(
      "We couldn't read one of your media files. Please re-upload your audio and background(s), then try again.",
      "render-input",
    );
  }

  // Out of memory — typically very large (4K) backgrounds on a long sermon.
  if (/cannot allocate memory|out of memory|av_malloc|malloc of size|memory allocation/.test(s)) {
    return ref(
      "The render ran out of memory. Try fewer or smaller background clips, or render a shorter section.",
      "render-memory",
    );
  }

  // Caption drawing failed (font missing, drawtext rejected the text).
  if (/drawtext|fontconfig|cannot load.*font|could not load.*font/.test(s)) {
    return ref(
      "Something went wrong while drawing the captions. Try a different caption animation, or check the transcript for unusual characters.",
      "render-captions",
    );
  }

  // The filter graph (background + captions + audio) couldn't be wired up.
  if (/stream specifier|matches no streams|failed to configure|reinitializing filters|error while filtering|invalid argument/.test(s)) {
    return ref(
      "We couldn't combine your captions, background and audio for this render. Please report this and we'll look into it.",
      "render-compose",
    );
  }

  // Anything else — keep the exit code so support can still triage.
  return ref(
    "The video render failed unexpectedly. Please try again — if it keeps happening, report it with this code.",
    `render-exit-${Number.isFinite(code) ? code : "x"}`,
  );
}
