// server/src/lib/lyricVideo/vocalStem.js
// Ask the laptop worker for the song's vocals so timing listens to the voice alone (spec 5.2).
// Never holds timing for long: no capable laptop, no room, a failure or 4 minutes all end as null.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { enqueueLaptopJob, laptopOnline, laptopQueueEnabled, queueRoomFor, cancelLaptopJob } from "../stems/laptopQueue.js";
import { getStemJob } from "../stems/stemJobs.js";

/** The name a vocals result has; only a file named like this is ever removed as ours. */
const VOCALS_RESULT = /^lyric-vocals-[\w-]+\.m4a$/;

const defaults = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  enabled: () => laptopQueueEnabled(),
  // Only a laptop worker that can return a vocals stem counts; an older one would leave the job queued forever.
  laptopOnline: () => laptopOnline(Date.now(), { needs: "vocals" }),
  queueRoomFor,
  enqueue: enqueueLaptopJob,
  getJob: (jobId, userId) => getStemJob(jobId, userId),
  cancel: cancelLaptopJob,
  exists: (file) => fs.existsSync(file),
  remove: (file) => fs.rmSync(file, { force: true }),
};

const warn = (what, jobId, err) => console.warn(`[lyric-video] could not ${what} the vocals job ${jobId}: ${err?.message || err}`);

/**
 * The vocals of `input` as an .m4a path, or null: no capable laptop online, no
 * room in the queue, the job failed or was cancelled, or it was not ready in
 * `timeoutMs`. The queued job never outlives this call (it holds one of the
 * user's two vocal-removal slots): a timeout, an abort or any error cancels
 * it, unless it has finished, in which case its unused result file is removed
 * instead. An error is thrown after that; the caller decides what it means.
 * `onQueued` runs once a job has actually been queued (not for the quick nulls).
 */
export async function requestVocalStem({ userId, input, dataDir, outputDir, timeoutMs = 240_000, pollMs = 2000, signal, onQueued, deps = {} }) {
  const d = { ...defaults, ...deps };
  if (signal?.aborted || !d.enabled() || !d.laptopOnline() || !d.queueRoomFor(userId)) return null;
  const jobId = randomUUID();
  // The laptop's input must sit inside the owner's folders, or a restart would drop the row.
  const resultPath = path.resolve(outputDir, `lyric-vocals-${jobId}.m4a`);
  const job = d.enqueue({
    jobId, userId, sourceRef: "lyric-video", sourcePreview: null, resultPath, sourceLabel: path.basename(input),
    input, quality: "best", dataDir, outputDir, stem: "vocals",
  });
  let settled = false; // the job reached an end of its own and its result was dealt with
  // One look at the job: { out } when it has ended (the file, or null), nothing while it is still waiting.
  const look = () => {
    const live = d.getJob(jobId, userId);
    if (!live) { settled = true; return { out: null }; }
    if (live.status === "done") {
      settled = true;
      const file = live.resultFile || resultPath;
      return { out: d.exists(file) ? file : null };
    }
    if (live.status === "error") { settled = true; return { out: null }; }
    return null;
  };
  try {
    onQueued?.();
    const deadline = d.now() + timeoutMs;
    while (d.now() < deadline) {
      if (signal?.aborted) return null;
      const seen = look();
      if (seen) return seen.out;
      await d.sleep(pollMs);
    }
    // The laptop may have finished during the last sleep: look once more before giving up.
    if (!signal?.aborted) {
      const seen = look();
      if (seen) return seen.out;
    }
    return null;
  } finally {
    if (!settled) releaseJob({ d, job, jobId, userId, resultPath });
  }
}

/** The caller is not using the job: stop it if it is still waiting, or remove its result if it has finished. */
function releaseJob({ d, job, jobId, userId, resultPath }) {
  let view = job;
  try { view = d.getJob(jobId, userId) || job; } catch { /* use the job we hold */ }
  if (view.status === "done") {
    const file = view.resultFile || resultPath;
    if (!VOCALS_RESULT.test(path.basename(file))) return;
    try { d.remove(file); } catch (err) { warn("remove the result of", jobId, err); }
    return;
  }
  if (view.status === "error") return; // already over (failed or cancelled)
  try { d.cancel(job); } catch (err) { warn("cancel", jobId, err); }
}
