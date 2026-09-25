import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createJob, markRunning, markDone, markError, getJob, _resetJobs,
  persistJob, reconcilePersistedJobs, readPersistedJob,
  attachProc, cancelJob,
} from "./renderJobs.js";

let baseDir;
beforeEach(() => {
  _resetJobs();
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-jobs-"));
});
afterEach(() => fs.rmSync(baseDir, { recursive: true, force: true }));

describe("cancelJob", () => {
  test("kills the attached proc and marks the job cancelled", () => {
    const job = createJob("user-1", { durationSec: 20 });
    markRunning(job.jobId);
    let killed = null;
    attachProc(job.jobId, { kill: (sig) => { killed = sig; } });
    const result = cancelJob(job.jobId, "user-1");
    assert.equal(result.ok, true);
    assert.equal(killed, "SIGKILL");
    const rec = getJob(job.jobId);
    assert.equal(rec.status, "error");
    assert.equal(rec.error, "Render cancelled");
    assert.equal(rec.cancelled, true);
  });

  test("a cancelled job keeps its message even if ffmpeg errors afterward", () => {
    const job = createJob("user-1", { durationSec: 20 });
    markRunning(job.jobId);
    attachProc(job.jobId, { kill: () => {} });
    cancelJob(job.jobId, "user-1");
    markError(job.jobId, "ffmpeg exited 255"); // the SIGKILL'd proc's late error
    assert.equal(getJob(job.jobId).error, "Render cancelled");
  });

  test("rejects another user and unknown/terminal jobs", () => {
    const job = createJob("user-1", { durationSec: 20 });
    markRunning(job.jobId);
    assert.equal(cancelJob(job.jobId, "user-2").reason, "forbidden");
    assert.equal(cancelJob("nope", "user-1").reason, "not_found");
    markDone(job.jobId, "/out/x.mp4");
    assert.equal(cancelJob(job.jobId, "user-1").reason, "terminal");
  });
});

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
