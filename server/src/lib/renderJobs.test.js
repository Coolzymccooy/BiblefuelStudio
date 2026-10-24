import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createJob, markRunning, markDone, markError, getJob, _resetJobs,
  persistJob, reconcilePersistedJobs, reconcileAllPersistedJobs, readPersistedJob,
  attachProc, cancelJob, gcJobs,
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

  test("reconcileAllPersistedJobs covers the owner and every user's renders", () => {
    const owner = createJob("owner", { durationSec: 5 });
    persistJob(baseDir, { ...owner, projectId: "o", status: "running" });
    const userDir = path.join(baseDir, "users", "u-2");
    const theirs = createJob("u-2", { durationSec: 5 });
    persistJob(userDir, { ...theirs, projectId: "t", status: "queued" });
    const finished = createJob("u-2", { durationSec: 5 });
    persistJob(userDir, { ...finished, projectId: "f", status: "done" });
    fs.writeFileSync(path.join(baseDir, "users", "stray.txt"), "not a user folder");

    const changed = reconcileAllPersistedJobs(baseDir);
    assert.equal(readPersistedJob(baseDir, owner.jobId).status, "interrupted");
    assert.equal(readPersistedJob(userDir, theirs.jobId).status, "interrupted", "another user's render is no longer stuck as running");
    assert.equal(readPersistedJob(userDir, finished.jobId).status, "done");
    assert.deepEqual(changed.map((c) => c.jobId).sort(), [owner.jobId, theirs.jobId].sort());
    assert.deepEqual(reconcileAllPersistedJobs(path.join(baseDir, "nowhere")), [], "a missing data folder is fine");
  });

  test("in-memory job API still works (back-compat)", () => {
    const job = createJob("user-1", { durationSec: 10 });
    markRunning(job.jobId);
    markDone(job.jobId, "/tmp/out.mp4");
    assert.equal(getJob(job.jobId).status, "done");
  });
});

describe("gcJobs", () => {
  const HOUR = 60 * 60 * 1000;
  test("queued and running records outlive the terminal TTL, up to 12 h", () => {
    const now = Date.now();
    const queued = createJob("user-1", { durationSec: 20 });
    queued.updatedAt = now - 2 * HOUR;
    const running = createJob("user-1", { durationSec: 20 });
    markRunning(running.jobId);
    running.updatedAt = now - 13 * HOUR;
    const failed = createJob("user-1", { durationSec: 20 });
    markError(failed.jobId, "boom");
    failed.updatedAt = now - 2 * HOUR;
    const fresh = createJob("user-1", { durationSec: 20 });
    gcJobs(now);
    assert.ok(getJob(queued.jobId), "a queued record 2 h old survives");
    assert.equal(getJob(failed.jobId), null, "an error record 2 h old is removed");
    assert.equal(getJob(running.jobId), null, "a running record 13 h old is removed");
    assert.ok(getJob(fresh.jobId));
  });
});
