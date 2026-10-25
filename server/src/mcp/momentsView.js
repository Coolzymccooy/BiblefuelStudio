import { z } from "zod";
import { NORMALISERS, outputUrl } from "./jobs.js";

/**
 * Shared pieces of the Moments tools (tools/moments.js): what a Moment looks
 * like to an agent and the choices the route accepts. Lives outside tools/
 * because the registry loads every file there as tools.
 *
 * The lists mirror lib/moments/occasions.js and lib/motion/styles.js (a test
 * keeps them equal); they are copied because those modules pull in the video
 * filter code, which reads the environment at import time.
 */

// lib/moments/projectStore.js ID_RE: no dots or slashes, so safe in a route path.
export const MOMENT_ID = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "a Moment id from moments_project");
export const MOMENT_OCCASIONS = ["birthday", "anniversary", "wedding", "sermon", "event", "thanksgiving", "memorial", "fun"];
export const MOMENT_STYLES = ["glow", "celebrate", "hype", "gallery", "fellowship", "scrapbook", "partyPop", "premiere"];
export const MOMENT_LENGTHS = [15, 30, 60, 90, 120, 180];
export const MOMENT_DETAIL_FIELDS = ["name", "milestone", "eventTitle", "date", "venue", "verse"];
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 100;
/** routes/moments.js SCRIPT_MAX: the longest voiceover script or idea. */
export const SCRIPT_MAX = 1200;
/** lib/ambient/movementImage.js UPLOAD_NAME: the only own files a Moment takes as photos (media_import_url kind image names them so). */
export const PHOTO_UPLOAD_NAME = /^bg-image-[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

const listOf = (value) => (Array.isArray(value) ? value : []);

/** A file the Moments routes keep as `/outputs/<name>` or a bare name, as url and path. */
export function outputRef(file, publicBase) {
  const name = typeof file === "string" ? file.split(/[\\/]/).pop() : "";
  return name ? { url: outputUrl(name, publicBase), path: `/outputs/${name}` } : null;
}

/** A row of GET /api/moments: the thumbnail and the newest video as links. */
export function summaryView(row, publicBase) {
  return {
    id: row.projectId,
    occasion: row.occasion ?? null,
    title: row.title ?? "",
    updatedAt: row.updatedAt ?? null,
    thumbUrl: row.thumb ? outputUrl(row.thumb, publicBase) : null,
    lastVideo: outputRef(row.lastFile, publicBase),
  };
}

function voiceoverView(voiceover, publicBase) {
  if (!voiceover?.file) return null;
  return { script: voiceover.script ?? "", voiceId: voiceover.voiceId ?? null, ...outputRef(voiceover.file, publicBase) };
}

/** A Moment as an agent sees it: its words, photos and sound, past videos and (once a render started) a moments handle. */
export function projectView(project, publicBase) {
  const sound = project.sound || {};
  return {
    id: project.projectId,
    occasion: project.occasion ?? null,
    title: project.title ?? "",
    details: project.details ?? {},
    statements: listOf(project.statements),
    photos: listOf(project.photos).map((p) => ({ ref: p.ref, url: p.url ? outputUrl(p.url, publicBase) : null, width: p.width, height: p.height })),
    heroIndex: project.heroIndex ?? 0,
    style: project.style ?? null,
    energy: project.energy ?? null,
    lengthSec: project.lengthSec ?? null,
    seed: project.seed ?? null,
    song: sound.song ?? null,
    voiceover: voiceoverView(sound.voiceover, publicBase),
    history: listOf(project.history).map(({ file, ...entry }) => ({ ...entry, video: outputRef(file, publicBase) })),
    job: project.render ? NORMALISERS.moments.normalise({ project }, { outputUrl: (p) => outputUrl(p, publicBase) }) : null,
  };
}

/** True while the Moment's render is running (as GET /api/moments/:id shows it). */
export const isRendering = (project) => project?.render?.status === "running";

/** The handle moments_render returns for a render it has just started. */
export function renderStarted(id, jobId) {
  return { kind: "moments", id: String(id), jobId: jobId ?? null, status: "running", percent: null, phase: "waiting", output: null, error: null };
}
