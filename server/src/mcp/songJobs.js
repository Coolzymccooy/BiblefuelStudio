import path from "node:path";
import { toHandle, toPercent, text, routeSegment } from "./jobHandle.js";

/**
 * Normalisers for the lyric video and Moments job kinds (registered in jobs.js NORMALISERS):
 *
 * - lyric_align: GET /api/lyric-video/:id, the song's saved timing state (the align route answers 202 and has no job route).
 * - lyric_render: GET /api/lyric-video/:projectId/render/:jobId, the render job.
 * - moments: GET /api/moments/:id, the Moment's render record.
 */

const NOT_TIMED = "Timing has not run on this song's current lyrics (a new song or changed lyrics clear it). Call lyric_align once the song and the lyrics are in.";
const MOMENT_RESTARTED = "The server restarted while this Moment was rendering. Call moments_render to make it again.";
const NO_MOMENT_RENDER = "No render has been started for this Moment. Call moments_render.";

const placed = (line) => Array.isArray(line?.words) && line.words.length > 0 && Number.isFinite(line.start) && Number.isFinite(line.end);

/** The share of the song the speech service has listened to, as a percent; null outside that step. */
function listeningPercent(progress) {
  const window = Number(progress?.window);
  const total = Number(progress?.total);
  if (progress?.step !== "listening" || !(window >= 0) || !(total > 0)) return null;
  return toPercent(Math.round((window / total) * 100));
}

/** How many lines the timing placed, and how many it could not hear (squeezed in and flagged). */
function lineCounts(lines) {
  const list = Array.isArray(lines) ? lines : [];
  return { total: list.length, timed: list.filter(placed).length, flagged: list.filter((l) => placed(l) && l.flag).length };
}

/** The handle fields a song's timing state reads as. */
function timingState(timing) {
  const status = String(timing?.status || "idle");
  if (status === "running") {
    return { rawStatus: "running", phase: text(timing.progress?.step) || "preparing", percent: listeningPercent(timing.progress) };
  }
  if (status === "done") return { rawStatus: "done" };
  if (status === "error") return { rawStatus: "failed", error: text(timing.error) || "Timing failed. Call lyric_align again." };
  return { rawStatus: "failed", error: NOT_TIMED };
}

export function fromLyricAlign(payload, ctx) {
  const project = payload?.project || {};
  const timing = project.timing || {};
  const state = timingState(timing);
  const handle = toHandle({ kind: "lyric_align", id: project.projectId, ...state }, ctx);
  if (handle.status !== "done") return handle;
  const warning = text(timing.lastError);
  return { ...handle, lines: lineCounts(project.lines), ...(warning ? { warning } : {}) };
}

/**
 * The render route names the video by its file name, flat in the user's outputs. Like every other kind, the
 * handle's path is the real file (in `ctx.outputDir`, the key owner's own output folder, which jobs_wait and
 * the job resource pass for this kind) and its url the /outputs/ link. Without the folder the path stays the
 * /outputs/ form, which the media tools also accept.
 */
function lyricVideo(file, outputDir) {
  const name = text(file)?.split(/[\\/]/).pop();
  if (!name) return { file: null, url: null };
  const link = `/outputs/${name}`;
  return { file: outputDir ? path.join(outputDir, name) : link, url: link };
}

export function fromLyricRender(payload, ctx) {
  const job = payload?.job || {};
  const video = lyricVideo(job.file, ctx.outputDir);
  return toHandle(
    { kind: "lyric_render", id: job.jobId, rawStatus: job.status, percent: toPercent(job.progress), ...video, error: job.error },
    ctx,
  );
}

export function fromMoments(payload, ctx) {
  const project = payload?.project || {};
  const render = project.render;
  if (!render) return toHandle({ kind: "moments", id: project.projectId, rawStatus: "failed", error: NO_MOMENT_RENDER }, ctx);
  const interrupted = render.status === "interrupted";
  return toHandle(
    {
      kind: "moments",
      id: project.projectId,
      rawStatus: render.status,
      percent: toPercent(render.percent),
      phase: render.status === "running" ? text(render.stage) : null,
      file: render.status === "done" ? render.file : null,
      error: interrupted ? MOMENT_RESTARTED : render.error,
    },
    ctx,
  );
}

const encoded = (value, field) => routeSegment(value, field);

export const SONG_NORMALISERS = {
  lyric_align: { route: (id) => `/api/lyric-video/${encoded(id)}`, normalise: fromLyricAlign },
  lyric_render: {
    route: (id, projectId) => `/api/lyric-video/${encoded(projectId, "projectId")}/render/${encoded(id)}`,
    normalise: fromLyricRender,
    needsProjectId: true,
    needsOutputDir: true,
  },
  moments: { route: (id) => `/api/moments/${encoded(id)}`, normalise: fromMoments },
};
