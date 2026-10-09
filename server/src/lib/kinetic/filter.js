import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { buildAss } from "./ass.js";

/**
 * The ffmpeg filter for Studio captions, plus the .ass file it reads. Pure:
 * the caller writes `sideFiles` before starting ffmpeg, which keeps the arg
 * builders testable.
 */
export function studioCaptionFilter({ assPath, ...opts }) {
  const text = buildAss(opts);
  if (!text) return { filter: "", sideFiles: [] };
  return {
    // Quoted, like drawtext's fontfile: an unquoted "C\:" loses its backslash
    // at the graph level and the drive colon then ends the option.
    filter: `ass=filename='${escapeFontPath(assPath)}':fontsdir='${escapeFontPath(FONT_DIR)}'`,
    sideFiles: [{ path: assPath, text }],
  };
}
