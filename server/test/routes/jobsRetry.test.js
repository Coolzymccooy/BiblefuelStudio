import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// jobs.js reads DATA_DIR at import time, so set it before importing the router.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-retry-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: jobsRouter } = await import("../../src/routes/jobs.js");
const { QUOTAS } = await import("../../src/middleware/quota.js");
const { readUsage, incrementUsage } = await import("../../src/lib/usageStore.js");

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");
const WAVE_PAYLOAD = { audioPath: "http://127.0.0.1:1/a.mp3" };
const LIMIT = QUOTAS.free.render;

let userCounter = 0;
/** A fresh free-plan user with their own data dir, so usage counts never mix between tests. */
function freshUser(plan = "free") {
  const userId = `u_retry_${++userCounter}`;
  const dataDir = path.join(root, "users", userId);
  fs.mkdirSync(dataDir, { recursive: true });
  return { userId, dataDir, plan };
}

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = { ...user, outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
    next();
  });
  app.use("/api/jobs", jobsRouter);
  return app;
}

function seed(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify({ jobs }, null, 2));
}

function readJobs() {
  return JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs;
}

const finished = (user, type, payload = WAVE_PAYLOAD) => ({
  id: "job_orig", type, payload, ownerId: user.userId, status: "failed", createdAt: "2026-10-23T10:00:00.000Z",
});

test("a free user at the render limit gets 429 QUOTA_EXCEEDED and nothing is enqueued", async () => {
  const user = freshUser();
  incrementUsage(user.dataDir, "render", LIMIT);
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "QUOTA_EXCEEDED");
  assert.equal(res.body.bucket, "render");
  assert.equal(readJobs().length, 1);
  assert.equal(readUsage(user.dataDir).counts.render, LIMIT);
});

test("below the limit a render retry succeeds and counts one render", async () => {
  const user = freshUser();
  incrementUsage(user.dataDir, "render", LIMIT - 1);
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 200);
  assert.equal(res.body.job.retryOf, "job_orig");
  assert.equal(readUsage(user.dataDir).counts.render, LIMIT);
});

test("a premium user is not counted", async () => {
  const user = freshUser("premium");
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 200);
  assert.equal(readUsage(user.dataDir).counts.render, 0);
});

test("a job type the queue cannot run is refused and not counted", async () => {
  const user = freshUser();
  seed([finished(user, "some_other_job", {})]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 400);
  assert.equal(readUsage(user.dataDir).counts.render, 0);
});

test("a refused retry (409 while running) spends no quota", async () => {
  const user = freshUser();
  seed([{ ...finished(user, "render_waveform"), status: "running" }]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 409);
  assert.equal(readUsage(user.dataDir).counts.render, 0);
});

test("a retry with { autoPublish: false } marks the new job suppressAutoPublish", async () => {
  const user = freshUser("premium");
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry").send({ autoPublish: false });
  assert.equal(res.status, 200);
  const row = readJobs().find((j) => j.id === res.body.job.id);
  assert.equal(row.suppressAutoPublish, true);
});

test("a retry with no body leaves suppressAutoPublish off", async () => {
  const user = freshUser("premium");
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry");
  assert.equal(res.status, 200);
  const row = readJobs().find((j) => j.id === res.body.job.id);
  assert.equal(row.suppressAutoPublish, undefined);
});

test("a retry with { autoPublish: true } does not suppress", async () => {
  const user = freshUser("premium");
  seed([finished(user, "render_waveform")]);
  const res = await request(appFor(user)).post("/api/jobs/job_orig/retry").send({ autoPublish: true });
  const row = readJobs().find((j) => j.id === res.body.job.id);
  assert.equal(row.suppressAutoPublish, undefined);
});

test("maybeAutoPublish posts for a normal job and not for a suppressed one", async () => {
  const { maybeAutoPublish } = await import("../../src/routes/jobs.js");
  const { writeSocialStore, readSocialStore } = await import("../../src/lib/socialStore.js");
  const user = freshUser("premium");
  const store = readSocialStore(user.dataDir);
  writeSocialStore(user.dataDir, {
    ...store,
    postiz: { ...store.postiz, autoPublish: true, postizUserId: "pz_1", autoPublishPlatforms: ["tiktok"] },
  });

  const saved = { log: console.log, warn: console.warn, url: process.env.POSTIZ_URL, key: process.env.POSTIZ_API_KEY, base: process.env.PUBLIC_BASE_URL };
  process.env.POSTIZ_URL = "http://127.0.0.1:1";
  process.env.POSTIZ_API_KEY = "test-key";
  process.env.PUBLIC_BASE_URL = "https://studio.example.test";
  // The Postiz client's own transport is not stubbable; the "posting" log line is the signal an attempt was made.
  let posts = 0;
  console.log = (...args) => { if (String(args[0]).startsWith("[AUTO-PUBLISH] posting")) posts += 1; };
  console.warn = () => {};
  try {
    const job = { id: "job_ap", ctx: { dataDir: user.dataDir }, payload: { caption: "hi" } };
    const result = { outFile: "/srv/outputs/video-1.mp4" };
    await maybeAutoPublish({ ...job, suppressAutoPublish: true }, result);
    assert.equal(posts, 0, "suppressed job must not post");
    await maybeAutoPublish(job, result);
    assert.ok(posts > 0, "an ordinary job still auto-posts");
  } finally {
    console.log = saved.log;
    console.warn = saved.warn;
    for (const [name, value] of [["POSTIZ_URL", saved.url], ["POSTIZ_API_KEY", saved.key], ["PUBLIC_BASE_URL", saved.base]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
