import { v4 as uuid } from "uuid";

// In-memory job registry for async render endpoints. The /captioned-video
// route hands ffmpeg a long-running spawn (a 1-min sermon at 4K takes 40s+)
// and returns the jobId immediately; the SSE progress endpoint reads from
// here. Persisting jobs across server restarts is intentionally out of scope —
// a restart kills the ffmpeg child anyway, so the job is dead either way.
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
 * @property {number} percent           0..100; running-mode progress estimate
 * @property {number} durationSec       total duration the render targets; used to compute percent
 * @property {string} [file]            output path on success
 * @property {string} [error]           error message on failure
 * @property {number} createdAt         ms since epoch
 * @property {number} updatedAt         ms since epoch — bumped on every progress tick
 */

/** @type {Map<string, JobRecord>} */
const jobs = new Map();

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
  return updateJob(jobId, { status: "running", percent: 0 });
}

export function markProgress(jobId, percent) {
  const record = jobs.get(jobId);
  if (!record || record.status === "done" || record.status === "error") return record;
  const clamped = Math.min(99, Math.max(0, Number(percent) || 0));
  // Monotonic: ffmpeg's `time=` parser can briefly stutter on the first few
  // frames; never let percent regress so the UI bar doesn't twitch backwards.
  if (clamped < record.percent) return record;
  return updateJob(jobId, { status: "running", percent: clamped });
}

export function markDone(jobId, file) {
  return updateJob(jobId, { status: "done", percent: 100, file });
}

export function markError(jobId, error) {
  return updateJob(jobId, { status: "error", error: String(error || "render failed") });
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
}
