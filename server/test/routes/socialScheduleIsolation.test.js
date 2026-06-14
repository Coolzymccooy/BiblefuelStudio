import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheduledPost } from "../../src/routes/social.js";

const aliceCtx = { userId: "u_alice", dataDir: "/data/users/u_alice", outputDir: "/data/users/u_alice/outputs", isSuperAdmin: false };

test("auto_generate schedule enqueues with the owner's ctx", async () => {
  let seenCtx = null;
  const deps = {
    enqueueCampaignAutoPost: async (_payload, ctx) => { seenCtx = ctx; return { id: "job_x" }; },
    dispatchPost: async () => ({ ok: true }),
  };
  const schedule = { id: "s1", enabled: true, type: "auto_generate", destination: "webhook" };
  await runScheduledPost(schedule, aliceCtx, deps);
  assert.deepEqual(seenCtx, aliceCtx);
});

test("replay schedule dispatches with a reqLike carrying the owner's ctx", async () => {
  let seenReq = null;
  const deps = {
    enqueueCampaignAutoPost: async () => ({ id: "n/a" }),
    dispatchPost: async (_payload, req) => { seenReq = req; return { ok: true }; },
  };
  const schedule = { id: "s2", enabled: true, type: "replay", destination: "webhook", caption: "hi", videoUrl: "http://x/v.mp4" };
  await runScheduledPost(schedule, aliceCtx, deps);
  assert.equal(seenReq.ctx.dataDir, "/data/users/u_alice");
  assert.equal(seenReq.ctx.userId, "u_alice");
});

test("a disabled schedule does nothing", async () => {
  let called = false;
  const deps = {
    enqueueCampaignAutoPost: async () => { called = true; },
    dispatchPost: async () => { called = true; },
  };
  await runScheduledPost({ id: "s3", enabled: false, type: "replay" }, aliceCtx, deps);
  assert.equal(called, false);
});
