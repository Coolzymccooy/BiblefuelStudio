import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// jobs.js reads DATA_DIR at import time, so set it before importing the router.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-enqueue-ap-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: jobsRouter } = await import("../../src/routes/jobs.js");

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");
const USER = { userId: "u_enq", dataDir: path.join(root, "users", "u_enq"), plan: "premium" };
fs.mkdirSync(USER.dataDir, { recursive: true });
// An unreachable remote background passes validation and fails fast in the worker.
const PAYLOAD = { backgroundPath: "http://127.0.0.1:1/bg.mp4", lines: ["The Lord is my shepherd"] };

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { ...USER, outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
    next();
  });
  a.use("/api/jobs", jobsRouter);
  return a;
}

const rowFor = (id) => JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs.find((j) => j.id === id);

test("enqueue with { autoPublish: false } marks the job suppressAutoPublish", async () => {
  const res = await request(app()).post("/api/jobs/enqueue").send({ type: "render_video", payload: PAYLOAD, autoPublish: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.job.suppressAutoPublish, true);
  assert.equal(rowFor(res.body.job.id).suppressAutoPublish, true);
});

test("enqueue without autoPublish leaves suppressAutoPublish off", async () => {
  const res = await request(app()).post("/api/jobs/enqueue").send({ type: "render_video", payload: PAYLOAD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(rowFor(res.body.job.id).suppressAutoPublish, undefined);
});

test("only a literal false suppresses: autoPublish \"false\" or 0 does not", async () => {
  for (const autoPublish of ["false", 0, null]) {
    const res = await request(app()).post("/api/jobs/enqueue").send({ type: "render_video", payload: PAYLOAD, autoPublish });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(rowFor(res.body.job.id).suppressAutoPublish, undefined);
  }
});

test("suppressAutoPublish inside the payload is not how it is set", async () => {
  const res = await request(app())
    .post("/api/jobs/enqueue")
    .send({ type: "render_video", payload: { ...PAYLOAD, suppressAutoPublish: true } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(rowFor(res.body.job.id).suppressAutoPublish, undefined);
});
