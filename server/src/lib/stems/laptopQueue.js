import fs from "fs";
import path from "path";
import { createStemJob, listStemJobs, updateStemJob, removeStemJob } from "./stemJobs.js";
import { resolveTrackFile } from "../ambient/stages.js";

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
// One laptop serves every account: a user may have a couple of songs
// waiting, and the queue as a whole is bounded.
export const MAX_WAITING_PER_USER = 2;
export const MAX_WAITING = 50;
const FORGET_MS = 24 * 3_600_000;
const MIN_KEY_LENGTH = 32;
// What the user sees when the laptop reports a failure; the detail (laptop
// paths, a Python traceback) goes to the server log, not to the account.
export const FAILED_ON_LAPTOP = "Vocal removal failed on the laptop. Try again, or try the Fast setting.";

// What a job needs to survive a restart (the AbortController is rebuilt).
const PERSISTED = [
  "jobId", "userId", "sourceRef", "sourcePreview", "resultPath", "sourceLabel", "sourceMood",
  "sourceLicence", "sourceCredit", "input", "quality", "dataDir", "outputDir", "attempts", "createdAt",
];

let storeFile = null;
let roots = null;
let lastSeen = 0;
// Round-robin between accounts: the turn each user last had.
let turn = 0;
const lastTurn = new Map();

/** `roots`: the folders a reloaded job's own folders must sit inside (DATA_DIR, OUTPUT_DIR). */
export function configureLaptopQueue({ file, roots: allowedRoots = null }) {
  storeFile = file;
  roots = allowedRoots ? allowedRoots.map((r) => path.resolve(r)) : null;
}

function inside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * The queue file is trusted only as far as it agrees with the server's own
 * rules: a row whose result would land outside its owner's media folder, or
 * whose source is not the owner's file (or the bundled track it names), is
 * dropped rather than served or written.
 */
function sane(row) {
  const { dataDir, outputDir, input, resultPath } = row;
  if (!dataDir || !outputDir) return false;
  if (roots && !(roots.some((r) => inside(dataDir, r) || path.resolve(dataDir) === r)
    && roots.some((r) => inside(outputDir, r) || path.resolve(outputDir) === r))) return false;
  if (!inside(resultPath, outputDir) || !/^instrumental-[\w-]+\.m4a$/.test(path.basename(resultPath))) return false;
  if (inside(input, outputDir) || inside(input, dataDir)) return true;
  let resolved = null;
  try { resolved = resolveTrackFile({ dataDir, outputDir }, row.sourceRef); } catch { /* unresolvable */ }
  return Boolean(resolved) && path.resolve(resolved) === path.resolve(input);
}

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
    if (!row?.jobId || !row?.userId || !row?.input || !sane(row)) continue;
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

/** Whether `userId` may queue another song for the laptop. */
export function queueRoomFor(userId) {
  const waiting = listStemJobs().filter((j) => isLaptop(j) && isWaiting(j) && !j.controller.signal.aborted);
  if (waiting.length >= MAX_WAITING) return false;
  return waiting.filter((j) => j.userId === userId).length < MAX_WAITING_PER_USER;
}

// Finished and failed laptop jobs are only there for the dialog to read.
function forgetOld(now) {
  for (const job of listStemJobs()) {
    if (isLaptop(job) && !isWaiting(job) && now - (job.finishedAt ?? now) > FORGET_MS) removeStemJob(job.jobId);
  }
}

function requeueExpired(now) {
  let changed = false;
  for (const job of listStemJobs()) {
    if (!isLaptop(job) || job.status !== "running" || job.leaseUntil >= now) continue;
    changed = true;
    if (job.attempts >= MAX_ATTEMPTS) {
      updateStemJob(job.jobId, { status: "error", error: "Your laptop stopped responding while removing vocals. Try again.", finishedAt: now });
    } else {
      updateStemJob(job.jobId, { status: "queued", percent: 0, leaseUntil: 0 });
    }
  }
  return changed;
}

/** The laptop asks for work: a heartbeat, then the oldest waiting job, leased. */
export function claimNext(now = Date.now()) {
  lastSeen = now;
  forgetOld(now);
  const changed = requeueExpired(now);
  // The user whose turn was longest ago goes first; within a user, oldest first.
  const next = listStemJobs()
    .filter((j) => isLaptop(j) && j.status === "queued" && !j.controller.signal.aborted)
    .sort((a, b) => (lastTurn.get(a.userId) ?? -1) - (lastTurn.get(b.userId) ?? -1) || a.createdAt - b.createdAt)[0];
  if (!next) {
    if (changed) persistLaptopQueue();
    return null;
  }
  turn += 1;
  lastTurn.set(next.userId, turn);
  updateStemJob(next.jobId, { status: "running", percent: 0, leaseUntil: now + LEASE_MS, attempts: next.attempts + 1 });
  persistLaptopQueue();
  return next;
}

/** A laptop job by id, whatever its state (the worker has no user to scope by). */
export function laptopJob(jobId) {
  const job = listStemJobs().find((j) => j.jobId === String(jobId));
  return job && isLaptop(job) ? job : null;
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

/**
 * The job failed. `detail` is logged for the operator; the user sees
 * `userMessage`, or a plain one — never the laptop's paths or traceback.
 */
export function failLaptopJob(job, detail, { userMessage = FAILED_ON_LAPTOP, now = Date.now() } = {}) {
  console.warn(`[stems] laptop job ${job.jobId} failed: ${String(detail || "").slice(0, 2000)}`);
  updateStemJob(job.jobId, { status: "error", error: userMessage, finishedAt: now });
  persistLaptopQueue();
}

export function cancelLaptopJob(job) {
  job.controller.abort();
  updateStemJob(job.jobId, { status: "error", error: "Cancelled.", finishedAt: Date.now() });
  persistLaptopQueue();
}

export function _resetLaptopQueue() {
  storeFile = null;
  roots = null;
  lastSeen = 0;
  turn = 0;
  lastTurn.clear();
}
