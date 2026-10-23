import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { JOB_KINDS, NORMALISERS, clampTimeoutSec, outputUrl, waitForJob } from "../jobs.js";

const DEFAULT_LIST_LIMIT = 20;

let waitImpl = waitForJob;

/** Test seam: replace `waitForJob` to observe what the tool passes it. Pass null to restore. */
export function _setWaitForJobForTests(fn) {
  waitImpl = typeof fn === "function" ? fn : waitForJob;
}

/** A queue job as a handle, plus what it is and when it was made. */
function jobRow(job, ctx) {
  const handle = NORMALISERS.job.normalise({ job }, { outputUrl: (p) => outputUrl(p, ctx.publicBase) });
  return { ...handle, type: job?.type ?? null, createdAt: job?.createdAt ?? null };
}

const jobsList = {
  name: "jobs_list",
  title: "List jobs",
  description: "Your recent queued render jobs, newest first, each with its status, progress and output.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(DEFAULT_LIST_LIMIT).describe("How many jobs to return, 1 to 100.") },
  routes: ["/api/jobs"],
  async handler(ctx, { limit = DEFAULT_LIST_LIMIT }) {
    const body = await ctx.api.call("GET", "/api/jobs");
    const jobs = (Array.isArray(body?.jobs) ? body.jobs : []).slice(0, limit).map((job) => jobRow(job, ctx));
    return ok({ jobs });
  },
};

const jobsGet = {
  name: "jobs_get",
  title: "Get a job",
  description: "One queued render job by id: status, progress, output url and error.",
  inputSchema: { id: z.string().min(1).describe("The job id, e.g. job_...") },
  routes: ["/api/jobs"],
  async handler(ctx, { id }) {
    const body = await ctx.api.call("GET", NORMALISERS.job.route(id));
    return ok(jobRow(body.job, ctx));
  },
};

const jobsRetry = {
  name: "jobs_retry",
  title: "Retry a job",
  description: "Re-queue a finished or failed job with the same settings. Returns the NEW job (a different id). A job that is still queued or running cannot be retried.",
  inputSchema: { id: z.string().min(1).describe("The id of the job to retry.") },
  routes: ["/api/jobs"],
  caps: { renders: 1 },
  async handler(ctx, { id }) {
    const body = await ctx.api.call("POST", `${NORMALISERS.job.route(id)}/retry`);
    return ok(jobRow(body.job, ctx));
  },
};

const jobsWait = {
  name: "jobs_wait",
  title: "Wait for a job",
  description:
    `Wait up to timeoutSec seconds (1 to 90, default 60) for a job to finish, then return its handle. ` +
    `If it is still running the handle says so: call again to keep waiting. Kinds: ${JOB_KINDS.join(", ")}. ` +
    `For a story pass the project id as id.`,
  inputSchema: {
    kind: z.string().describe(`What kind of job: ${JOB_KINDS.join(", ")}.`),
    id: z.string().min(1).describe("The job id (the project id for story)."),
    projectId: z.string().optional().describe("The project the job belongs to, if any; echoed back on the handle."),
    timeoutSec: z.number().optional().describe("Seconds to wait, clamped to 1..90. Default 60."),
  },
  routes: ["/api/jobs", "/api/render", "/api/story", "/api/timeline", "/api/music", "/api/social"],
  async handler(ctx, { kind, id, projectId, timeoutSec }) {
    if (!Object.hasOwn(NORMALISERS, kind)) {
      return fail("BAD_KIND", `Unknown job kind "${kind}". Use one of: ${JOB_KINDS.join(", ")}.`);
    }
    const handle = await waitImpl(ctx.api, {
      kind,
      id,
      projectId,
      timeoutSec: clampTimeoutSec(timeoutSec),
      outputUrl: (p) => outputUrl(p, ctx.publicBase),
    });
    return ok(handle);
  },
};

export default [jobsList, jobsGet, jobsRetry, jobsWait];
