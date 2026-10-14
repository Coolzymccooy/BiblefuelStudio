// server/src/lib/lyricVideo/vocalStem.js
// Ask the laptop worker for the song's vocals so timing listens to the voice alone (spec 5.2).
// Never holds timing for long: no capable laptop, no room, a failure or 4 minutes all end as null.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { enqueueLaptopJob, laptopOnline, laptopQueueEnabled, queueRoomFor, cancelLaptopJob } from "../stems/laptopQueue.js";
import { getStemJob } from "../stems/stemJobs.js";

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
};

/**
 * The vocals of `input` as an .m4a path, or null: no capable laptop online, no
 * room in the queue, the job failed or was cancelled, or it was not ready in
 * `timeoutMs`. The queued job never outlives this call (it holds one of the
 * user's two vocal-removal slots): a timeout, an abort or any error cancels
 * it. An error is thrown after that; the caller decides what it means.
 */
export async function requestVocalStem({ userId, input, dataDir, outputDir, timeoutMs = 240_000, pollMs = 2000, signal, deps = {} }) {
  const d = { ...defaults, ...deps };
  if (signal?.aborted || !d.enabled() || !d.laptopOnline() || !d.queueRoomFor(userId)) return null;
  const jobId = randomUUID();
  // The laptop's input must sit inside the owner's folders, or a restart would drop the row.
  const resultPath = path.resolve(outputDir, `lyric-vocals-${jobId}.m4a`);
  const job = d.enqueue({
    jobId, userId, sourceRef: "lyric-video", sourcePreview: null, resultPath, sourceLabel: path.basename(input),
    input, quality: "best", dataDir, outputDir, stem: "vocals",
  });
  let settled = false; // the job reached an end of its own: nothing left to cancel
  try {
    const deadline = d.now() + timeoutMs;
    while (d.now() < deadline) {
      if (signal?.aborted) return null;
      const live = d.getJob(jobId, userId);
      if (!live) { settled = true; return null; }
      if (live.status === "done") {
        settled = true;
        const file = live.resultFile || resultPath;
        return d.exists(file) ? file : null;
      }
      if (live.status === "error") { settled = true; return null; }
      await d.sleep(pollMs);
    }
    return null;
  } finally {
    if (!settled) {
      try { d.cancel(job); } catch (err) { console.warn(`[lyric-video] could not cancel the vocals job ${jobId}: ${err?.message || err}`); }
    }
  }
}
