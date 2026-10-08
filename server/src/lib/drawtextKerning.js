import { spawnSync } from "child_process";

/**
 * How the ffmpeg on this machine kerns drawtext, so a caption can be
 * measured the way it will actually be drawn.
 *
 * ffmpeg 6.1 moved drawtext onto HarfBuzz, which kerns real glyph pairs.
 * Before that (prod runs 5.1), drawtext passed character codes to
 * FT_Get_Kerning where glyph ids belong, so kerned fonts got the wrong pairs.
 * Measuring the right pairs on 5.1 put a lit word up to ~30px off its own.
 */

/** "legacy" for an ffmpeg before 6.1, "shaped" otherwise (git builds included). */
export function kerningModeForVersion(versionText) {
  const m = String(versionText || "").match(/ffmpeg version n?(\d+)\.(\d+)/);
  if (!m) return "shaped";
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major < 6 || (major === 6 && minor < 1) ? "legacy" : "shaped";
}

let cached = null;

/**
 * The kerning mode for drawtext here: DRAWTEXT_KERNING if set, otherwise
 * read once from `ffmpeg -version`. If ffmpeg can't be asked, assume prod's.
 */
export function drawtextKerning() {
  const forced = String(process.env.DRAWTEXT_KERNING || "").trim();
  if (forced === "legacy" || forced === "shaped" || forced === "none") return forced;
  if (cached) return cached;
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const res = spawnSync(ff, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  cached = res.status === 0 ? kerningModeForVersion(res.stdout) : "legacy";
  return cached;
}

/** Test seam. */
export function _resetDrawtextKerning() { cached = null; }
