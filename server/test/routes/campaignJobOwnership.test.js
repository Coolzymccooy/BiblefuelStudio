import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCampaignJob, isJobVisibleTo } from "../../src/routes/jobs.js";

// A regular tenant and a super-admin operator. dataDir/outputDir mirror what
// withUserScope attaches for a non-admin (per-user dirs) vs the operator.
const alice = {
  userId: "u_alice",
  dataDir: "/data/users/u_alice",
  outputDir: "/out/users/u_alice",
  isSuperAdmin: false,
};
const bob = { userId: "u_bob" };
const admin = { userId: "u_admin", isSuperAdmin: true };

test("buildCampaignJob tags the job with the caller's ownerId and per-user ctx", () => {
  const job = buildCampaignJob("job_1", { title: "x" }, alice);
  assert.equal(job.type, "campaign_auto_post");
  assert.equal(job.ownerId, "u_alice");
  assert.equal(job.ctx.dataDir, "/data/users/u_alice");
  assert.equal(job.ctx.outputDir, "/out/users/u_alice");
  assert.equal(job.ctx.isSuperAdmin, false);
});

test("a campaign job built with the creator's ctx is visible to creator + admin, NOT a third tenant", () => {
  const job = buildCampaignJob("job_2", {}, alice);
  assert.equal(isJobVisibleTo(job, { userId: "u_alice" }), true); // creator sees their own
  assert.equal(isJobVisibleTo(job, bob), false); // a different tenant cannot
  assert.equal(isJobVisibleTo(job, admin), true); // super-admin sees all
});

test("REGRESSION: a campaign job built WITHOUT ctx is null-owner and invisible to its true creator (the Series leak)", () => {
  // This is exactly the pre-fix Series path: enqueueCampaignAutoPost(payload)
  // was called with no ctx, so every part rendered into the GLOBAL data/output
  // dir, surfaced ONLY under the operator's (super-admin) Jobs list, and the
  // tenant who generated the series never saw their own jobs.
  const job = buildCampaignJob("job_3", {}, null);
  assert.equal(job.ownerId, null);
  assert.equal(job.ctx, null);
  assert.equal(isJobVisibleTo(job, alice), false);
  assert.equal(isJobVisibleTo(job, admin), true);
});

test("coerces a truthy isSuperAdmin into a strict boolean", () => {
  const job = buildCampaignJob("job_4", {}, { userId: "u_x", isSuperAdmin: 1 });
  assert.equal(job.ctx.isSuperAdmin, true);
});
