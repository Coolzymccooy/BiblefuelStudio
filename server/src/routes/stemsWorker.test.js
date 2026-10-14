import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import stemsWorkerRouter, { _setResultProbe, _resetResultProbe } from "./stemsWorker.js";
import {
  configureLaptopQueue, enqueueLaptopJob, cancelLaptopJob, _resetLaptopQueue, FAILED_ON_LAPTOP,
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

// A lyric-video vocals job: the same queue, a different result name, never a library track.
function queueVocals(over = {}) {
  const jobId = over.jobId || "vocals-1";
  return queueOne({
    jobId, stem: "vocals", sourceRef: "lyric-video", sourcePreview: null, sourceLabel: "Song",
    resultPath: path.join(dir, "out", `lyric-vocals-${jobId}.m4a`), ...over,
  });
}
const claim = (body) => {
  const r = request(app()).post("/api/stems-worker/claim").set(auth);
  return body === undefined ? r : r.send(body);
};
const uploadResult = (jobId) => request(app()).post(`/api/stems-worker/jobs/${jobId}/result`).set(auth)
  .set("Content-Type", "audio/mp4").send(M4A);

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
    assert.deepEqual(r.body.job, { jobId: "job-1", quality: "best", sourceName: "song.mp3", stem: "instrumental" });
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
    assert.equal(job.error, FAILED_ON_LAPTOP, "the user sees a plain message; the detail goes to the server log");
  });

  test("a second upload for the same job is refused while the first is being saved", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    let release; const gate = new Promise((r) => { release = r; });
    _setResultProbe(async () => { await gate; return 180; });
    const first = request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    const second = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    // "Still saving the first one" is a come-back-shortly, so the laptop retries
    // (and then hears "already saved") instead of giving the job up.
    assert.equal(second.status, 503);
    assert.equal(second.headers["retry-after"], "5");
    const failDuring = await request(app()).post("/api/stems-worker/jobs/job-1/fail").set(auth).send({ error: "gave up" });
    assert.equal(failDuring.status, 200);
    assert.notEqual(getStemJob("job-1", "u1").status, "error", "a failure report cannot undo a save in progress");
    release();
    assert.equal((await first).status, 200);
    assert.equal(readMusicLibrary(dir).items.length, 1);
  });

  test("an unexpected save error does not reveal server paths", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    fs.rmSync(path.join(dir, "out"), { recursive: true, force: true });
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.body.error, /[\/]/);
  });

  test("a repeated upload for a job already saved is accepted, not added twice", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    const first = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(first.status, 200);
    // The reply to the first was lost on the way back; the laptop tries again.
    const again = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(again.status, 200);
    assert.equal(again.body.already, true);
    assert.equal(readMusicLibrary(dir).items.length, 1);
  });

  test("a job whose lease lapsed while the laptop was out of touch is handed back, not cancelled", async () => {
    queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    // The laptop's connection dropped for longer than the lease.
    const job = getStemJob("job-1", "u1");
    job.leaseUntil = Date.now() - 1;
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/progress").set(auth).send({ percent: 60 });
    assert.deepEqual(r.body, { ok: true, cancelled: false });
    assert.equal(job.status, "running");
    assert.ok(job.leaseUntil > Date.now());
    assert.equal(job.percent, 60);
  });

  test("a result for a job that went back to the queue is still accepted", async () => {
    const job = queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    job.leaseUntil = Date.now() - 1;
    await request(app()).post("/api/stems-worker/claim").set(auth); // requeues the lapsed job, then re-leases it
    job.leaseUntil = Date.now() - 1;
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/result").set(auth).set("Content-Type", "audio/mp4").send(M4A);
    assert.equal(r.status, 200);
    assert.equal(getStemJob("job-1", "u1").status, "done");
  });

  test("a job the user cancelled is never handed back", async () => {
    const job = queueOne();
    await request(app()).post("/api/stems-worker/claim").set(auth);
    cancelLaptopJob(job);
    const r = await request(app()).post("/api/stems-worker/jobs/job-1/progress").set(auth).send({ percent: 60 });
    assert.equal(r.body.cancelled, true);
  });

  describe("vocals jobs", () => {
    test("a worker that sends no body never receives a vocals job, and still gets instrumental jobs", async () => {
      queueVocals({ createdAt: 1 });
      queueOne({ jobId: "inst-1", userId: "u2" });
      const r = await claim();
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.job, { jobId: "inst-1", quality: "best", sourceName: "song.mp3", stem: "instrumental" });
      assert.equal((await claim()).body.job, null, "only the vocals job is left, and this worker cannot take it");
      assert.equal(getStemJob("vocals-1", "u1").status, "queued");
    });

    test("a worker that sends an empty or unrelated body gets no vocals job", async () => {
      queueVocals();
      for (const body of [{}, { caps: [] }, { other: ["vocals"] }]) {
        const r = await claim(body);
        assert.equal(r.status, 200);
        assert.equal(r.body.job, null);
      }
    });

    test("a vocals-capable worker is handed the vocals job, labelled as such", async () => {
      queueVocals();
      const r = await claim({ caps: ["vocals"] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.job, { jobId: "vocals-1", quality: "best", sourceName: "song.mp3", stem: "vocals" });
    });

    test("a caps value of the wrong shape means no caps, never a 500", async () => {
      queueVocals();
      const bad = [
        { caps: "vocals" }, { caps: { 0: "vocals" } }, { caps: null }, { caps: 7 },
        { caps: [{ toString: "vocals" }] }, { caps: [["vocals"]] }, { caps: [7, null] },
        { caps: ["x".repeat(500), "vocals".padEnd(40, " ")] },
        [], "vocals",
      ];
      for (const body of bad) {
        const r = await claim(body);
        assert.equal(r.status, 200, JSON.stringify(body));
        assert.equal(r.body.job, null, JSON.stringify(body));
      }
      assert.equal(getStemJob("vocals-1", "u1").status, "queued");
    });

    test("only the first few caps are read", async () => {
      queueVocals();
      const caps = [...Array(8).fill("a"), "vocals"];
      assert.equal((await claim({ caps })).body.job, null);
    });

    test("a vocals result is stored but not added to the music library", async () => {
      const job = queueVocals();
      await claim({ caps: ["vocals"] });
      const r = await uploadResult("vocals-1");
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true });
      const done = getStemJob("vocals-1", "u1");
      assert.equal(done.status, "done");
      assert.equal(done.percent, 100);
      assert.equal(done.resultFile, job.resultPath);
      assert.equal(path.basename(done.resultFile), "lyric-vocals-vocals-1.m4a");
      assert.ok(done.finishedAt > 0);
      assert.equal(done.track, undefined, "no library track");
      assert.equal(fs.existsSync(job.resultPath), true, "the file is kept for the lyric video");
      assert.equal(fs.existsSync(`${job.resultPath}.upload`), false, "no temp file left behind");
      assert.equal(readMusicLibrary(dir).items.length, 0, "the music library has no new track");
    });

    test("a repeated vocals upload is accepted without a second write", async () => {
      queueVocals();
      await claim({ caps: ["vocals"] });
      assert.equal((await uploadResult("vocals-1")).status, 200);
      const again = await uploadResult("vocals-1");
      assert.equal(again.status, 200);
      assert.equal(again.body.already, true);
      assert.equal(readMusicLibrary(dir).items.length, 0);
    });

    test("a vocals result that is not audio is refused and no file is kept", async () => {
      const job = queueVocals();
      await claim({ caps: ["vocals"] });
      _setResultProbe(async () => { throw new Error("Invalid data"); });
      const r = await uploadResult("vocals-1");
      assert.equal(r.status, 400);
      assert.equal(fs.existsSync(job.resultPath), false);
      assert.equal(getStemJob("vocals-1", "u1").status, "running");
    });

    test("an instrumental job's result is still saved to the library", async () => {
      queueOne();
      await claim({ caps: ["vocals"] });
      assert.equal((await uploadResult("job-1")).status, 200);
      assert.equal(readMusicLibrary(dir).items.length, 1);
      assert.equal(getStemJob("job-1", "u1").resultFile, undefined);
    });

    test("progress from a vocals job renews its lease like any other", async () => {
      queueVocals();
      await claim({ caps: ["vocals"] });
      const r = await request(app()).post("/api/stems-worker/jobs/vocals-1/progress").set(auth).send({ percent: 30 });
      assert.deepEqual(r.body, { ok: true, cancelled: false });
    });
  });
});
