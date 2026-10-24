import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Issue #118: a queued render job that a deploy or restart stopped kept reading
// "running" for good unless it had run for 45 minutes. jobs.js sweeps the store
// when it is imported (server start), so the store is seeded BEFORE the import.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-restart-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");

const RESTART_ERROR = "Interrupted by a server restart. Retry it.";
const WAVE_PAYLOAD = { audioPath: "http://127.0.0.1:1/a.mp3" };
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000).toISOString();

const users = {
  alice: { userId: "u_alice", dataDir: path.join(root, "users", "u_alice"), plan: "premium" },
  bob: { userId: "u_bob", dataDir: path.join(root, "users", "u_bob"), plan: "premium" },
};
for (const user of Object.values(users)) fs.mkdirSync(user.dataDir, { recursive: true });

const row = (id, owner, fields) => ({
  id, type: "render_waveform", payload: WAVE_PAYLOAD, ownerId: owner?.userId, createdAt: minutesAgo(2), ...fields,
});

fs.writeFileSync(JOBS_FILE, JSON.stringify({
  jobs: [
    row("job_alice_young", users.alice, { status: "running", startedAt: minutesAgo(1), progress: 37 }),
    row("job_bob_running", users.bob, { status: "running", startedAt: minutesAgo(3), progress: 80 }),
    row("job_legacy_running", null, { status: "running", startedAt: minutesAgo(5) }),
    row("job_alice_mid_stage", users.alice, { status: "encoding", startedAt: minutesAgo(1) }),
    row("job_bob_queued", users.bob, { status: "queued" }),
    row("job_alice_done", users.alice, { status: "done", progress: 100, finishedAt: minutesAgo(1) }),
    row("job_bob_failed", users.bob, { status: "failed", error: "ffmpeg exited 1", finishedAt: minutesAgo(1) }),
  ],
}, null, 2));

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const jobsModule = await import("../../src/routes/jobs.js");
const { NORMALISERS } = await import("../../src/mcp/jobs.js");
const jobsRouter = jobsModule.default;

// Read the store as the import-time sweep left it, before the worker's first tick can touch the queued job.
const afterStartup = JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs;
const startupRow = (id) => afterStartup.find((j) => j.id === id);

// Nothing in these tests should really render: the worker's jobs wait until a test finishes them.
const unfinished = [];
jobsModule._setExecuteJobForTests(() => new Promise((resolve) => unfinished.push(resolve)));
const finishAllRuns = () => { for (const resolve of unfinished.splice(0)) resolve({}); };

after(() => {
  finishAllRuns();
  jobsModule._setExecuteJobForTests(null);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const readJobs = () => JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs;

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

test("the restart sweep marks a 1-minute-old running job failed and interrupted", () => {
  const job = startupRow("job_alice_young");
  assert.equal(job.status, "failed");
  assert.equal(job.interrupted, true);
  assert.equal(job.error, RESTART_ERROR);
  assert.equal(job.progress, 37, "the last progress is kept");
  assert.ok(job.finishedAt, "a finish time is set");
});

test("every user's running jobs are swept, including a legacy job with no owner", () => {
  for (const id of ["job_alice_young", "job_bob_running", "job_legacy_running"]) {
    assert.equal(startupRow(id).status, "failed", id);
    assert.equal(startupRow(id).interrupted, true, id);
    assert.equal(startupRow(id).error, RESTART_ERROR, id);
  }
});

test("a job left mid-stage (any status between queued and finished) is swept too", () => {
  const job = startupRow("job_alice_mid_stage");
  assert.equal(job.status, "failed");
  assert.equal(job.interrupted, true);
  assert.equal(job.error, RESTART_ERROR);
});

test("a queued job is left queued for the worker to run, as before", () => {
  const job = startupRow("job_bob_queued");
  assert.equal(job.status, "queued");
  assert.equal(job.interrupted, undefined);
  assert.equal(job.error, undefined);
});

test("finished jobs are left alone", () => {
  assert.equal(startupRow("job_alice_done").status, "done");
  assert.equal(startupRow("job_alice_done").interrupted, undefined);
  assert.equal(startupRow("job_bob_failed").error, "ffmpeg exited 1");
  assert.equal(startupRow("job_bob_failed").interrupted, undefined);
});

test("the MCP job handle reads a swept job as failed with the restart message", async () => {
  const res = await request(appFor(users.alice)).get("/api/jobs/job_alice_young");
  assert.equal(res.status, 200);
  const handle = NORMALISERS.job.normalise(res.body, { outputUrl: (p) => p });
  assert.equal(handle.status, "failed");
  assert.equal(handle.error, RESTART_ERROR);
});

test("a swept job can be retried (jobs_retry and the web Retry button both post here)", async () => {
  const res = await request(appFor(users.bob)).post("/api/jobs/job_bob_running/retry");
  assert.equal(res.status, 200);
  assert.equal(res.body.job.retryOf, "job_bob_running");
  assert.notEqual(res.body.job.id, "job_bob_running");
  const fresh = readJobs().find((j) => j.id === res.body.job.id);
  assert.equal(fresh.interrupted, undefined, "the new attempt is not marked interrupted");
});

test("a later sweep leaves the job this process is running alone", async () => {
  fs.writeFileSync(JOBS_FILE, JSON.stringify({ jobs: [row("job_live", users.alice, { status: "queued" })] }, null, 2));
  finishAllRuns(); // free the worker from the runs earlier tests started
  const deadline = Date.now() + 5000;
  while (readJobs().find((j) => j.id === "job_live")?.status !== "running") {
    assert.ok(Date.now() < deadline, "the worker should pick the queued job up");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  jobsModule._recoverInterruptedJobsForTest();
  const job = readJobs().find((j) => j.id === "job_live");
  assert.equal(job.status, "running");
  assert.equal(job.interrupted, undefined);
});
