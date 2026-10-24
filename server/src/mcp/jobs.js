/**
 * One handle shape for every kind of background work, so an agent can start a
 * render, a story or an upload and then wait on it the same way. Each kind has
 * a normaliser that reads its status route's real payload.
 *
 * @typedef {"queued"|"running"|"done"|"failed"|"cancelled"} JobStatus
 * @typedef {{ kind: string, id: string, projectId?: string, status: JobStatus, percent: number|null,
 *   phase: string|null, output: { url: string, path: string|null }|null, error: string|null }} JobHandle
 */

import { toHandle, toPercent, text, routeSegment, jobAddressProblem } from "./jobHandle.js";
import { SONG_NORMALISERS } from "./songJobs.js";
import { sceneState } from "./sceneJob.js";

const POLL_MS = 3000;
const MIN_TIMEOUT_SEC = 1;
const MAX_TIMEOUT_SEC = 90;
const DEFAULT_TIMEOUT_SEC = 60;
const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** The client's `mediaUrl`, with the public origin passed in rather than read from the browser. */
export function outputUrl(pathOrUrl, publicBase) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  const base = String(publicBase || "").replace(/\/+$/, "");
  if (raw.startsWith("/outputs/")) return `${base}${raw}`;
  const name = raw.split(/[\\/]/).pop() || "";
  return name ? `${base}/outputs/${name}` : "";
}

/** `timeoutSec` as a whole number of seconds in 1..90; missing or non-numeric means 60. */
export function clampTimeoutSec(value) {
  const n = Math.floor(Number(value));
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return DEFAULT_TIMEOUT_SEC;
  return Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, n));
}

// Prefers result.videoUrl (a /outputs/... path kept intact); only a bare file falls back to its basename, which flattens subfolders.
function fromJobsRoute(payload, ctx) {
  const job = payload?.job || {};
  const result = job.result && typeof job.result === "object" ? job.result : {};
  const handle = toHandle(
    {
      kind: "job",
      id: job.id,
      rawStatus: job.status,
      percent: toPercent(job.progress),
      file: result.outFile || result.file,
      url: result.videoUrl,
      error: job.error,
    },
    ctx,
  );
  // The finished video's real length (#121): with a voice track it is the voice's, not the durationSec asked for.
  return Number.isFinite(result.durationSec) ? { ...handle, durationSec: result.durationSec } : handle;
}

function fromCaptioned(payload, ctx) {
  const p = payload || {};
  return toHandle(
    { kind: "captioned", id: p.jobId, rawStatus: p.status, percent: toPercent(p.percent), phase: text(p.phase), file: p.file, error: p.error },
    ctx,
  );
}

/**
 * The story render writes <outputDir>/story/<projectId>/video.mp4 and serves it
 * at /outputs/story/<projectId>/video.mp4. The basename alone would be the same
 * (wrong) URL for every project, so the project folder is kept in the path.
 */
function storyUrl(projectId, outputPath) {
  const name = text(outputPath)?.split(/[\\/]/).pop();
  const safeId = text(projectId);
  return name && safeId ? `/outputs/story/${safeId}/${name}` : null;
}

const AI_IN_FLIGHT = ["queued", "generating"];
// Steps the project itself is still running; AI clips in flight do not replace them as the phase.
const STORY_BUSY = new Set(["transcribing", "segmenting", "generating_images", "rendering", "narrating", "error"]);
// Nothing runs on these: a project made but not started, or a long-form outline not yet narrated.
const STORY_IDLE = new Set(["draft", "draft_script"]);
// GET /api/story/:id says `interrupted` when a restart or deploy killed the step the project shows (R50).
const STORY_RESTART_MESSAGE = "This stopped when the server restarted. Call story_cancel, then story_process or story_render again.";
// The stopped work was AI motion clips on a project whose own steps are over: cancel and order the clips again.
const STORY_ANIMATE_RESTART_MESSAGE = 'This stopped when the server restarted. Call story_cancel with what: "animate", then story_animate again.';

/** How many scenes' AI motion clips are queued, generating, done or failed; null when none was ever ordered. */
function animationCounts(scenes) {
  const counts = { queued: 0, generating: 0, done: 0, failed: 0 };
  let ordered = false;
  for (const scene of scenes) {
    const key = scene?.aiVideoStatus === "error" ? "failed" : scene?.aiVideoStatus;
    if (!Object.hasOwn(counts, key)) continue;
    counts[key] += 1;
    ordered = true;
  }
  return ordered ? counts : null;
}

/**
 * generating_images with no scene being made and nothing about to start: the images step is over
 * (segmenting leaves the project here, and so does a run the daily image quota stopped).
 */
function imagesIdle(status, scenes, payload) {
  return status === "generating_images" && !payload?.preparing && !scenes.some((s) => s?.imageStatus === "generating");
}

/** Why an idle images step left scenes without a picture (the daily image quota, a provider refusal), or null. */
function imagesStoppedError(scenes) {
  const failed = scenes.filter((s) => s?.imageStatus === "error");
  if (failed.length === 0) return null;
  return `${failed.length} of ${scenes.length} scenes have no picture: ${text(failed[0].imageError) || "image generation failed"}`;
}

/** What an idle images step's scenes say is next. */
function scenesPhase(scenes) {
  if (scenes.length === 0) return "no_scenes";
  return scenes.every((s) => s?.imageStatus === "done") ? "ready_to_render" : "needs_images";
}

/** The status, phase and error a story handle shows, from the project's own status, its scenes and their AI clips. */
function storyState(project, payload) {
  const status = String(project.status || "");
  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  const animation = animationCounts(scenes);
  const idleImages = imagesIdle(status, scenes, payload);
  const imagesError = idleImages ? imagesStoppedError(scenes) : null;
  if (imagesError) return { rawStatus: "failed", phase: status, error: imagesError, animation };
  const stepRunning = STORY_BUSY.has(status) && !idleImages;
  const animating = animation && AI_IN_FLIGHT.some((key) => animation[key] > 0) && !stepRunning;
  if (payload?.interrupted) {
    if (animating) return { rawStatus: "failed", phase: "animating", error: STORY_ANIMATE_RESTART_MESSAGE, animation };
    return { rawStatus: "failed", phase: status, error: STORY_RESTART_MESSAGE, animation };
  }
  if (animating) return { rawStatus: "running", phase: "animating", animation, keepOutput: true };
  if (idleImages) return { rawStatus: "done", phase: scenesPhase(scenes), animation };
  if (status === "generating_images" && payload?.preparing) return { rawStatus: "running", phase: "preparing", animation };
  // The pictures are all in: the step an agent waited for is over, and no new video exists yet.
  if (status === "ready_to_render") return { rawStatus: "done", phase: status, animation };
  if (STORY_IDLE.has(status)) return { rawStatus: "done", phase: status, animation };
  const phase = status === "rendering" ? text(project.render?.phase) || "rendering" : null;
  return { rawStatus: status, phase, error: project.error, animation, keepOutput: true };
}

function fromStory(payload, ctx) {
  const project = payload?.project || {};
  const render = project.render || {};
  const state = storyState(project, payload);
  const handle = toHandle(
    {
      kind: "story",
      id: project.projectId,
      rawStatus: state.rawStatus,
      percent: state.keepOutput ? toPercent(render.percent) : null,
      phase: state.phase,
      file: state.keepOutput ? render.outputPath : null,
      url: state.keepOutput ? storyUrl(project.projectId, render.outputPath) : null,
      error: state.error ?? null,
    },
    ctx,
  );
  return state.animation ? { ...handle, animation: state.animation } : handle;
}

// ---- ambient -----------------------------------------------------------------

const AMBIENT_ENCODING = new Set(["assembling", "rendering"]);
const AMBIENT_RESTART_STEP = {
  voicing: "its verses were being voiced. Call ambient_cancel, then ambient_step voice (verses already voiced are kept)",
  generating_images: "its pictures were being made. Call ambient_cancel, then ambient_step images (pictures already made are kept)",
  assembling: "it was rendering. Call ambient_cancel, then ambient_render to start the render again from the beginning",
  rendering: "it was rendering. Call ambient_cancel, then ambient_render to start the render again from the beginning",
};

/** The share of pictures an images run has finished (made or failed), as a percent; null without movements. */
function picturesPercent(movements) {
  if (movements.length === 0) return null;
  const settled = movements.filter((m) => m?.imageStatus === "done" || m?.imageStatus === "error").length;
  return Math.round((settled / movements.length) * 100);
}

/** "2 of 3 verses could not be voiced: <first reason>", or null when nothing failed. */
function failedShare(items, isFailed, noun, reasonOf) {
  const failed = items.filter(isFailed);
  if (failed.length === 0) return null;
  return `${failed.length} of ${items.length} ${noun}: ${text(reasonOf(failed[0])) || "unknown error"}`;
}

/** A draft whose last step left verses unvoiced or pictures missing: the step failed, and says why. */
function ambientDraftError(project, drops, movements) {
  const voiced = project.words === "none" ? null
    : failedShare(drops, (d) => d?.status === "error", "verses could not be voiced", (d) => d.error);
  return voiced || failedShare(movements, (m) => m?.imageStatus === "error", "pictures could not be made", (m) => m.imageError);
}

/** The status, percent, phase and error an ambient handle shows. */
function ambientState(payload, project) {
  const status = String(project.status || "");
  const render = project.render || {};
  const movements = Array.isArray(project.movements) ? project.movements : [];
  const drops = Array.isArray(project.drops) ? project.drops : [];
  const encoding = AMBIENT_ENCODING.has(status);
  const percent = encoding ? toPercent(render.percent) : status === "generating_images" ? picturesPercent(movements) : null;
  const phase = encoding ? text(render.phase) || status : status || null;
  if (payload?.interrupted && AMBIENT_RESTART_STEP[status]) {
    return { rawStatus: "failed", percent, phase, error: `The server restarted while ${AMBIENT_RESTART_STEP[status]}.` };
  }
  if (status === "draft") {
    const error = ambientDraftError(project, drops, movements);
    return { rawStatus: error ? "failed" : "done", percent: null, phase, error };
  }
  if (status === "ready_to_render") return { rawStatus: "done", percent: null, phase, error: null };
  if (status === "done") return { rawStatus: "done", percent, phase: null, error: null, file: render.outputPath };
  return { rawStatus: status, percent, phase: status === "error" ? null : phase, error: project.error };
}

/** The ambient render writes <outputDir>/ambient/<projectId>/video.mp4, served at the same path under /outputs. */
function ambientUrl(projectId, outputPath) {
  const name = text(outputPath)?.split(/[\\/]/).pop();
  const safeId = text(projectId);
  return name && safeId ? `/outputs/ambient/${safeId}/${name}` : null;
}

function fromAmbient(payload, ctx) {
  const project = payload?.project || {};
  const state = ambientState(payload, project);
  return toHandle(
    {
      kind: "ambient",
      id: project.projectId,
      rawStatus: state.rawStatus,
      percent: state.percent,
      phase: state.phase,
      file: state.file ?? null,
      url: state.file ? ambientUrl(project.projectId, state.file) : null,
      error: state.error ?? null,
    },
    ctx,
  );
}

// ---- scene scripts and long-form ---------------------------------------------

function fromScene(payload, ctx) {
  const project = payload?.project || {};
  const { rawStatus, percent, phase, error, file, stages, blockers } = sceneState(project);
  const handle = toHandle({ kind: "scene", id: project.id, rawStatus, percent: toPercent(percent), phase, file, url: file, error }, ctx);
  return { ...handle, stages, ...(blockers ? { blockers } : {}) };
}

const NARRATION_RESTARTED =
  "The server restarted while the script was being narrated. Call longform_narrate again (chunks already narrated are reused).";

/** A long-form project is a story project with a narration stage before the story pipeline. */
function fromLongform(payload, ctx) {
  const project = payload?.project || {};
  const status = String(project.status || "");
  const progress = project.longform?.progress || {};
  if (status === "narrating") {
    const total = Number(progress.total) || 0;
    const percent = total > 0 ? Math.round(((Number(progress.done) || 0) / total) * 100) : null;
    const stopped = progress.alive === false;
    return toHandle({
      kind: "longform", id: project.projectId, rawStatus: stopped ? "failed" : "running", percent: toPercent(percent),
      phase: "narrating", error: stopped ? NARRATION_RESTARTED : null,
    }, ctx);
  }
  if (status === "draft_script") return toHandle({ kind: "longform", id: project.projectId, rawStatus: "done", phase: status }, ctx);
  return { ...fromStory(payload, ctx), kind: "longform" };
}

function fromTimeline(payload, ctx) {
  const p = payload || {};
  return toHandle(
    { kind: "timeline", id: p.jobId, rawStatus: p.status, percent: toPercent(p.progress), phase: text(p.phase), file: p.file, url: p.publicUrl, error: p.error },
    ctx,
  );
}

function fromInstrumental(payload, ctx) {
  const job = payload?.job || {};
  return toHandle(
    { kind: "instrumental", id: job.jobId, rawStatus: job.status, percent: toPercent(job.percent), file: job.resultFile, error: job.error },
    ctx,
  );
}

function fromPublish(payload, ctx) {
  const job = payload?.job || {};
  return toHandle(
    { kind: "publish", id: job.jobId, rawStatus: job.status, url: job.result?.videoUrl, error: job.error },
    ctx,
  );
}

const routeFor = (prefix) => (id) => `${prefix}${routeSegment(id)}`;

/** @type {Record<string, { route: (id: string, projectId?: string) => string, normalise: (payload: object, ctx: { outputUrl: (p: string) => string, outputDir?: string }) => JobHandle, needsProjectId?: boolean, needsOutputDir?: boolean }>} */
export const NORMALISERS = {
  job: { route: routeFor("/api/jobs/"), normalise: fromJobsRoute },
  captioned: { route: routeFor("/api/render/captioned-video-status/"), normalise: fromCaptioned },
  story: { route: routeFor("/api/story/"), normalise: fromStory },
  ambient: { route: routeFor("/api/ambient/"), normalise: fromAmbient },
  ...SONG_NORMALISERS,
  scene: { route: routeFor("/api/scene-script/"), normalise: fromScene },
  longform: { route: routeFor("/api/story/"), normalise: fromLongform },
  timeline: { route: routeFor("/api/timeline/render/"), normalise: fromTimeline },
  instrumental: { route: routeFor("/api/music/instrumental/"), normalise: fromInstrumental },
  publish: { route: routeFor("/api/social/youtube/publish/"), normalise: fromPublish },
};

export const JOB_KINDS = Object.keys(NORMALISERS);

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the kind's status route every 3 s until the job is done, failed or
 * cancelled, or the timeout passes (then the latest handle, still running, is
 * returned so the agent can wait again). API errors propagate.
 *
 * @param {{ call: Function }} api
 * @param {{ kind: string, id: string, projectId?: string, timeoutSec?: number,
 *   outputUrl?: (p: string) => string, outputDir?: string, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
 * @returns {Promise<JobHandle>}
 */
export async function waitForJob(api, options) {
  const { kind, id, projectId, timeoutSec, outputUrl: toUrl = (p) => outputUrl(p, ""), outputDir, sleep = realSleep, now = Date.now } = options;
  const entry = Object.hasOwn(NORMALISERS, kind) ? NORMALISERS[kind] : null;
  if (!entry) throw Object.assign(new Error(`Unknown job kind "${kind}". Use one of: ${JOB_KINDS.join(", ")}.`), { code: "BAD_KIND" });
  if (entry.needsProjectId && !projectId) throw Object.assign(new Error(`A ${kind} job needs its projectId.`), { code: "NEEDS_PROJECT_ID" });
  const badId = jobAddressProblem({ id, projectId });
  if (badId) throw Object.assign(new Error(badId), { code: "BAD_INPUT" });
  const deadline = now() + clampTimeoutSec(timeoutSec) * 1000;
  for (;;) {
    const payload = await api.call("GET", entry.route(id, projectId));
    const handle = { ...entry.normalise(payload, { outputUrl: toUrl, outputDir }), id, ...(projectId ? { projectId } : {}) };
    const remaining = deadline - now();
    if (TERMINAL.has(handle.status) || remaining <= 0) return handle;
    await sleep(Math.min(POLL_MS, remaining));
  }
}
