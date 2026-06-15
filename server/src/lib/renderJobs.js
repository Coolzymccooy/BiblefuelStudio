import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";

// In-memory job registry for async render endpoints. The /captioned-video
// route hands ffmpeg a long-running spawn (a 1-min sermon at 4K takes 40s+)
// and returns the jobId immediately; the SSE progress endpoint reads from
// here.
//
// The in-memory map below is the live source of truth for progress. A thin
// on-disk mirror (persistJob/readPersistedJob/reconcilePersistedJobs, defined
// at the bottom of this file) survives restarts so an interrupted render can be
// detected and resumed; the in-memory map itself is still cleared on restart.
//
// Jobs auto-expire after JOB_TTL_MS so a long-lived server doesn't accumulate
// references to ancient ffmpeg runs. Done/error jobs stay long enough that a
// client that opened the SSE connection seconds after completion still sees
// the terminal event.
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

/** @typedef {'queued' | 'running' | 'done' | 'error'} JobStatus */

/**
 * @typedef {Object} JobRecord
 * @property {string} jobId
 * @property {string} userId            owner — only this user can poll/stream
 * @property {JobStatus} status
 * @property {'preparing'|'encoding'} [phase]  sub-state while status==='running'
 * @property {number} percent           0..100; running-mode progress estimate
 * @property {number} durationSec       total duration the render targets; used to compute percent
 * @property {string} [file]            output path on success
 * @property {string} [error]           error message on failure
 * @property {number} createdAt         ms since epoch
 * @property {number} updatedAt         ms since epoch — bumped on every progress tick
 */

/** @type {Map<string, JobRecord>} */
const jobs = new Map();

/**
 * Live ffmpeg child-process handles for running renders, keyed by jobId. Kept
 * separate from the (serializable) job records so cancellation can SIGKILL the
 * real process. Never persisted.
 * @type {Map<string, import('child_process').ChildProcess>}
 */
const procs = new Map();

export function createJob(userId, { durationSec }) {
  const now = Date.now();
  const jobId = uuid();
  /** @type {JobRecord} */
  const record = {
    jobId,
    userId,
    status: "queued",
    percent: 0,
    durationSec: Number(durationSec) || 0,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(jobId, record);
  return record;
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

export function updateJob(jobId, patch) {
  const record = jobs.get(jobId);
  if (!record) return null;
  Object.assign(record, patch, { updatedAt: Date.now() });
  return record;
}

export function markRunning(jobId) {
  // phase 'preparing' covers everything before ffmpeg emits its first `time=`
  // (opening inputs, downloading remote backgrounds, building the filtergraph).
  // The client shows an indeterminate "Preparing…" state for this so the bar
  // doesn't sit at a stale 0% with a bogus ETA.
  return updateJob(jobId, { status: "running", percent: 0, phase: "preparing" });
}

export function markProgress(jobId, percent) {
  const record = jobs.get(jobId);
  if (!record || record.status === "done" || record.status === "error") return record;
  const clamped = Math.min(99, Math.max(0, Number(percent) || 0));
  // Monotonic: ffmpeg's `time=` parser can briefly stutter on the first few
  // frames; never let percent regress so the UI bar doesn't twitch backwards.
  if (clamped < record.percent) return record;
  // First real progress means encoding has started — flip the phase so the UI
  // switches from "Preparing…" to a determinate percentage bar.
  return updateJob(jobId, { status: "running", percent: clamped, phase: "encoding" });
}

export function markDone(jobId, file) {
  procs.delete(jobId);
  const record = jobs.get(jobId);
  // A cancelled job stays cancelled even if ffmpeg happened to finish first.
  if (record?.cancelled) return record;
  return updateJob(jobId, { status: "done", percent: 100, file });
}

export function markError(jobId, error) {
  procs.delete(jobId);
  const record = jobs.get(jobId);
  // Keep the "Render cancelled" message rather than the SIGKILL'd ffmpeg's
  // non-zero-exit error that arrives right after a cancel.
  if (record?.cancelled) return record;
  return updateJob(jobId, { status: "error", error: String(error || "render failed") });
}

/** Register the live ffmpeg process for a job so it can be cancelled. */
export function attachProc(jobId, proc) {
  if (proc) procs.set(jobId, proc);
}

/**
 * Cancel a running render: SIGKILL its ffmpeg and mark the job cancelled.
 * Returns { ok } or { ok:false, reason } so the route can map to an HTTP code.
 */
export function cancelJob(jobId, userId) {
  const record = jobs.get(jobId);
  if (!record) return { ok: false, reason: "not_found" };
  if (userId != null && record.userId !== userId) return { ok: false, reason: "forbidden" };
  if (record.status === "done" || record.status === "error") return { ok: false, reason: "terminal" };
  const proc = procs.get(jobId);
  if (proc) {
    try { proc.kill("SIGKILL"); } catch {}
    procs.delete(jobId);
  }
  updateJob(jobId, { status: "error", error: "Render cancelled", cancelled: true });
  return { ok: true };
}

// Sweep stale records. Called from getJob's caller paths so we don't need a
// timer; volume on this endpoint is low so an opportunistic GC is plenty.
export function gcJobs(now = Date.now()) {
  for (const [id, record] of jobs) {
    if (now - record.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// Test-only: clear all jobs between cases. Avoids cross-test leakage.
export function _resetJobs() {
  jobs.clear();
  procs.clear();
}

function jobsPersistDir(baseDir) {
  return path.join(baseDir, "render-jobs");
}

/**
 * Persist a thin job record (status transitions only, NOT every progress tick).
 * @param {string} baseDir  caller's req.ctx.dataDir
 * @param {object} job      a JobRecord plus optional { projectId, outputPath }
 */
export function persistJob(baseDir, job) {
  const dir = jobsPersistDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const thin = {
    jobId: job.jobId,
    userId: job.userId,
    projectId: job.projectId || null,
    status: job.status,
    outputPath: job.outputPath || job.file || null,
    updatedAt: Date.now(),
  };
  const file = path.join(dir, `${job.jobId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(thin, null, 2));
  fs.renameSync(tmp, file);
  return thin;
}

export function readPersistedJob(baseDir, jobId) {
  const file = path.join(jobsPersistDir(baseDir), `${String(jobId).replace(/[^a-z0-9-]/gi, "")}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * On boot, any persisted job still marked running/queued had its ffmpeg child
 * killed by the restart. Flip those to 'interrupted' so the UI can offer Resume.
 * @returns {Array<{jobId:string, projectId:string|null}>} the changed records
 */
export function reconcilePersistedJobs(baseDir) {
  const dir = jobsPersistDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  const changed = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(dir, f);
    try {
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      if (rec.status === "running" || rec.status === "queued") {
        rec.status = "interrupted";
        rec.updatedAt = Date.now();
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
        fs.renameSync(tmp, file);
        changed.push({ jobId: rec.jobId, projectId: rec.projectId || null });
      }
    } catch {
      // skip corrupt record
    }
  }
  return changed;
}
