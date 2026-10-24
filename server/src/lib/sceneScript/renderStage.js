import path from "path";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { FONT_DIR } from "../videoFilters.js";
import { getClip, clipFile, readLibrary } from "../visualLibrary/store.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./projectStore.js";
import { buildRenderData, musicSections } from "./renderData.js";
import { resolveBed } from "./music.js";
import { heartbeatArgs, impactArgs, bedSectionArgs } from "./sfx.js";
import {
  createRenderLifecycle, ff, getServeUrl, remotionRender as renderComposition, finishLoudness, REMOTION_ENTRY, MAX_UPLOAD_BYTES,
} from "../render/lifecycle.js";

/**
 * Render a voiced, fully shot scene-script project with Remotion: stage the
 * voices, clips, music sections and sound effects, then the shared render
 * lifecycle (render/lifecycle.js) serves them to headless Chrome, renders the
 * "SceneScript" composition and finishes at -14 LUFS under the upload limit.
 */

export const COMPOSITION_ID = "SceneScript";
export { REMOTION_ENTRY, MAX_UPLOAD_BYTES, getServeUrl, finishLoudness };
export const FONTS = Object.freeze({
  sans: "Montserrat-Variable.ttf",
  serif: "CormorantGaramond-Variable.ttf",
  serifItalic: "CormorantGaramond-Italic-Variable.ttf",
});

/** Render one composition of the bundle (Scene script's by default; Cartoon passes its own id). */
export function remotionRender(args) {
  return renderComposition({ ...args, compositionId: args?.compositionId ?? COMPOSITION_ID });
}

/** What stops this project from rendering, as sentences for the page. */
export function renderBlockers(ctx, project, { clips = readLibrary(ctx.dataDir) } = {}) {
  const out = [];
  if (!project.timeline || project.voice?.status !== "done" || project.timeline.missing?.length) {
    out.push("Voice every line first.");
  }
  const missing = project.shots.filter((s) => !(s.clip?.status === "done" && s.clip.libraryId));
  if (missing.length) out.push(`${missing.length} shot(s) have no clip yet.`);
  const ids = new Set(clips.map((c) => c.id));
  const lost = project.shots.filter((s) => s.clip?.libraryId && !ids.has(s.clip.libraryId));
  if (lost.length) out.push(`${lost.length} shot(s) use a clip that was removed from the library.`);
  const beds = project.music.cues.filter((c) => !resolveBed(ctx.dataDir, c.bed));
  if (beds.length) out.push(`${beds.length} music cue(s) have no playable bed.`);
  return out;
}

/** Voices, clips, the music sections, heartbeat and impact, and the fonts, by public name. */
async function stageAssets(ctx, project, stageDir, deps, signal) {
  const files = {};
  const names = { voice: {}, music: {}, clips: {}, fonts: {} };
  const voiceDir = path.join(projectOutputDir(ctx.outputDir, project.id), "voice");
  for (const l of project.lines) {
    names.voice[l.id] = `voice-${l.id}.wav`;
    files[names.voice[l.id]] = path.join(voiceDir, l.audio.file);
  }
  for (const s of project.shots) {
    names.clips[s.id] = `clip-${s.id}.mp4`;
    files[names.clips[s.id]] = clipFile(ctx, getClip(ctx.dataDir, s.clip.libraryId));
  }
  for (const section of musicSections(project, project.timeline)) {
    const name = `music-${section.id}.wav`;
    await ff(deps, bedSectionArgs(resolveBed(ctx.dataDir, section.bed), path.join(stageDir, name), {
      offsetSec: section.offsetSec, durationSec: section.to - section.from,
    }), signal);
    names.music[section.id] = name;
    files[name] = path.join(stageDir, name);
    if (section.heartbeat && !names.heartbeat) {
      await ff(deps, heartbeatArgs(path.join(stageDir, "heartbeat.wav"), section.to - section.from), signal);
      names.heartbeat = "heartbeat.wav";
      files["heartbeat.wav"] = path.join(stageDir, "heartbeat.wav");
    }
  }
  if (project.timeline.drop) {
    await ff(deps, impactArgs(path.join(stageDir, "impact.wav")), signal);
    names.impact = "impact.wav";
    files["impact.wav"] = path.join(stageDir, "impact.wav");
  }
  for (const [k, f] of Object.entries(FONTS)) {
    names.fonts[k] = f;
    files[f] = path.join(FONT_DIR, f);
  }
  return { files, names };
}

const lifecycle = createRenderLifecycle({
  label: "scene-script",
  store: { readProject, updateProject, projectOutputDir, projectOutputUrl },
  compositionId: COMPOSITION_ID,
  fileFallback: "scene-script",
  stageAssets,
  buildProps: buildRenderData,
  plannedSec: (project) => project.timeline.total,
  // Issue #123: the queued state drops render.file, so no previous render is ever removed yet.
  previousOf: (render) => render?.file,
  carryPrevious: false,
  interrupted: "Interrupted by a server restart. Render again; clips and voices are kept.",
  defaultDeps: Object.freeze({ ffmpeg: runFfmpeg, probe: probeAudioDurationSec, serveUrl: getServeUrl, render: renderComposition }),
});

export const isRendering = lifecycle.isRendering;
export const cancelRender = lifecycle.cancel;

/**
 * Start a render in the background. Returns the project marked queued, or
 * null when a render is already running for it. Callers check
 * renderBlockers first.
 */
export const startRender = lifecycle.start;

/** After a restart a queued or running render has no worker: mark it stopped. */
export const recoverInterruptedRender = lifecycle.recover;
