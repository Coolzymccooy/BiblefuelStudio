import path from "path";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { FONT_DIR } from "../videoFilters.js";
import { getClip, clipFile, readLibrary } from "../visualLibrary/store.js";
import { resolveBed } from "../sceneScript/music.js";
import { bedSectionArgs } from "../sceneScript/sfx.js";
import { FONTS } from "../sceneScript/renderStage.js";
import { createRenderLifecycle, ff, getServeUrl, remotionRender } from "../render/lifecycle.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./store.js";
import { buildCartoonRenderData, filmTimeline } from "./renderData.js";
import { MAX_FILM_SEC } from "./plan.js";

/**
 * Render a filmed cartoon to the finished video (spec section 7.7): stage the
 * clips, the music bed (cut to the film's length) and the fonts, then the
 * render lifecycle shared with Scene script (render/lifecycle.js) renders the
 * "Cartoon" composition and finishes at -14 LUFS. One render per project at a
 * time; a restart leaves no worker, so a render left running is shown as
 * stopped. The last finished film's name is carried in `render.previous` so
 * the next good render can remove it when the title (and so the name) changed.
 */

export const COMPOSITION_ID = "Cartoon";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What stops this cartoon from rendering, as sentences for the page. */
export function cartoonRenderBlockers(ctx, project, { clips = readLibrary(ctx.dataDir) } = {}) {
  const out = [];
  const shots = project.shots || [];
  const missing = shots.filter((s) => !(s.clip?.status === "done" && s.clip.libraryId));
  if (missing.length) out.push(`${plural(missing.length, "shot has", "shots have")} no clip yet. Film ${missing.length === 1 ? "it" : "them"} first.`);
  const byId = new Map(clips.map((c) => [c.id, c]));
  const lost = shots.filter((s) => s.clip?.libraryId && (!byId.has(s.clip.libraryId) || !clipFile(ctx, byId.get(s.clip.libraryId))));
  if (lost.length) {
    out.push(lost.length === 1
      ? "1 shot uses a clip that was removed from the library. Re-make it."
      : `${lost.length} shots use clips that were removed from the library. Re-make them.`);
  }
  if (project.music?.bed && !resolveBed(ctx.dataDir, project.music.bed)) {
    out.push("The music bed can't be found. Choose another, or turn the music off.");
  }
  if (!missing.length) {
    const { total, fits } = filmTimeline(project);
    if (!fits) out.push(`The film runs ${total.toFixed(1)} s with its cards; the limit is ${MAX_FILM_SEC} s. Shorten a line and re-make its shot.`);
  }
  return out;
}

/** What the page should mention but that does not stop a render: shots made from an out-of-date frame. */
export function cartoonRenderWarnings(project) {
  return (project.shots || [])
    .map((s, i) => (s.clip?.status === "done" && s.clip.stale
      ? `Shot ${i + 1} starts from the old last frame of the shot before. Re-make it, or render it as it is.`
      : null))
    .filter(Boolean);
}

/** The clips, the bed cut to the film's length, and the fonts, by public name. */
async function stageAssets(ctx, project, stageDir, deps, signal) {
  const files = {};
  const names = { clips: {}, bed: null, fonts: {} };
  for (const s of project.shots) {
    const clip = getClip(ctx.dataDir, s.clip?.libraryId);
    const file = clip ? clipFile(ctx, clip) : null;
    if (!file) throw new Error(`The clip for shot ${s.id} is missing from the library. Re-make it.`);
    names.clips[s.id] = `clip-${s.id}.mp4`;
    files[names.clips[s.id]] = file;
  }
  const bed = project.music?.bed ? resolveBed(ctx.dataDir, project.music.bed) : null;
  if (bed) {
    const staged = path.join(stageDir, "bed.wav");
    await ff(deps, bedSectionArgs(bed, staged, { offsetSec: 0, durationSec: filmTimeline(project).total }), signal);
    names.bed = "bed.wav";
    files["bed.wav"] = staged;
  }
  for (const [k, f] of Object.entries(FONTS)) {
    names.fonts[k] = f;
    files[f] = path.join(FONT_DIR, f);
  }
  return { files, names };
}

const lifecycle = createRenderLifecycle({
  label: "cartoon",
  store: { readProject, updateProject, projectOutputDir, projectOutputUrl },
  compositionId: COMPOSITION_ID,
  fileFallback: "cartoon",
  stageAssets,
  buildProps: buildCartoonRenderData,
  plannedSec: (project) => filmTimeline(project).total,
  previousOf: (render) => render?.file || render?.previous || null,
  carryPrevious: true,
  interrupted: "Interrupted by a server restart. Render again; the clips are kept.",
  defaultDeps: Object.freeze({ ffmpeg: runFfmpeg, probe: probeAudioDurationSec, serveUrl: getServeUrl, render: remotionRender }),
});

export const isRenderingCartoon = lifecycle.isRendering;

/** Stop a running render. True when there was one to stop. */
export const cancelCartoonRender = lifecycle.cancel;

/**
 * Start a render in the background. Returns the project marked queued, or
 * null when a render is already running for it (or the project is gone).
 * Callers check cartoonRenderBlockers first.
 */
export const startCartoonRender = lifecycle.start;

/** After a restart a queued or running render has no worker: show it as stopped. */
export const recoverInterruptedCartoonRender = lifecycle.recover;
