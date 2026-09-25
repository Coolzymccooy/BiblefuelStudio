import crypto from "crypto";

/**
 * YouTube uploads as background jobs.
 *
 * Publishing used to be one request that lasted the whole upload. A long
 * video outlived the browser's 15 s wait (and Cloudflare's ~100 s one): the
 * page showed an error while the upload carried on, a retry uploaded a
 * second copy, and nothing recorded the video that did arrive.
 *
 * In memory: a restart ends the upload too, so there is nothing to resume.
 */

const jobs = new Map();
/** Finished jobs kept per account, newest last, for the page to read back. */
const KEEP_FINISHED = 20;

function view(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function prune(userId) {
  const finished = [...jobs.values()]
    .filter((j) => j.userId === userId && j.status !== "running")
    .sort((a, b) => a.finishedAt - b.finishedAt);
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) jobs.delete(j.jobId);
}

/**
 * Start `run` as a job, or join the one already uploading `key` for this
 * account: a second click is the same upload, never a second copy.
 *
 * @param {{ userId: string, key: string, run: () => Promise<object> }} opts
 * @returns {{ job: object, joined: boolean }}
 */
export function startPublishJob({ userId, key, run }) {
  const uid = String(userId || "");
  for (const j of jobs.values()) {
    if (j.userId === uid && j.key === key && j.status === "running") return { job: view(j), joined: true };
  }
  const job = {
    jobId: crypto.randomUUID(),
    userId: uid,
    key,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.jobId, job);
  // Settled here: a fire-and-forget rejection would otherwise be unhandled,
  // which ends the process under Node's default policy.
  Promise.resolve()
    .then(run)
    .then((result) => { job.status = "done"; job.result = result; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message || e); })
    .finally(() => { job.finishedAt = Date.now(); prune(uid); });
  return { job: view(job), joined: false };
}

/** One of this account's jobs, or null (another account's reads as missing). */
export function getPublishJob(userId, jobId) {
  const job = jobs.get(String(jobId || ""));
  if (!job || job.userId !== String(userId || "")) return null;
  return view(job);
}

/** Test seam. */
export function _resetPublishJobs() { jobs.clear(); }
