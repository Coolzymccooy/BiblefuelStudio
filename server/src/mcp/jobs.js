/**
 * One handle shape for every kind of background work, so an agent can start a
 * render, a story or an upload and then wait on it the same way. Each kind has
 * a normaliser that reads its status route's real payload.
 *
 * @typedef {"queued"|"running"|"done"|"failed"|"cancelled"} JobStatus
 * @typedef {{ kind: string, id: string, projectId?: string, status: JobStatus, percent: number|null,
 *   phase: string|null, output: { url: string, path: string|null }|null, error: string|null }} JobHandle
 */

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

const STATUS_WORDS = {
  queued: "queued",
  running: "running",
  done: "done",
  complete: "done",
  completed: "done",
  failed: "failed",
  error: "failed",
  interrupted: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const CANCEL_MESSAGE = /^(render |job )?cancell?ed\.?$/i;

/** A percent from a number, or from `{ percent }` / `{ pct }`; anything else is null. */
function toPercent(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") return toPercent(value.percent ?? value.pct);
  return null;
}

function text(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

/**
 * Builds a handle from one route's already-picked fields. An unrecognised
 * status is still running work, with the raw word kept as the phase.
 */
function toHandle(fields, { outputUrl: toUrl }) {
  const { kind, id, rawStatus, percent = null, phase = null, file = null, url = null, error = null } = fields;
  const known = STATUS_WORDS[String(rawStatus || "").toLowerCase()];
  let status = known || "running";
  const errorText = text(error);
  if (status === "failed" && errorText && CANCEL_MESSAGE.test(errorText)) status = "cancelled";
  const rawPhase = known ? phase : phase || text(rawStatus);
  const where = text(url) || text(file);
  return {
    kind,
    id: String(id ?? ""),
    status,
    percent: status === "done" ? (percent ?? 100) : percent,
    phase: rawPhase || null,
    output: where ? { url: toUrl(where), path: text(file) } : null,
    error: errorText,
  };
}

function fromJobsRoute(payload, ctx) {
  const job = payload?.job || {};
  const result = job.result && typeof job.result === "object" ? job.result : {};
  return toHandle(
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
}

function fromCaptioned(payload, ctx) {
  const p = payload || {};
  return toHandle(
    { kind: "captioned", id: p.jobId, rawStatus: p.status, percent: toPercent(p.percent), phase: text(p.phase), file: p.file, error: p.error },
    ctx,
  );
}

function fromStory(payload, ctx) {
  const project = payload?.project || {};
  const render = project.render || {};
  const status = String(project.status || "");
  return toHandle(
    {
      kind: "story",
      id: project.projectId,
      rawStatus: status,
      percent: toPercent(render.percent),
      phase: status === "rendering" ? text(render.phase) || "rendering" : null,
      file: render.outputPath,
      error: project.error,
    },
    ctx,
  );
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

const routeFor = (prefix) => (id) => `${prefix}${encodeURIComponent(String(id))}`;

/** @type {Record<string, { route: (id: string, projectId?: string) => string, normalise: (payload: object, ctx: { outputUrl: (p: string) => string }) => JobHandle }>} */
export const NORMALISERS = {
  job: { route: routeFor("/api/jobs/"), normalise: fromJobsRoute },
  captioned: { route: routeFor("/api/render/captioned-video-status/"), normalise: fromCaptioned },
  story: { route: routeFor("/api/story/"), normalise: fromStory },
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
 *   outputUrl?: (p: string) => string, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
 * @returns {Promise<JobHandle>}
 */
export async function waitForJob(api, options) {
  const { kind, id, projectId, timeoutSec, outputUrl: toUrl = (p) => outputUrl(p, ""), sleep = realSleep, now = Date.now } = options;
  const entry = Object.hasOwn(NORMALISERS, kind) ? NORMALISERS[kind] : null;
  if (!entry) throw Object.assign(new Error(`Unknown job kind "${kind}". Use one of: ${JOB_KINDS.join(", ")}.`), { code: "BAD_KIND" });
  const deadline = now() + clampTimeoutSec(timeoutSec) * 1000;
  for (;;) {
    const payload = await api.call("GET", entry.route(id, projectId));
    const handle = { ...entry.normalise(payload, { outputUrl: toUrl }), id, ...(projectId ? { projectId } : {}) };
    const remaining = deadline - now();
    if (TERMINAL.has(handle.status) || remaining <= 0) return handle;
    await sleep(Math.min(POLL_MS, remaining));
  }
}
