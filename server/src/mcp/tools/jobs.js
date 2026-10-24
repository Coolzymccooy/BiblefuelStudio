import { z } from "zod";
import { ok, fail, PUBLISH_NOT_ALLOWED_MESSAGE } from "../toolResult.js";
import { JOB_KINDS, NORMALISERS, clampTimeoutSec, outputUrl, waitForJob } from "../jobs.js";
import { lacksPublishConsent, renderPublishPlan } from "../autoPublish.js";
import { renderQuotaRefusal } from "../planQuota.js";

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

const POSTING_JOB_TYPE = "campaign_auto_post";
const AUTO_PUBLISH_JOB_TYPES = new Set(["render_video", "render_waveform"]);

/** Retrying a posting job renders and posts: it needs the publish switch and spends renders and publishes. */
async function retryPostingJob(ctx, path) {
  if (lacksPublishConsent(ctx)) return fail("PUBLISH_NOT_ALLOWED", PUBLISH_NOT_ALLOWED_MESSAGE);
  // The retry route spends the plan's render quota; read it first so a refused retry spends no caps.
  const outOfQuota = await renderQuotaRefusal(ctx);
  if (outOfQuota) return outOfQuota;
  // One atomic charge: a refused publish must not leave a render spent.
  const refused = await ctx.chargeCap({ renders: 1, publishes: 1 });
  if (refused) return refused;
  return ok(await queueRetry(ctx, path));
}

/**
 * Retrying a render spends a render. Without consent the retry is queued with
 * autoPublish off, so it can never post. With consent it posts only if the
 * user's own Postiz auto-publish is on, and then it also spends a publish,
 * charged with the render in one atomic call.
 */
async function retryRender(ctx, path) {
  const outOfQuota = await renderQuotaRefusal(ctx);
  if (outOfQuota) return outOfQuota;
  const plan = await renderPublishPlan(ctx);
  const refused = await ctx.chargeCap({ renders: 1, ...plan.charge });
  if (refused) return refused;
  return ok(await queueRetry(ctx, path, plan.suppress ? { autoPublish: false } : undefined));
}

async function queueRetry(ctx, path, body) {
  const response = await ctx.api.call("POST", `${path}/retry`, body ? { body } : undefined);
  return jobRow(response.job, ctx);
}

const jobsRetry = {
  name: "jobs_retry",
  title: "Retry a job",
  description:
    "Re-queue a finished or failed job with the same settings. Returns the NEW job (a different id). " +
    "A job that is still queued or running cannot be retried. Retrying a posting job (campaign_auto_post) " +
    "needs the key's publish switch and spends a render and a publish; a render retried without the " +
    "publish switch never auto-posts; with it, and the user's auto-publish on, it also spends a publish. " +
    "Every retry spends one daily render. Retrying a render_video, render_waveform or campaign_auto_post job also " +
    "spends one unit of the plan's render quota (QUOTA_EXCEEDED when it is used up, before any cap is spent).",
  inputSchema: { id: z.string().min(1).describe("The id of the job to retry.") },
  routes: ["/api/jobs"],
  async handler(ctx, { id }) {
    const path = NORMALISERS.job.route(id);
    const original = await ctx.api.call("GET", path);
    const type = original?.job?.type;
    if (type === POSTING_JOB_TYPE) return retryPostingJob(ctx, path);
    if (AUTO_PUBLISH_JOB_TYPES.has(type)) return retryRender(ctx, path);
    const refused = await ctx.chargeCap("renders", 1);
    if (refused) return refused;
    return ok(await queueRetry(ctx, path));
  },
};

const jobsWait = {
  name: "jobs_wait",
  title: "Wait for a job",
  description:
    `Wait up to timeoutSec seconds (1 to 90, default 60) for a job to finish, then return its handle. ` +
    `If it is still running the handle says so: call again to keep waiting. Kinds: ${JOB_KINDS.join(", ")}. ` +
    `For a story or an ambient session pass the project id as id.`,
  inputSchema: {
    kind: z.string().describe(`What kind of job: ${JOB_KINDS.join(", ")}.`),
    id: z.string().min(1).describe("The job id (the project id for story and ambient)."),
    projectId: z.string().optional().describe("The project the job belongs to, if any; echoed back on the handle."),
    timeoutSec: z.number().optional().describe("Seconds to wait, clamped to 1..90. Default 60."),
  },
  routes: ["/api/jobs", "/api/render", "/api/story", "/api/ambient", "/api/timeline", "/api/music", "/api/social"],
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
