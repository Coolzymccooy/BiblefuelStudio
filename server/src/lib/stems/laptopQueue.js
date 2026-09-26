import fs from "fs";
import path from "path";
import { createStemJob, listStemJobs, updateStemJob } from "./stemJobs.js";

/**
 * Vocal removal the laptop does for the live site. The server has no
 * separator of its own, so a request waits here until the operator's laptop
 * (scripts/stems-worker.mjs) claims it, separates it, and uploads the result.
 *
 * Waiting jobs are written to disk: the laptop may be off for hours, and a
 * deploy in the meantime must not forget them. A claim is a lease — a laptop
 * that sleeps mid-job lets it lapse and the job goes back in the queue.
 */

export const LEASE_MS = 3 * 60_000;
export const ONLINE_MS = 45_000;
export const MAX_ATTEMPTS = 3;
const MIN_KEY_LENGTH = 32;
const ERROR_MAX = 300;

// What a job needs to survive a restart (the AbortController is rebuilt).
const PERSISTED = [
  "jobId", "userId", "sourceRef", "sourcePreview", "resultPath", "sourceLabel", "sourceMood",
  "sourceLicence", "sourceCredit", "input", "quality", "dataDir", "outputDir", "attempts", "createdAt",
];

let storeFile = null;
let lastSeen = 0;

export function configureLaptopQueue({ file }) { storeFile = file; }

/** On when the server holds a worker key long enough to be a real secret. */
export function laptopQueueEnabled(env = process.env) {
  return String(env.STEMS_WORKER_TOKEN || "").trim().length >= MIN_KEY_LENGTH;
}

export function laptopOnline(now = Date.now()) {
  return lastSeen > 0 && now - lastSeen <= ONLINE_MS;
}

const isLaptop = (j) => j.where === "laptop";
const isWaiting = (j) => j.status === "queued" || j.status === "running";

export function persistLaptopQueue() {
  if (!storeFile) return;
  const rows = listStemJobs()
    .filter((j) => isLaptop(j) && isWaiting(j) && !j.controller.signal.aborted)
    .map((j) => Object.fromEntries(PERSISTED.map((k) => [k, j[k] ?? null])));
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    const tmp = `${storeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, storeFile);
  } catch (e) {
    console.warn(`[stems] could not save the laptop queue: ${e?.message || e}`);
  }
}

/** Reload after a restart; a job that was mid-run starts again from the queue. */
export function loadLaptopQueue() {
  if (!storeFile) return;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(storeFile, "utf8")); } catch { return; }
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row?.jobId || !row?.userId || !row?.input) continue;
    const job = createStemJob(row);
    updateStemJob(job.jobId, {
      where: "laptop", input: row.input, quality: row.quality === "fast" ? "fast" : "best",
      dataDir: row.dataDir, outputDir: row.outputDir, attempts: Number(row.attempts) || 0,
      createdAt: Number(row.createdAt) || job.createdAt,
    });
  }
}

export function enqueueLaptopJob(fields) {
  const job = createStemJob(fields);
  updateStemJob(job.jobId, {
    where: "laptop", input: fields.input, quality: fields.quality, dataDir: fields.dataDir,
    outputDir: fields.outputDir, attempts: 0,
  });
  persistLaptopQueue();
  return job;
}

function requeueExpired(now) {
  let changed = false;
  for (const job of listStemJobs()) {
    if (!isLaptop(job) || job.status !== "running" || job.leaseUntil >= now) continue;
    changed = true;
    if (job.attempts >= MAX_ATTEMPTS) {
      updateStemJob(job.jobId, { status: "error", error: "Your laptop stopped responding while removing vocals. Try again." });
    } else {
      updateStemJob(job.jobId, { status: "queued", percent: 0, leaseUntil: 0 });
    }
  }
  return changed;
}

/** The laptop asks for work: a heartbeat, then the oldest waiting job, leased. */
export function claimNext(now = Date.now()) {
  lastSeen = now;
  const changed = requeueExpired(now);
  const next = listStemJobs()
    .filter((j) => isLaptop(j) && j.status === "queued" && !j.controller.signal.aborted)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!next) {
    if (changed) persistLaptopQueue();
    return null;
  }
  updateStemJob(next.jobId, { status: "running", percent: 0, leaseUntil: now + LEASE_MS, attempts: next.attempts + 1 });
  persistLaptopQueue();
  return next;
}

/** A job the laptop holds right now, or null (not claimed, lapsed, or cancelled). */
export function heldJob(jobId, now = Date.now()) {
  const job = listStemJobs().find((j) => j.jobId === String(jobId));
  if (!job || !isLaptop(job) || job.status !== "running") return null;
  if (job.controller.signal.aborted || job.leaseUntil < now) return null;
  return job;
}

export function reportProgress(job, percent, now = Date.now()) {
  lastSeen = now;
  if (job.controller.signal.aborted) return { cancelled: true };
  const p = Math.max(0, Math.min(99, Math.round(Number(percent) || 0)));
  updateStemJob(job.jobId, { percent: p, leaseUntil: now + LEASE_MS });
  return { cancelled: false };
}

export function failLaptopJob(job, error) {
  const message = String(error || "Vocal removal failed on your laptop.").slice(0, ERROR_MAX);
  updateStemJob(job.jobId, { status: "error", error: message });
  persistLaptopQueue();
}

export function cancelLaptopJob(job) {
  job.controller.abort();
  updateStemJob(job.jobId, { status: "error", error: "Cancelled." });
  persistLaptopQueue();
}

export function _resetLaptopQueue() {
  storeFile = null;
  lastSeen = 0;
}
