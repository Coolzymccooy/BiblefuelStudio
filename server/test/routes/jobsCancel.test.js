import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// #121: POST /api/jobs/:id/cancel stops a queued or running queue job (render_short and the
// other kind `job` renders) for its owner. A cancelled job stays cancelled: the worker's late
// writes for it are dropped, and a render that finishes anyway is never auto-posted.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-cancel-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });
const savedEnv = { url: process.env.POSTIZ_URL, key: process.env.POSTIZ_API_KEY, base: process.env.PUBLIC_BASE_URL };
process.env.POSTIZ_URL = "http://127.0.0.1:1";
process.env.POSTIZ_API_KEY = "test-key";
process.env.PUBLIC_BASE_URL = "https://studio.example.test";

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const jobs = await import("../../src/routes/jobs.js");
const { writeSocialStore } = await import("../../src/lib/socialStore.js");

const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");
const ME = { userId: "u_me", plan: "premium", dataDir: path.join(root, "users", "u_me"), outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
const THEM = { ...ME, userId: "u_them", dataDir: path.join(root, "users", "u_them") };
fs.mkdirSync(ME.dataDir, { recursive: true });
writeSocialStore(ME.dataDir, { postiz: { autoPublish: true, postizUserId: "pz_1", autoPublishPlatforms: ["tiktok"] } });

// The "[AUTO-PUBLISH] posting job <id>" line is the signal maybeAutoPublish tried to post.
const posted = new Set();
const original = { log: console.log, warn: console.warn };
console.log = (...args) => {
  const match = /^\[AUTO-PUBLISH\] posting job (\S+)/.exec(String(args[0]));
  if (match) posted.add(match[1]);
};
console.warn = () => {};

afterEach(() => jobs._setExecuteJobForTests(null));
after(() => {
  console.log = original.log;
  console.warn = original.warn;
  for (const [name, value] of [["POSTIZ_URL", savedEnv.url], ["POSTIZ_API_KEY", savedEnv.key], ["PUBLIC_BASE_URL", savedEnv.base]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function appFor(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use("/api/jobs", jobs.default);
  return app;
}

const seed = (list) => fs.writeFileSync(JOBS_FILE, JSON.stringify({ jobs: list }, null, 2));
const readJob = (id) => JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs.find((j) => j.id === id);
const row = (id, status, owner = ME) => ({
  id, type: "render_video", payload: { lines: ["Peace"] }, ownerId: owner.userId, ctx: owner, status, createdAt: "2026-10-24T10:00:00.000Z",
});

async function until(check, what, tries = 400) {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A renderer the test finishes by hand. */
function heldRenderer() {
  let finish;
  const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  const started = new Set();
  jobs._setExecuteJobForTests(async (job) => {
    started.add(job.id);
    return done;
  });
  return { started, finish };
}

test("the owner cancels a queued job: it reads cancelled and is never started afterwards", async () => {
  const held = heldRenderer();
  seed([row("job_q", "queued")]);
  const res = await request(appFor(ME)).post("/api/jobs/job_q/cancel");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.job.status, "cancelled");
  assert.equal(readJob("job_q").status, "cancelled");
  assert.equal(readJob("job_q").error, "Job cancelled");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(readJob("job_q").status, "cancelled");
  held.finish.resolve({ outFile: path.join(ME.outputDir, "video-never.mp4") });
});

test("a running job cancelled stays cancelled when its render ends anyway, and is never auto-posted", async () => {
  const held = heldRenderer();
  seed([row("job_run", "queued")]);
  await until(() => held.started.has("job_run"), "the worker to start the job");
  const res = await request(appFor(ME)).post("/api/jobs/job_run/cancel");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  held.finish.resolve({ outFile: path.join(ME.outputDir, "video-late.mp4") });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(readJob("job_run").status, "cancelled");
  assert.equal(posted.has("job_run"), false);
});

test("a running job whose render fails after the cancel (ffmpeg killed) reads cancelled, not failed", async () => {
  const held = heldRenderer();
  seed([row("job_kill", "queued")]);
  await until(() => held.started.has("job_kill"), "the worker to start the job");
  await request(appFor(ME)).post("/api/jobs/job_kill/cancel");
  held.finish.reject(new Error("ffmpeg failed: null"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(readJob("job_kill").status, "cancelled");
  assert.equal(readJob("job_kill").error, "Job cancelled");
});

test("a finished, failed or cancelled job is refused with 409 and left as it is", async () => {
  for (const status of ["done", "failed", "cancelled"]) {
    seed([row("job_end", status)]);
    const res = await request(appFor(ME)).post("/api/jobs/job_end/cancel");
    assert.equal(res.status, 409, status);
    assert.equal(res.body.error, "NOTHING_RUNNING");
    assert.equal(readJob("job_end").status, status);
  }
});

test("another user's job and an unknown id answer 404, and nothing changes", async () => {
  jobs._setExecuteJobForTests(async () => new Promise(() => {}));
  seed([row("job_theirs", "running", THEM)]);
  const theirs = await request(appFor(ME)).post("/api/jobs/job_theirs/cancel");
  assert.equal(theirs.status, 404);
  assert.equal(readJob("job_theirs").status, "running");
  const unknown = await request(appFor(ME)).post("/api/jobs/job_nope/cancel");
  assert.equal(unknown.status, 404);
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status === 0 ? false : "ffmpeg not installed";

test("cancelling a real running render stops its ffmpeg straight away", { skip: noFfmpeg }, async () => {
  const bg = path.join(ME.outputDir, "cancel-bg.mp4");
  const made = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x335577:s=640x360:d=2:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", bg]);
  assert.equal(made.status, 0, String(made.stderr));
  seed([{ ...row("job_real", "queued"), payload: { backgroundPath: bg, lines: ["Peace"], durationSec: 30, aspect: "portrait" } }]);
  await until(() => readJob("job_real")?.status === "running", "the render to start");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const started = Date.now();
  const res = await request(appFor(ME)).post("/api/jobs/job_real/cancel");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await until(() => jobs._workerBusyForTests() === false, "the worker to stop", 400);
  assert.ok(Date.now() - started < 8000, "the render stopped soon after the cancel");
  assert.equal(readJob("job_real").status, "cancelled");
});
