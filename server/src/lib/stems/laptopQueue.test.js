import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  configureLaptopQueue, enqueueLaptopJob, claimNext, heldJob, reportProgress,
  failLaptopJob, cancelLaptopJob, loadLaptopQueue, laptopOnline, laptopQueueEnabled,
  LEASE_MS, ONLINE_MS, MAX_ATTEMPTS, _resetLaptopQueue,
} from "./laptopQueue.js";
import { _resetStemJobs, getStemJob, listStemJobs } from "./stemJobs.js";

function fields(over = {}) {
  return {
    jobId: over.jobId || `j-${Math.random().toString(36).slice(2)}`,
    userId: "u1", sourceRef: "mylib:t1", sourcePreview: "song.mp3", resultPath: "/out/instrumental-x.m4a",
    sourceLabel: "Song", sourceMood: "calm", sourceLicence: "unknown", sourceCredit: "",
    input: "/out/song.mp3", quality: "best", dataDir: "/data", outputDir: "/out", ...over,
  };
}

let dir;
beforeEach(() => {
  _resetStemJobs();
  _resetLaptopQueue();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-laptopq-"));
  configureLaptopQueue({ file: path.join(dir, "stems-queue.json") });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("laptop queue", () => {
  test("a queued job waits for the laptop and is saved to disk", () => {
    const job = enqueueLaptopJob(fields({ jobId: "a" }));
    assert.equal(job.status, "queued");
    assert.equal(job.where, "laptop");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "stems-queue.json"), "utf8"));
    assert.deepEqual(saved.map((r) => r.jobId), ["a"]);
    assert.equal(saved[0].input, "/out/song.mp3");
  });

  test("claiming leases the oldest job and marks the laptop online", () => {
    enqueueLaptopJob(fields({ jobId: "first" }));
    enqueueLaptopJob(fields({ jobId: "second" }));
    const now = 1_000_000;
    assert.equal(laptopOnline(now), false);
    const job = claimNext(now);
    assert.equal(job.jobId, "first");
    assert.equal(job.status, "running");
    assert.equal(job.leaseUntil, now + LEASE_MS);
    assert.equal(job.attempts, 1);
    assert.equal(laptopOnline(now + ONLINE_MS - 1), true);
    assert.equal(laptopOnline(now + ONLINE_MS + 1), false);
    assert.equal(claimNext(now).jobId, "second");
    assert.equal(claimNext(now), null);
  });

  test("only a job under a live lease is held", () => {
    enqueueLaptopJob(fields({ jobId: "a" }));
    const now = 5_000;
    assert.equal(heldJob("a", now), null, "not claimed yet");
    claimNext(now);
    assert.equal(heldJob("a", now).jobId, "a");
    assert.equal(heldJob("a", now + LEASE_MS + 1), null);
  });

  test("progress renews the lease and caps below 100", () => {
    enqueueLaptopJob(fields({ jobId: "a" }));
    const job = claimNext(0);
    const r = reportProgress(job, 140, 60_000);
    assert.deepEqual(r, { cancelled: false });
    assert.equal(job.percent, 99);
    assert.equal(job.leaseUntil, 60_000 + LEASE_MS);
  });

  test("an expired lease goes back to the queue, and fails after the last attempt", () => {
    enqueueLaptopJob(fields({ jobId: "a" }));
    let t = 0;
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      assert.equal(claimNext(t).jobId, "a");
      t += LEASE_MS + 1;
      // the next claim first returns the stale job to the queue
    }
    assert.equal(claimNext(t).attempts, MAX_ATTEMPTS);
    t += LEASE_MS + 1;
    assert.equal(claimNext(t), null);
    const job = getStemJob("a", "u1");
    assert.equal(job.status, "error");
    assert.match(job.error, /laptop stopped responding/i);
  });

  test("cancelling a queued job fails it at once; a running one tells the worker to stop", () => {
    const queued = enqueueLaptopJob(fields({ jobId: "q" }));
    cancelLaptopJob(queued);
    assert.equal(queued.status, "error");
    assert.equal(queued.error, "Cancelled.");
    assert.equal(claimNext(0), null, "a cancelled job is never handed out");

    const running = enqueueLaptopJob(fields({ jobId: "r" }));
    claimNext(0);
    cancelLaptopJob(running);
    assert.deepEqual(reportProgress(running, 50, 1), { cancelled: true });
    assert.equal(heldJob("r", 1), null);
  });

  test("a failure from the laptop is recorded, trimmed", () => {
    const job = enqueueLaptopJob(fields({ jobId: "a" }));
    claimNext(0);
    failLaptopJob(job, "x".repeat(1000));
    assert.equal(job.status, "error");
    assert.equal(job.error.length, 300);
  });

  test("a restart reloads waiting and interrupted jobs as queued", () => {
    enqueueLaptopJob(fields({ jobId: "waiting" }));
    enqueueLaptopJob(fields({ jobId: "busy" }));
    claimNext(0);
    const done = enqueueLaptopJob(fields({ jobId: "failed" }));
    failLaptopJob(done, "boom");
    _resetStemJobs();
    _resetLaptopQueue();
    configureLaptopQueue({ file: path.join(dir, "stems-queue.json") });
    loadLaptopQueue();
    const ids = listStemJobs().map((j) => `${j.jobId}:${j.status}`);
    assert.deepEqual(ids.sort(), ["busy:queued", "waiting:queued"]);
    assert.equal(getStemJob("waiting", "u1").controller.signal.aborted, false);
  });

  test("a missing or broken queue file loads as empty", () => {
    loadLaptopQueue();
    fs.writeFileSync(path.join(dir, "stems-queue.json"), "{not json");
    loadLaptopQueue();
    assert.equal(listStemJobs().length, 0);
  });

  test("the queue is on only with a worker key of 32+ characters", () => {
    assert.equal(laptopQueueEnabled({}), false);
    assert.equal(laptopQueueEnabled({ STEMS_WORKER_TOKEN: "short" }), false);
    assert.equal(laptopQueueEnabled({ STEMS_WORKER_TOKEN: "k".repeat(32) }), true);
  });
});
