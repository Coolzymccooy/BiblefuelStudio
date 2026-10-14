// server/src/lib/lyricVideo/vocalStem.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { requestVocalStem } from "./vocalStem.js";
import { claimNext, queueRoomFor, MAX_WAITING_PER_USER, enqueueLaptopJob, _resetLaptopQueue } from "../stems/laptopQueue.js";
import { _resetStemJobs, listStemJobs, updateStemJob } from "../stems/stemJobs.js";

const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };
const base = (over = {}) => ({ userId: "u1", input: "/out/song.m4a", dataDir: "/d", outputDir: "/out", pollMs: 2000, timeoutMs: 240_000, ...over });
const live = (id, over = {}) => ({ jobId: id, status: "queued", ...over });
const ready = (over = {}) => ({ enabled: () => true, laptopOnline: () => true, queueRoomFor: () => true, exists: () => true, ...over });

describe("requestVocalStem with fakes", () => {
  test("no capable laptop → null at once, nothing queued, no waiting", async () => {
    let queued = 0;
    const clock = fakeClock();
    const out = await requestVocalStem(base({ deps: { ...clock, ...ready({ laptopOnline: () => false }), enqueue: () => { queued++; } } }));
    assert.equal(out, null);
    assert.equal(queued, 0);
    assert.equal(clock.now(), 0, "it did not wait");
  });

  test("the queue is switched off → null, nothing queued", async () => {
    let queued = 0;
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready({ enabled: () => false }), enqueue: () => { queued++; } } }));
    assert.equal(out, null);
    assert.equal(queued, 0);
  });

  test("no room in the queue → null at once, nothing queued, no waiting", async () => {
    let queued = 0;
    const clock = fakeClock();
    const out = await requestVocalStem(base({ deps: { ...clock, ...ready({ queueRoomFor: (u) => { assert.equal(u, "u1"); return false; } }), enqueue: () => { queued++; } } }));
    assert.equal(out, null);
    assert.equal(queued, 0);
    assert.equal(clock.now(), 0);
  });

  test("a finished vocals job → its file, and nothing is cancelled", async () => {
    let polls = 0;
    let cancelled = 0;
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready(),
      enqueue: (f) => { assert.equal(f.stem, "vocals"); assert.equal(f.input, "/out/song.m4a"); assert.match(path.basename(f.resultPath), /^lyric-vocals-[\w-]+\.m4a$/); return live("j1", { resultPath: f.resultPath }); },
      getJob: () => (++polls < 3 ? { status: "running" } : { status: "done", resultFile: "/out/lyric-vocals-j1.m4a" }),
      cancel: () => { cancelled++; } } }));
    assert.equal(out, "/out/lyric-vocals-j1.m4a");
    assert.equal(cancelled, 0);
  });

  test("a finished job whose file is gone → null", async () => {
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready({ exists: () => false }),
      enqueue: (f) => live("j1", { resultPath: f.resultPath }), getJob: () => ({ status: "done", resultFile: "/out/lyric-vocals-j1.m4a" }) } }));
    assert.equal(out, null);
  });

  test("not ready in 4 minutes → null and the job object is cancelled", async () => {
    const clock = fakeClock();
    let cancelled = null;
    const job = live("j2");
    const out = await requestVocalStem(base({ deps: { ...clock, ...ready(), enqueue: () => job, getJob: () => ({ status: "running" }), cancel: (j) => { cancelled = j; } } }));
    assert.equal(out, null);
    assert.equal(cancelled, job, "cancel takes the job object");
    assert.ok(clock.now() >= 240_000);
  });

  test("a failed job → null; it is already over, so there is nothing to cancel", async () => {
    let cancelled = 0;
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready(),
      enqueue: () => live("j3"), getJob: () => ({ status: "error", error: "boom" }), cancel: () => { cancelled++; } } }));
    assert.equal(out, null);
    assert.equal(cancelled, 0);
  });

  test("a job the user cancelled (status error, 'Cancelled.') → null", async () => {
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready(),
      enqueue: () => live("j3"), getJob: () => ({ status: "error", error: "Cancelled." }) } }));
    assert.equal(out, null);
  });

  test("an abort while waiting → null and the job is cancelled", async () => {
    const ctrl = new AbortController();
    const job = live("j4");
    let cancelled = null;
    let polls = 0;
    const out = await requestVocalStem(base({ signal: ctrl.signal, deps: { ...fakeClock(), ...ready(), enqueue: () => job,
      getJob: () => { if (++polls === 2) ctrl.abort(); return { status: "running" }; }, cancel: (j) => { cancelled = j; } } }));
    assert.equal(out, null);
    assert.equal(cancelled, job);
  });

  test("an abort before anything is queued → null, nothing queued", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let queued = 0;
    const out = await requestVocalStem(base({ signal: ctrl.signal, deps: { ...fakeClock(), ...ready(), enqueue: () => { queued++; return live("x"); } } }));
    assert.equal(out, null);
    assert.equal(queued, 0);
  });

  test("an error inside the wait loop cancels the job, then surfaces", async () => {
    const job = live("j5");
    let cancelled = null;
    await assert.rejects(
      requestVocalStem(base({ deps: { ...fakeClock(), ...ready(), enqueue: () => job, getJob: () => { throw new Error("store exploded"); }, cancel: (j) => { cancelled = j; } } })),
      /store exploded/,
    );
    assert.equal(cancelled, job, "the slot is released on every path");
  });

  test("a sleep that throws also cancels the job", async () => {
    const job = live("j6");
    let cancelled = null;
    await assert.rejects(
      requestVocalStem(base({ deps: { now: () => 0, sleep: async () => { throw new Error("timer broke"); }, ...ready(), enqueue: () => job, getJob: () => ({ status: "running" }), cancel: (j) => { cancelled = j; } } })),
      /timer broke/,
    );
    assert.equal(cancelled, job);
  });

  test("a cancel that itself throws does not hide the outcome", async () => {
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready(), enqueue: () => live("j7"), getJob: () => ({ status: "running" }), cancel: () => { throw new Error("cancel broke"); } } }));
    assert.equal(out, null);
  });

  test("a job that vanished from the store → null", async () => {
    const out = await requestVocalStem(base({ deps: { ...fakeClock(), ...ready(), enqueue: () => live("j8"), getJob: () => null } }));
    assert.equal(out, null);
  });
});

describe("requestVocalStem on the real laptop queue", () => {
  const TOKEN = "k".repeat(40);
  let savedToken;
  beforeEach(() => { _resetStemJobs(); _resetLaptopQueue(); savedToken = process.env.STEMS_WORKER_TOKEN; process.env.STEMS_WORKER_TOKEN = TOKEN; });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.STEMS_WORKER_TOKEN; else process.env.STEMS_WORKER_TOKEN = savedToken;
    _resetStemJobs(); _resetLaptopQueue();
  });

  test("an older laptop worker (no vocals capability) polling → no wait, nothing queued", async () => {
    claimNext(Date.now()); // online, but cannot return vocals
    const clock = fakeClock();
    const out = await requestVocalStem(base({ deps: { ...clock, exists: () => true } }));
    assert.equal(out, null);
    assert.equal(listStemJobs().length, 0);
    assert.equal(clock.now(), 0);
  });

  test("a full queue for this user → no wait, nothing more queued", async () => {
    claimNext(Date.now(), { caps: ["vocals"] });
    for (let i = 0; i < MAX_WAITING_PER_USER; i += 1) {
      enqueueLaptopJob({ jobId: `i${i}`, userId: "u1", sourceRef: "lyric-video", sourcePreview: null, resultPath: `/out/instrumental-i${i}.m4a`, sourceLabel: "s", input: "/out/s.m4a", quality: "best", dataDir: "/d", outputDir: "/out" });
    }
    assert.equal(queueRoomFor("u1"), false);
    const clock = fakeClock();
    const out = await requestVocalStem(base({ deps: { ...clock, exists: () => true } }));
    assert.equal(out, null);
    assert.equal(listStemJobs().length, MAX_WAITING_PER_USER);
    assert.equal(clock.now(), 0);
  });

  test("a vocals-capable laptop: queues a vocals job and returns its file once done", async () => {
    claimNext(Date.now(), { caps: ["vocals"] });
    let slept = 0;
    const out = await requestVocalStem(base({ deps: {
      now: () => slept * 2000, exists: () => true,
      sleep: async () => {
        slept += 1;
        const [job] = listStemJobs();
        if (slept === 2) updateStemJob(job.jobId, { status: "done", percent: 100, resultFile: job.resultPath });
      },
    } }));
    const [job] = listStemJobs();
    assert.equal(job.stem, "vocals");
    assert.equal(job.where, "laptop");
    assert.equal(out, job.resultPath);
  });

  test("timing out cancels the real job, freeing the user's slot", async () => {
    claimNext(Date.now(), { caps: ["vocals"] });
    const clock = fakeClock();
    const out = await requestVocalStem(base({ deps: { ...clock, exists: () => true } }));
    assert.equal(out, null);
    const [job] = listStemJobs();
    assert.equal(job.status, "error");
    assert.equal(job.error, "Cancelled.");
    assert.equal(job.controller.signal.aborted, true);
    assert.equal(queueRoomFor("u1"), true);
  });
});
