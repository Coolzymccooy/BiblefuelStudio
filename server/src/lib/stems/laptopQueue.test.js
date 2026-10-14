import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  configureLaptopQueue, enqueueLaptopJob, claimNext, heldJob, reportProgress,
  failLaptopJob, cancelLaptopJob, loadLaptopQueue, laptopOnline, laptopQueueEnabled,
  LEASE_MS, ONLINE_MS, MAX_ATTEMPTS, _resetLaptopQueue, queueRoomFor, MAX_WAITING_PER_USER, MAX_WAITING,
  FAILED_ON_LAPTOP,
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
    failLaptopJob(job, "C:\Users\someone\AppData\Temp\bf-stems-1 Traceback ...");
    assert.equal(job.status, "error");
    assert.equal(job.error, FAILED_ON_LAPTOP, "users see a plain message, not laptop paths");
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

  test("each user may have only a few jobs waiting, and the queue as a whole is capped", () => {
    for (let i = 0; i < MAX_WAITING_PER_USER; i += 1) enqueueLaptopJob(fields({ jobId: `u1-${i}` }));
    assert.equal(queueRoomFor("u1"), false);
    assert.equal(queueRoomFor("u2"), true);
    for (let i = 0; i < MAX_WAITING; i += 1) enqueueLaptopJob(fields({ jobId: `x-${i}`, userId: `other-${i}` }));
    assert.equal(queueRoomFor("u3"), false);
  });

  test("the laptop takes turns between users rather than draining one user's backlog first", () => {
    enqueueLaptopJob(fields({ jobId: "a1", userId: "a", createdAt: 1 }));
    enqueueLaptopJob(fields({ jobId: "a2", userId: "a" }));
    enqueueLaptopJob(fields({ jobId: "b1", userId: "b" }));
    assert.equal(claimNext(0).jobId, "a1");
    assert.equal(claimNext(0).jobId, "b1", "b has had no turn yet");
    assert.equal(claimNext(0).jobId, "a2");
  });

  test("a reloaded row whose paths leave its own folders is dropped", () => {
    const file = path.join(dir, "stems-queue.json");
    const good = { ...fields({ jobId: "ok" }), resultPath: "/out/instrumental-ok.m4a", input: "/out/song.mp3" };
    const badResult = { ...fields({ jobId: "bad1" }), resultPath: "/etc/cron.d/x" };
    const badInput = { ...fields({ jobId: "bad2" }), input: "/etc/passwd" };
    fs.writeFileSync(file, JSON.stringify([good, badResult, badInput]));
    loadLaptopQueue();
    assert.deepEqual(listStemJobs().map((j) => j.jobId), ["ok"]);
  });

  test("finished laptop jobs are forgotten after a day", () => {
    const job = enqueueLaptopJob(fields({ jobId: "old" }));
    claimNext(0);
    failLaptopJob(job, "x", { now: 0 });
    claimNext(25 * 3_600_000);
    assert.equal(listStemJobs().length, 0);
  });
});

describe("vocals jobs and the capability handshake", () => {
  const vocalsFields = (id, over = {}) => fields({ jobId: id, sourceRef: "lyric-video", sourcePreview: null, stem: "vocals", resultPath: `/out/lyric-vocals-${id}.m4a`, ...over });
  const reload = () => {
    _resetStemJobs();
    _resetLaptopQueue();
    configureLaptopQueue({ file: path.join(dir, "stems-queue.json") });
    loadLaptopQueue();
  };

  test("a job is an instrumental job unless it asks for vocals", () => {
    assert.equal(enqueueLaptopJob(fields({ jobId: "a" })).stem, "instrumental");
    assert.equal(enqueueLaptopJob(fields({ jobId: "b", stem: "drums" })).stem, "instrumental");
    assert.equal(enqueueLaptopJob(vocalsFields("c")).stem, "vocals");
  });

  test("claimNext skips vocals jobs for workers without the vocals capability", () => {
    const job = enqueueLaptopJob(vocalsFields("j1"));
    assert.equal(claimNext(Date.now()), null, "an old worker gets nothing");
    assert.equal(job.status, "queued", "and the job is still waiting");
    assert.equal(claimNext(Date.now(), { caps: ["vocals"] })?.jobId, job.jobId);
  });

  test("an old worker still gets instrumental jobs queued behind a vocals job", () => {
    enqueueLaptopJob(vocalsFields("v-first", { createdAt: 1 }));
    enqueueLaptopJob(fields({ jobId: "inst", userId: "u2" }));
    assert.equal(claimNext(10)?.jobId, "inst");
    assert.equal(claimNext(10), null);
    assert.equal(claimNext(10, { caps: [] }), null);
    assert.equal(claimNext(10, { caps: ["something-else"] }), null);
  });

  test("a vocals-capable worker takes instrumental jobs too", () => {
    enqueueLaptopJob(fields({ jobId: "inst" }));
    assert.equal(claimNext(10, { caps: ["vocals"] })?.jobId, "inst");
  });

  test("a caps value that is not a list grants nothing", () => {
    enqueueLaptopJob(vocalsFields("j1"));
    assert.equal(claimNext(5, { caps: "vocals" }), null);
    assert.equal(claimNext(5, { caps: { includes: () => true } }), null);
    assert.equal(claimNext(5, { caps: null }), null);
    assert.equal(laptopOnline(6, { needs: "vocals" }), false);
  });

  test("laptopOnline can ask for a vocals-capable worker", () => {
    claimNext(1_000); // an old worker polled
    assert.equal(laptopOnline(2_000), true);
    assert.equal(laptopOnline(2_000, { needs: "vocals" }), false);
    claimNext(3_000, { caps: ["vocals"] });
    assert.equal(laptopOnline(4_000, { needs: "vocals" }), true);
    assert.equal(laptopOnline(3_000 + ONLINE_MS + 1, { needs: "vocals" }), false);
  });

  test("an old worker polling later does not make the laptop look vocals-capable", () => {
    claimNext(1_000, { caps: ["vocals"] });
    claimNext(1_000 + ONLINE_MS, {}); // the vocals-capable worker went away; an old one is polling
    assert.equal(laptopOnline(1_000 + ONLINE_MS + 5, { needs: "vocals" }), false);
    assert.equal(laptopOnline(1_000 + ONLINE_MS + 5), true);
  });

  test("a vocals worker busy on a long job stays online through its progress reports", () => {
    const job = enqueueLaptopJob(vocalsFields("j1"));
    claimNext(0, { caps: ["vocals"] });
    reportProgress(job, 40, ONLINE_MS + 10_000);
    assert.equal(laptopOnline(ONLINE_MS + 10_001, { needs: "vocals" }), true);
  });

  test("a persisted vocals job survives a reload", () => {
    enqueueLaptopJob(vocalsFields("v1"));
    reload();
    const back = getStemJob("v1", "u1");
    assert.equal(back.stem, "vocals");
    assert.equal(back.status, "queued");
    assert.equal(back.resultPath, "/out/lyric-vocals-v1.m4a");
    assert.equal(claimNext(0), null, "still hidden from an old worker after the reload");
    assert.equal(claimNext(0, { caps: ["vocals"] })?.jobId, "v1");
  });

  test("a persisted job without a stem loads as an instrumental job", () => {
    const { stem, ...legacy } = fields({ jobId: "old", resultPath: "/out/instrumental-old.m4a" });
    fs.writeFileSync(path.join(dir, "stems-queue.json"), JSON.stringify([legacy]));
    reload();
    assert.equal(getStemJob("old", "u1").stem, "instrumental");
    assert.equal(claimNext(0)?.jobId, "old", "an old worker may take it");
  });

  test("a reloaded row's result name must match its stem", () => {
    const rows = [
      vocalsFields("v-ok"),
      fields({ jobId: "i-ok", resultPath: "/out/instrumental-i-ok.m4a" }),
      vocalsFields("v-bad", { resultPath: "/out/instrumental-v-bad.m4a" }),
      fields({ jobId: "i-bad", resultPath: "/out/lyric-vocals-i-bad.m4a" }),
      vocalsFields("v-evil", { resultPath: "/out/lyric-vocals-x.mp3" }),
    ];
    fs.writeFileSync(path.join(dir, "stems-queue.json"), JSON.stringify(rows));
    reload();
    assert.deepEqual(listStemJobs().map((j) => j.jobId).sort(), ["i-ok", "v-ok"]);
  });
});
