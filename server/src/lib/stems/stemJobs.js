/**
 * Vocal-removal jobs, in memory. A separation is minutes long and its only
 * durable output is a file in the tenant's outputs; a server restart forgets
 * the job and a finished result is already saved to the library.
 */
const jobs = new Map();

export function createStemJob({
  jobId, userId, sourceRef, sourcePreview, resultPath, sourceLabel, sourceMood, sourceLicence, sourceCredit,
}) {
  const job = {
    jobId,
    userId,
    sourceRef,
    sourcePreview,
    resultPath,
    // Captured at start, not re-read at keep time: if the source track is
    // edited or removed while the separation is running, the instrumental
    // must still inherit the licence/credit it started with.
    sourceLabel,
    sourceMood,
    sourceLicence,
    sourceCredit,
    status: "queued", percent: 0, error: null, controller: new AbortController(), createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

/** The job, only for the user who started it. */
export function getStemJob(jobId, userId) {
  const job = jobs.get(String(jobId));
  return job && job.userId === userId ? job : null;
}

export function updateStemJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, patch);
  return job;
}

/** Every job, oldest first (Map keeps insertion order). */
export function listStemJobs() {
  return [...jobs.values()];
}

export function removeStemJob(jobId) {
  jobs.delete(jobId);
}

export function _resetStemJobs() {
  jobs.clear();
}
