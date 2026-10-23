import fs from "fs";
import path from "path";
import crypto from "crypto";
import { clampSeedanceDuration, seedanceRatio } from "../videoGen/providers/seedance.js";
import { estimateTokens, usdForTokens, reserveSpend, settleSpend, releaseSpend, isReserved, wouldExceedCap } from "../videoGen/spend.js";
import { SHOT_MODEL, SHOT_RESOLUTION, defaultDeps as seedanceDeps, downloadClip, makePoster } from "../sceneScript/shotStage.js";
import { addClip, getClip } from "./store.js";

/**
 * "Re-roll from this prompt": order a new clip from a library clip's prompt
 * (or an edited one), paid, and keep it beside the original. Jobs are saved
 * per library so a restart collects a clip already ordered instead of paying
 * for it again, as Scene script shots do.
 */

export const REROLL_STORE = "visual-library-rerolls.json";
const KEEP_JOBS = 50;
const MAX_IN_FLIGHT = 3;
const DEFAULT_SECONDS = 8;
const MAX_PROMPT = 1500;
const IN_FLIGHT = new Set(["queued", "generating"]);
const NOT_CHARGED = new Set(["FAILED", "NOT_FOUND", "REFUSED"]);
const DECLINED = "BytePlus declined this prompt. Reword it and try again.";
const PAID_NOT_KEPT = "The clip was made and paid for but could not be saved. Fetch it again at no cost within a day.";
/** BytePlus keeps a finished clip's URL for 24 h, so a paid clip can be fetched again until then. */
const REFETCH_MS = 23 * 60 * 60 * 1000;

export const rerollLedgerKey = (jobId) => `vl:${jobId}`;

// Re-rolls being worked on in this process, per library.
const running = new Map();
export const isRerolling = (dataDir) => (running.get(dataDir) || 0) > 0;
const track = (dataDir, n) => running.set(dataDir, Math.max(0, (running.get(dataDir) || 0) + n));

export function listRerolls(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, REROLL_STORE), "utf8"));
    return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

/** A job that is running, or paid for and still fetchable, is never dropped from history. */
export const isRecoverable = (job) => IN_FLIGHT.has(job.status) || canRefetch(job);

/** Every recoverable job, plus the newest `limit` others, in their original order. */
export function recentRerolls(jobs, limit) {
  let others = 0;
  return jobs.filter((j) => isRecoverable(j) || (others += 1) <= limit);
}

function writeJobs(dataDir, jobs) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, REROLL_STORE);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ jobs: recentRerolls(jobs, KEEP_JOBS) }, null, 2));
  fs.renameSync(tmp, file);
}

/** Change one job; fn returns the new job, or null to leave it. Returns the job as written. */
function patchJob(dataDir, id, fn) {
  let changed = null;
  const jobs = listRerolls(dataDir).map((j) => {
    if (j.id !== id) return j;
    changed = fn(j);
    return changed || j;
  });
  if (changed) writeJobs(dataDir, jobs);
  return changed;
}

const findJob = (dataDir, id) => listRerolls(dataDir).find((j) => j.id === id) || null;
const failJob = (dataDir, id, message) => patchJob(dataDir, id, (j) => (IN_FLIGHT.has(j.status) ? { ...j, status: "error", error: message } : null));
const estimatedTokens = (job) => estimateTokens({ durationSec: job.seconds, ratio: seedanceRatio(job.aspect), resolution: SHOT_RESOLUTION });

/** A paid clip whose file was not kept can be fetched again, free, while BytePlus still has it. */
export const canRefetch = (job, now = Date.now()) => job?.status === "error" && Boolean(job.videoUrl)
  && Boolean(job.taskId) && job.chargedTaskId === job.taskId && now - (Number(job.startedAt) || 0) < REFETCH_MS;

/** What a re-roll of this clip costs: a clip as long as the original, at the Scene script model and size. */
export function rerollPrice(clip) {
  const seconds = clampSeedanceDuration(Number(clip?.durationSec) || DEFAULT_SECONDS);
  const tokens = estimateTokens({ durationSec: seconds, ratio: seedanceRatio(clip?.aspect), resolution: SHOT_RESOLUTION });
  return { seconds, usd: usdForTokens({ model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens }) };
}

/**
 * Count a task's cost once. Settling removes the reservation in the same
 * ledger write, and the job is marked charged for this task, so collecting
 * again never charges twice. videoUrl is kept so a paid clip can be fetched again.
 */
function chargeJob(ctx, job, taskId, tokens, ledgerDir, videoUrl = null) {
  const key = rerollLedgerKey(job.id);
  const spend = { model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens };
  const usd = isReserved(ledgerDir, key) ? settleSpend(ledgerDir, key, spend) : usdForTokens(spend);
  const written = patchJob(ctx.dataDir, job.id, (j) => (j.chargedTaskId === taskId
    ? null
    : { ...j, taskId, chargedTaskId: taskId, costUsd: usd, tokens, videoUrl: videoUrl || j.videoUrl || null }));
  return written ? usd : Number(job.costUsd) || usd;
}

/** Download a paid clip and add it to the library. Poster and length are best effort. */
async function keepPaidClip(ctx, jobId, { deps }) {
  const job = findJob(ctx.dataDir, jobId);
  if (!job?.videoUrl) return;
  const tmpDir = path.join(ctx.outputDir, "visual-library", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `${crypto.randomUUID()}.mp4`);
  const downloadError = await downloadClip(deps, job.videoUrl, file);
  if (downloadError) {
    console.warn(`[visual-library] re-roll ${job.taskId} paid but not downloaded: ${downloadError}`);
    failJob(ctx.dataDir, jobId, PAID_NOT_KEPT);
    return;
  }
  const poster = await makePoster(deps, file, `${file}.jpg`).catch(() => null);
  const durationSec = Number(await Promise.resolve(deps.probe(file)).catch(() => null)) || job.seconds;
  const clip = addClip(ctx, {
    file, posterFile: poster, prompt: job.prompt, lead: job.lead, model: SHOT_MODEL, resolution: SHOT_RESOLUTION,
    aspect: job.aspect, durationSec, tokens: job.tokens, costUsd: job.costUsd, taskId: job.taskId,
    source: { kind: "reroll", fromClipId: job.fromClipId }, tags: job.tags,
  });
  patchJob(ctx.dataDir, jobId, (j) => ({ ...j, status: "done", clipId: clip.id, error: null }));
}

async function collect(ctx, jobId, taskId, { ledgerDir, deps }) {
  const done = await deps.wait(taskId);
  const job = findJob(ctx.dataDir, jobId);
  if (!job) {
    // The job record can't be read. The task was ordered, so count it unless
    // BytePlus says it was not billed; either way nothing stays reserved all month.
    const key = rerollLedgerKey(jobId);
    if (NOT_CHARGED.has(done.code) || !isReserved(ledgerDir, key)) releaseSpend(ledgerDir, key);
    else settleSpend(ledgerDir, key, { model: SHOT_MODEL, resolution: SHOT_RESOLUTION, tokens: Number(done.tokens) > 0 ? done.tokens : estimatedTokens({ seconds: DEFAULT_SECONDS }) });
    throw new Error("the re-roll's job record could not be read");
  }
  if (!done.ok) {
    if (NOT_CHARGED.has(done.code)) releaseSpend(ledgerDir, rerollLedgerKey(jobId));
    // Unknown outcome (timeout, auth): BytePlus may still bill it, so the estimate is counted.
    else chargeJob(ctx, job, taskId, estimatedTokens(job), ledgerDir);
    failJob(ctx.dataDir, jobId, /sensitive|copyright|declined/i.test(done.error || "") ? DECLINED : `BytePlus did not return this clip (${done.error}).`);
    return;
  }
  chargeJob(ctx, job, taskId, Number(done.tokens) > 0 ? done.tokens : estimatedTokens(job), ledgerDir, done.videoUrl);
  await keepPaidClip(ctx, jobId, { deps });
}

async function order(ctx, jobId, submittedTask, { ledgerDir, deps }) {
  const job = findJob(ctx.dataDir, jobId);
  if (!job || job.status !== "queued") return;
  const submitted = await deps.submit({ prompt: job.prompt, aspect: job.aspect, durationSec: job.seconds, model: SHOT_MODEL, resolution: SHOT_RESOLUTION });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, rerollLedgerKey(jobId));
    failJob(ctx.dataDir, jobId, submitted.code === "REFUSED" ? DECLINED : submitted.error || "The clip could not be ordered.");
    return;
  }
  // Known in memory first, so a failure to save it below still counts the task as ordered.
  submittedTask.id = submitted.taskId;
  // Saved before waiting, so a restart collects this task instead of ordering again.
  patchJob(ctx.dataDir, jobId, (j) => (j.status === "queued" ? { ...j, status: "generating", taskId: submitted.taskId, startedAt: Date.now() } : null));
  await collect(ctx, jobId, submitted.taskId, { ledgerDir, deps });
}

/**
 * A re-roll that broke part way. Before ordering, its reservation is released.
 * Once ordered, BytePlus may bill it, so the estimate is counted (which also
 * clears the reservation) unless it was already charged. Never throws: it
 * runs in the background, where a throw would take the server down.
 */
function abandon(ctx, jobId, ledgerDir, taskId, e) {
  console.warn(`[visual-library] re-roll ${jobId} failed: ${e?.message || e}`);
  try {
    const job = findJob(ctx.dataDir, jobId) || { id: jobId, seconds: DEFAULT_SECONDS, aspect: "portrait" };
    const ordered = taskId || job.taskId;
    if (!ordered) releaseSpend(ledgerDir, rerollLedgerKey(jobId));
    else if (job.chargedTaskId !== ordered) chargeJob(ctx, job, ordered, estimatedTokens(job), ledgerDir);
    const paid = findJob(ctx.dataDir, jobId);
    failJob(ctx.dataDir, jobId, canRefetch({ ...paid, status: "error" }) ? PAID_NOT_KEPT : "Something went wrong making this clip. Try again.");
  } catch (again) {
    console.warn(`[visual-library] could not record the failed re-roll ${jobId}: ${again?.message || again}`);
  }
}

/** Run a re-roll's work in the background. The promise never rejects. */
function run(ctx, jobId, ledgerDir, work) {
  const submittedTask = { id: null };
  track(ctx.dataDir, 1);
  return Promise.resolve()
    .then(() => work(submittedTask))
    .catch((e) => abandon(ctx, jobId, ledgerDir, submittedTask.id, e))
    .finally(() => track(ctx.dataDir, -1));
}

/**
 * Order a new clip from a library clip's prompt (or the one given), in the
 * background. expectUsd is the price the user was shown: a higher price now
 * is refused so nobody pays more than they agreed to.
 */
export function startReroll(ctx, clipId, { prompt, expectUsd, ledgerDir, deps } = {}) {
  const clip = getClip(ctx.dataDir, clipId);
  if (!clip) return { ok: false, status: 404, code: "NOT_FOUND", error: "That clip is not in your library." };
  const text = (typeof prompt === "string" && prompt.trim() ? prompt : clip.prompt || "").trim().slice(0, MAX_PROMPT);
  if (!text) return { ok: false, status: 400, code: "NO_PROMPT", error: "Write what the new clip should show." };
  if (!Number.isFinite(expectUsd) || expectUsd < 0) return { ok: false, status: 400, code: "NO_PRICE", error: "Check the price before re-rolling." };
  const price = rerollPrice(clip);
  if (price.usd > expectUsd + 0.005) {
    return { ok: false, status: 409, code: "PRICE_CHANGED", error: `The price is now $${price.usd.toFixed(2)}. Check it and try again.`, price };
  }
  const active = listRerolls(ctx.dataDir).filter((j) => IN_FLIGHT.has(j.status));
  // A second tab, or a retry after a lost response, must not pay for the same clip twice.
  if (active.some((j) => j.fromClipId === clip.id && j.prompt === text)) {
    return { ok: false, status: 409, code: "DUPLICATE", error: "This re-roll is already being made." };
  }
  if (active.length >= MAX_IN_FLIGHT) {
    return { ok: false, status: 409, code: "BUSY", error: `${MAX_IN_FLIGHT} re-rolls are already being made. Wait for one to finish.` };
  }
  const budget = wouldExceedCap(ledgerDir, price.usd);
  if (budget.exceeded) return { ok: false, status: 409, code: "BUDGET", error: budget.error };
  const job = {
    id: crypto.randomUUID(), createdAt: Date.now(), fromClipId: clip.id, prompt: text, aspect: clip.aspect || "portrait",
    seconds: price.seconds, lead: clip.lead || "", tags: clip.tags || [], estimateUsd: price.usd,
    status: "queued", taskId: null, startedAt: null, chargedTaskId: null, costUsd: null, tokens: null, videoUrl: null, clipId: null, error: null,
  };
  const key = rerollLedgerKey(job.id);
  const reserved = reserveSpend(ledgerDir, key, price.usd);
  if (!reserved.ok) return { ok: false, status: 409, code: "BUDGET", error: reserved.error };
  try {
    writeJobs(ctx.dataDir, [job, ...listRerolls(ctx.dataDir)]);
  } catch (e) {
    // Nothing would ever settle or release a reservation without its job.
    releaseSpend(ledgerDir, key);
    throw e;
  }
  void run(ctx, job.id, ledgerDir, (submittedTask) => order(ctx, job.id, submittedTask, { ledgerDir, deps: { ...seedanceDeps, ...deps } }));
  return { ok: true, job };
}

/** Fetch a paid clip that could not be saved, at no cost, while BytePlus still has it. */
export function refetchReroll(ctx, jobId, { ledgerDir, deps } = {}) {
  const job = findJob(ctx.dataDir, jobId);
  if (!job) return { ok: false, status: 404, code: "NOT_FOUND", error: "Re-roll not found." };
  if (!canRefetch(job)) return { ok: false, status: 409, code: "NOT_REFETCHABLE", error: "This clip can no longer be fetched again." };
  const written = patchJob(ctx.dataDir, jobId, (j) => ({ ...j, status: "generating", error: null }));
  void run(ctx, jobId, ledgerDir, () => keepPaidClip(ctx, jobId, { deps: { ...seedanceDeps, ...deps } }));
  return { ok: true, job: written };
}

/**
 * After a restart: collect clips that were ordered and release the ones that
 * never were. Resolves with the number collected.
 */
export async function resumeRerolls(ctx, { ledgerDir, deps } = {}) {
  const d = { ...seedanceDeps, ...deps };
  const jobs = [];
  for (const j of listRerolls(ctx.dataDir)) {
    if (!IN_FLIGHT.has(j.status)) continue;
    if (!j.taskId) {
      releaseSpend(ledgerDir, rerollLedgerKey(j.id));
      failJob(ctx.dataDir, j.id, "Interrupted by a server restart before the clip was ordered. Re-roll it again.");
      continue;
    }
    // Paid already: fetch it from the saved URL rather than waiting on the task again.
    const work = j.chargedTaskId === j.taskId && j.videoUrl
      ? () => keepPaidClip(ctx, j.id, { deps: d })
      : () => collect(ctx, j.id, j.taskId, { ledgerDir, deps: d });
    jobs.push(run(ctx, j.id, ledgerDir, work));
  }
  await Promise.all(jobs);
  return jobs.length;
}
