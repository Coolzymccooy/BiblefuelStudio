/**
 * Vocal-removal jobs, in memory. A separation is minutes long and its only
 * durable output is a file in the tenant's outputs; a server restart forgets
 * the job and the sweep removes an unkept result later.
 */
const jobs = new Map();

export function createStemJob({ jobId, userId, sourceRef, sourcePreview, resultPath }) {
  const job = {
    jobId, userId, sourceRef, sourcePreview, resultPath,
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

export function removeStemJob(jobId) {
  jobs.delete(jobId);
}

export function _resetStemJobs() {
  jobs.clear();
}
