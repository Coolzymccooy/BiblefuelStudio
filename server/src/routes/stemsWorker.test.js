import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import stemsWorkerRouter, { _setResultProbe, _resetResultProbe } from "./stemsWorker.js";
import {
  configureLaptopQueue, enqueueLaptopJob, cancelLaptopJob, _resetLaptopQueue,
} from "../lib/stems/laptopQueue.js";
import { _resetStemJobs, getStemJob } from "../lib/stems/stemJobs.js";
import { readMusicLibrary } from "../lib/musicLibraryStore.js";

const KEY = "w".repeat(48);
const auth = { Authorization: `Bearer ${KEY}` };
// An MP4/M4A container starts with a box whose type is "ftyp".
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A "), Buffer.alloc(64, 1)]);

let dir; let previous;
function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/stems-worker", stemsWorkerRouter);
  return a;
}
function queueOne(over = {}) {
  const outputDir = path.join(dir, "out");
  fs.mkdirSync(outputDir, { recursive: true });
  const input = path.join(outputDir, "song.mp3");
  fs.writeFileSync(input, "ID3 the original song");
  const jobId = over.jobId || "job-1";
  return enqueueLaptopJob({
    jobId, userId: "u1", sourceRef: "mylib:t1", sourcePreview: "song.mp3",
    resultPath: path.join(outputDir, `instrumental-${jobId}.m4a`), sourceLabel: "Song", sourceMood: "calm",
    sourceLicence: "cleared", sourceCredit: "Choir X", input, quality: "best", dataDir: dir, outputDir, ...over,
  });
}

beforeEach(() => {
  previous = process.env.STEMS_WORKER_TOKEN;
  process.env.STEMS_WORKER_TOKEN = KEY;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-worker-"));
  configureLaptopQueue({ file: path.join(dir, "q.json") });
  _setResultProbe(async () => 180);
});
afterEach(() => {
  if (previous === undefined) delete process.env.STEMS_WORKER_TOKEN; else process.env.STEMS_WORKER_TOKEN = previous;
  _resetStemJobs(); _resetLaptopQueue(); _resetResultProbe();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("stems worker API", () => {
  test("refuses everything when no key is configured (fails closed)", async () => {
    delete process.env.STEMS_WORKER_TOKEN;
    const r = await request(app()).post("/api/stems-worker/claim").set(auth);
    assert.equal(r.status, 503);
  });

  test("refuses a short key even if it matches", async () => {
    process.env.STEMS_WORKER_TOKEN = "short";
    const r = await request(app()).post("/api/stems-worker/claim").set({ Authorization: "Bearer short" });
    assert.equal(r.status, 503);
  });

  test("refuses a wrong or missing key", async () => {
    assert.equal((await request(app()).post("/api/stems-worker/claim")).status, 401);
    const r = await request(app()).post("/api/stems-worker/claim").set({ Authorization: `Bearer ${"x".repeat(48)}` });
    assert.equal(r.status, 401);
  });

  test("claim hands out the waiting job, then nothing", async () => {
    queueOne();
    const r = await request(app()).post("/api/stems-worker/claim").set(auth);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.job, { jobId: "job-1", quality: "best", sourceName: "song.mp3" });
    const again = await request(app()).post("/api/stems-worker/claim").set(auth);
    assert.equal(again.body.job, null);
  });

  test("the source is served only for a job the laptop holds", async () => {
    queueOne();
    const before = await request(app()).get("/api/stems-worker/jobs/job-1/source").set(auth);
    assert.equal(before.status, 404);
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).get("/api/stems-worker/jobs/job-1/source").set(auth).buffer(true).parse((res, cb) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), "ID3 the original song");
  });

  test("progress is recorded and reports a cancel", async () => {
    const job = queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/progress").set(auth).send({ percent: 42 });
    assert.deepEqual(r.body, { ok: true, cancelled: false });
    assert.equal(getStemJob("job-1", "u1").percent, 42);
    cancelLaptopJob(job);
    const after = await request(app()).post("/api/stems-worker/jobs/job-1/progress").set(auth).send({ percent: 50 });
    assert.equal(after.body.cancelled, true);
  });

  test("a result is saved to the library with the original's licence and credit", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(r.status, 200);
    const job = getStemJob("job-1", "u1");
    assert.equal(job.status, "done");
    assert.equal(job.percent, 100);
    const [track] = readMusicLibrary(dir).items;
    assert.equal(track.label, "Song (instrumental)");
    assert.equal(track.licence, "cleared");
    assert.equal(track.credit, "Choir X");
    assert.equal(track.derivedFrom, "mylib:t1");
    assert.equal(path.basename(track.file), "instrumental-job-1.m4a", "the server names the file");
  });

  test("a result that is not an M4A is refused and nothing is kept", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(Buffer.from("<html>not audio</html>"));
    assert.equal(r.status, 400);
    assert.equal(fs.existsSync(path.join(dir, "out", "instrumental-job-1.m4a")), false);
    assert.equal(readMusicLibrary(dir).items.length, 0);
  });

  test("a result that ffprobe cannot read is refused", async () => {
    _setResultProbe(async () => { throw new Error("Invalid data"); });
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(r.status, 400);
    assert.equal(fs.existsSync(path.join(dir, "out", "instrumental-job-1.m4a")), false);
  });

  test("a late result for a cancelled job is refused", async () => {
    const job = queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    cancelLaptopJob(job);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(r.status, 409);
    assert.equal(readMusicLibrary(dir).items.length, 0);
  });

  test("the laptop can report a failure", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/fail").set(auth).send({ error: "separator crashed" });
    assert.equal(r.status, 200);
    const job = getStemJob("job-1", "u1");
    assert.equal(job.status, "error");
    assert.match(job.error, /separator crashed/);
  });
});
