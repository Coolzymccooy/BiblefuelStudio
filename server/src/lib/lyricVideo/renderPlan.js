// server/src/lib/lyricVideo/renderPlan.js
//
// One render's captions and branding, planned together: the caption ASS, where those captions
// reach the logo band, the branding plan that steps aside for them, and the branding's own
// Dialogue lines added to the same document. The ffmpeg builder then reads the plan for the
// video's length, the audio's shaping and the logo's time mask.
import { buildLyricAss } from "./lyricAss.js";
import { parseInkEvents, bandHideWindows, captionsEnd } from "./captionBands.js";
import { planBranding, bandGeometry } from "./brandingPlan.js";
import { brandingEvents } from "./brandingAss.js";
import { resolveLook } from "../kinetic/looks.js";
import { probeMediaSize } from "../story/sceneFraming.js";

const DEFAULT_LOOK = "studio-lagos-night";
const NO_LENGTH = "The song's length is unknown, so the video can't be planned.";

const knownSize = (logo) => Number(logo?.width) > 0 && Number(logo?.height) > 0;

/** The logo with its pixel size, measuring the file when the caller did not; null when it cannot be read. */
async function sizedLogo(logo) {
  if (!logo?.file) return null;
  if (knownSize(logo)) return logo;
  const size = await probeMediaSize(logo.file);
  return knownSize(size) ? { ...logo, width: size.width, height: size.height } : null;
}

/** The branding lines go in before the captions' trailing newline, under the captions' header. */
function appendEvents(captions, lines) {
  if (!lines.length) return captions;
  const body = captions.endsWith("\n") ? captions.slice(0, -1) : captions;
  return `${body}\n${lines.join("\n")}\n`;
}

/**
 * The ASS document, branding plan and band geometry for one render.
 * `aspect` is the render frame ("portrait" | "landscape" | "square"); `logo` is
 * `{ file, width, height, opacity } | null`. With no placed line there is nothing to render:
 * `ass` is "" (as buildLyricAss gives) and `plan` and `geometry` are null.
 * Throws when the song's length is not a positive number: nothing can be planned without it.
 * @returns {Promise<{ ass: string, plan: object | null, geometry: object | null }>}
 */
export async function buildRenderAss(project, { width: w, height: h, aspect, options, logo: rawLogo, shortsTrim } = {}) {
  const durationSec = Number(project.song?.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(NO_LENGTH);
  const captions = buildLyricAss(project, { w, h, layout: aspect === "portrait" ? "shorts" : "default" });
  if (!captions) return { ass: "", plan: null, geometry: null };
  const logo = await sizedLogo(rawLogo);
  const geometry = bandGeometry({ w, h, logo: logo ? { width: logo.width, height: logo.height } : null });
  const events = parseInkEvents(captions);
  const plan = planBranding({
    durationSec,
    audibleEnd: project.timing?.audibleEnd,
    captionsEnd: captionsEnd(events),
    hideWindows: bandHideWindows(events, { bandBottom: geometry.bandBottom }),
    options,
    hasLogo: Boolean(logo),
    artist: project.artist,
    shortsTrim,
    aspect,
    lines: project.lines,
  });
  const look = resolveLook(project.look?.id || DEFAULT_LOOK);
  const lines = brandingEvents({ plan, geometry, look, title: project.title, artist: project.artist, w, h });
  return { ass: appendEvents(captions, lines), plan, geometry };
}
