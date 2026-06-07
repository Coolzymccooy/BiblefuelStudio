import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createJob, markRunning, markDone, getJob, _resetJobs,
  persistJob, reconcilePersistedJobs, readPersistedJob,
} from "./renderJobs.js";

let baseDir;
beforeEach(() => {
  _resetJobs();
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-jobs-"));
});
afterEach(() => fs.rmSync(baseDir, { recursive: true, force: true }));

describe("durable render jobs", () => {
  test("persistJob writes a thin record to disk", () => {
    const job = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...job, projectId: "proj-1" });
    const rec = readPersistedJob(baseDir, job.jobId);
    assert.equal(rec.jobId, job.jobId);
    assert.equal(rec.projectId, "proj-1");
    assert.equal(rec.status, "queued");
  });

  test("reconcilePersistedJobs flips running/queued to interrupted", () => {
    const a = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...a, projectId: "p", status: "running" });
    const b = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...b, projectId: "p2", status: "done" });

    const changed = reconcilePersistedJobs(baseDir);
    assert.equal(readPersistedJob(baseDir, a.jobId).status, "interrupted");
    assert.equal(readPersistedJob(baseDir, b.jobId).status, "done"); // untouched
    assert.ok(changed.some((c) => c.jobId === a.jobId));
  });

  test("in-memory job API still works (back-compat)", () => {
    const job = createJob("user-1", { durationSec: 10 });
    markRunning(job.jobId);
    markDone(job.jobId, "/tmp/out.mp4");
    assert.equal(getJob(job.jobId).status, "done");
  });
});
