import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { momentRenderStage, cancelMomentRender, droppedNote, _setEngineForTest, _resetEngineForTest, STAGES } from "./renderStage.js";
import { createProject, readProject, writeProject } from "./projectStore.js";
import { createJob, getJob, cancelJob } from "../renderJobs.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let ctx;
let calls;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-stage-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  ctx = { dataDir, outputDir, userId: "u1" };
  calls = { prepare: 0, render: [] };
  _setEngineForTest({
    runFfmpeg: async (args) => { calls.prepare += 1; fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
    decode: async () => Buffer.alloc(11025 * 2 * 30),
    renderPlan: async (opts) => {
      calls.render.push(opts);
      assert.ok(fs.existsSync(opts.workDir), "the work dir exists during the render");
      opts.onProgress({ stage: "shots", fraction: 0.5 });
      opts.onProgress({ stage: "shots", fraction: 1 });
      opts.onProgress({ stage: "join", fraction: 1 });
      opts.onProgress({ stage: "finish", fraction: 1 });
      fs.writeFileSync(opts.out, "mp4");
      return { ok: true, file: opts.out };
    },
  });
});
afterEach(() => { _resetEngineForTest(); fs.rmSync(ctx.dataDir, { recursive: true, force: true }); });

function photo(buf = PNG) {
  const name = `bg-image-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(ctx.outputDir, name), buf);
  return { ref: { kind: "upload", path: name }, url: `/outputs/${name}`, width: 1, height: 1 };
}

function moment(over = {}) {
  const p = createProject(ctx.dataDir, { occasion: "birthday" });
  return writeProject(ctx.dataDir, {
    ...p, photos: [photo(), photo(), photo(), photo()], title: "Happy birthday",
    statements: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"], lengthSec: 15, seed: 9,
    render: { jobId: null, status: "running", percent: 0, stage: "waiting" }, ...over,
  });
}

function voiceName() { return `moment-vo-${crypto.randomUUID()}.mp3`; }

test("prepare → analyse → direct → render → history, with progress by stage", async () => {
  const p = moment();
  const job = createJob("u1", { durationSec: 15 });
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(done.render.percent, 100);
  assert.match(done.render.file, /^\/outputs\/moment-[0-9a-f-]{36}\.mp4$/);
  assert.equal(done.history.length, 1);
  assert.equal(done.history[0].seed, 9);
  assert.equal(calls.prepare, 4, "one working image per photo");
  assert.ok(done.plan && done.plan.shots.length > 0, "the plan is saved");
  assert.equal(getJob(job.jobId).status, "done");
  assert.ok(!fs.existsSync(calls.render[0].workDir), "the work dir is removed");
  assert.deepEqual(STAGES.shots, [20, 75]);
});

test("a running finish never shows 100% before the file is in place", async () => {
  const seen = [];
  _setEngineForTest({
    runFfmpeg: async (args) => { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
    decode: async () => Buffer.alloc(11025 * 2 * 30),
    renderPlan: async (opts) => {
      opts.onProgress({ stage: "finish", fraction: 0.99 });
      seen.push(readProject(ctx.dataDir, p.projectId).render.percent);
      opts.onProgress({ stage: "finish", fraction: 1 });
      fs.writeFileSync(opts.out, "mp4");
      return { ok: true, file: opts.out };
    },
  });
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.ok(seen[0] <= 99, `running finish showed ${seen[0]}%`);
  assert.equal(readProject(ctx.dataDir, p.projectId).render.percent, 100);
});

test("only the length's share of statements is used (15 s → 3)", async () => {
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const caps = readProject(ctx.dataDir, p.projectId).plan.captions.map((c) => c.text);
  assert.deepEqual(caps, ["Happy birthday", "One", "Two", "Three"].filter((t) => caps.includes(t)));
  assert.ok(!caps.includes("Four"));
});

test("a Shuffle seed is stored with the render", async () => {
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, { seed: 1234 });
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.seed, 1234);
  assert.equal(done.plan.seed, 1234);
});

test("an unreadable photo is skipped and noted", async () => {
  const p = moment();
  fs.writeFileSync(path.join(ctx.outputDir, p.photos[2].ref.path), "garbage");
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done");
  assert.match(done.render.notes.join(" "), /Photo 3/);
  assert.equal(calls.prepare, 3);
});

test("fewer than 3 readable photos fails with a clear message", async () => {
  const p = moment();
  for (const ph of p.photos.slice(1)) fs.writeFileSync(path.join(ctx.outputDir, ph.ref.path), "garbage");
  const job = createJob("u1", { durationSec: 15 });
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  const failed = readProject(ctx.dataDir, p.projectId);
  assert.equal(failed.render.status, "error");
  assert.match(failed.render.error, /Need at least 3 readable photos/);
  assert.equal(getJob(job.jobId).status, "error");
  assert.equal(calls.render.length, 0);
});

test("a render failure is recorded with the engine's friendly message", async () => {
  _setEngineForTest({ renderPlan: async () => ({ ok: false, error: "Rendering failed at shot 2 of 9.", detail: "No such filter" }) });
  const p = moment();
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const failed = readProject(ctx.dataDir, p.projectId);
  assert.equal(failed.render.status, "error");
  assert.equal(failed.render.error, "Rendering failed at shot 2 of 9.");
});

test("a song that is gone fails clearly, before any photo work", async () => {
  const p = moment({ sound: { song: { ref: "library:no-such-track", windowStartSec: null }, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const failed = readProject(ctx.dataDir, p.projectId);
  assert.match(failed.render.error, /That song is no longer available/);
  assert.equal(calls.prepare, 0, "no photo was prepared");
  assert.equal(calls.render.length, 0);
});

test("no song and no voiceover still renders on the pulse grid with silence", async () => {
  const p = moment({ sound: { song: null, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(readProject(ctx.dataDir, p.projectId).render.status, "done");
  assert.equal(calls.render[0].song, null);
  assert.equal(calls.render[0].voice, null);
});

test("the song plays from the analysed window", async () => {
  const p = moment({ sound: { song: { ref: "library:hopeful", windowStartSec: 7 }, voiceover: null } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(calls.render[0].song.startSec, 7);
});

// ---- R5: a missing or over-long voiceover is never fatal

test("a missing voiceover with no song renders without a voice and says so", async () => {
  const p = moment({ sound: { song: null, voiceover: { file: voiceName() } } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(calls.render[0].voice, null);
  assert.equal(calls.render[0].song, null);
  assert.match(done.render.notes.join(" "), /The voiceover was missing, so this Moment has no voice\. Make it again to add it back\./);
});

test("a missing voiceover with a song renders with the song and says so", async () => {
  const p = moment({ sound: { song: { ref: "library:hopeful", windowStartSec: 7 }, voiceover: { file: voiceName() } } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(calls.render[0].voice, null);
  assert.equal(calls.render[0].song.startSec, 7);
  assert.match(done.render.notes.join(" "), /voiceover was missing/);
});

test("a voiceover longer than the Moment is noted as cut", async () => {
  const name = voiceName();
  fs.writeFileSync(path.join(ctx.outputDir, name), "mp3");
  const p = moment({ sound: { song: null, voiceover: { file: name } } });
  // 23.4 s of 11025 Hz mono 16-bit PCM
  _setEngineForTest({ decode: async () => Buffer.alloc(Math.round(11025 * 23.4) * 2) });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(calls.render[0].voice.file, path.join(fs.realpathSync(ctx.outputDir), name));
  assert.match(done.render.notes.join(" "), /Your voiceover is 23\.4 s, so it's cut at 15 s\./);
});

test("a voiceover that fits is not noted", async () => {
  const name = voiceName();
  fs.writeFileSync(path.join(ctx.outputDir, name), "mp3");
  const p = moment({ sound: { song: null, voiceover: { file: name } } });
  _setEngineForTest({ decode: async () => Buffer.alloc(11025 * 2 * 10) });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done");
  assert.ok(!done.render.notes.join(" ").includes("voiceover"));
});

// ---- R2: cancel before and during a render

function assertCancelled(p, job) {
  const stopped = readProject(ctx.dataDir, p.projectId);
  assert.equal(stopped.render.status, "error");
  assert.equal(stopped.render.error, "Cancelled.");
  assert.equal(stopped.render.stage, "error");
  assert.equal(stopped.render.percent, 0);
  assert.equal(stopped.render.jobId, job.jobId);
  assert.equal(calls.prepare, 0, "nothing was prepared");
  assert.equal(calls.render.length, 0, "nothing was rendered");
  assert.equal(getJob(job.jobId).status, "error");
}

test("a signal that is already aborted cancels before any work", async () => {
  const p = moment();
  const job = createJob("u1", { durationSec: 15 });
  const ac = new AbortController();
  ac.abort();
  await momentRenderStage(ctx, p.projectId, job.jobId, { signal: ac.signal });
  assertCancelled(p, job);
  assert.equal(getJob(job.jobId).phase, undefined, "markRunning was not called");
});

test("a job cancelled while queued is not started", async () => {
  const p = moment();
  const job = createJob("u1", { durationSec: 15 });
  cancelJob(job.jobId, "u1");
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  assertCancelled(p, job);
  assert.equal(getJob(job.jobId).cancelled, true);
  assert.equal(getJob(job.jobId).phase, undefined, "markRunning was not called");
});

test("aborting the external signal mid-render stops it", async () => {
  _setEngineForTest({
    renderPlan: (opts) => new Promise((resolve) => {
      calls.render.push(opts);
      opts.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }), { once: true });
    }),
  });
  const p = moment();
  const job = createJob("u1", { durationSec: 15 });
  const ac = new AbortController();
  const running = momentRenderStage(ctx, p.projectId, job.jobId, { signal: ac.signal });
  while (calls.render.length === 0) await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  await running;
  const stopped = readProject(ctx.dataDir, p.projectId);
  assert.equal(stopped.render.status, "error");
  assert.equal(stopped.render.error, "Cancelled.");
  assert.equal(getJob(job.jobId).status, "error");
});

test("cancelMomentRender still stops a running render", async () => {
  _setEngineForTest({
    renderPlan: (opts) => new Promise((resolve) => {
      calls.render.push(opts);
      opts.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }), { once: true });
    }),
  });
  const p = moment();
  const running = momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  while (calls.render.length === 0) await new Promise((r) => setTimeout(r, 5));
  assert.equal(cancelMomentRender(p.projectId), true);
  await running;
  assert.equal(readProject(ctx.dataDir, p.projectId).render.error, "Cancelled.");
  assert.equal(cancelMomentRender(p.projectId), false, "nothing left to cancel");
});

// ---- R8: the stage never throws

test("a missing project does not throw", async () => {
  await assert.doesNotReject(momentRenderStage(ctx, "no-such-project", createJob("u1", { durationSec: 15 }).jobId, {}));
});

// ---- fix round 1

const projectFile = (p) => path.join(ctx.dataDir, "moments", `${p.projectId}.json`);
const movieFiles = () => fs.readdirSync(ctx.outputDir).filter((f) => /^moment-[0-9a-f-]{36}\.mp4$/i.test(f));

test("a progress write that throws neither kills the stage nor stops the render", async () => {
  const p = moment();
  // A directory where the store's temp file goes makes every write inside the render throw.
  const poison = `${projectFile(p)}.${process.pid}.tmp`;
  _setEngineForTest({
    renderPlan: async (opts) => {
      fs.mkdirSync(poison);
      try {
        opts.onProgress({ stage: "shots", fraction: 0.5 });
        opts.onProgress({ stage: "no-such-stage", fraction: 1 });
        opts.onProgress({ stage: "finish", fraction: 0.99 });
      } finally { fs.rmSync(poison, { recursive: true, force: true }); }
      fs.writeFileSync(opts.out, "mp4");
      return { ok: true, file: opts.out };
    },
  });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(readProject(ctx.dataDir, p.projectId).render.status, "done");
});

test("a render that belongs to a newer job is left alone", async () => {
  const newer = { jobId: "other", status: "running", percent: 30, stage: "shots" };
  const p = moment({ render: newer });
  const job = createJob("u1", { durationSec: 15 });
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  const after = readProject(ctx.dataDir, p.projectId);
  assert.deepEqual(after.render, newer, "progress, the plan's render record and the result all skipped");
  assert.equal(after.history.length, 0);
  assert.equal(getJob(job.jobId).status, "error");
  assert.deepEqual(movieFiles(), [], "the finished file is removed rather than orphaned");
});

test("a cancelled job does not overwrite a newer job's render", async () => {
  const newer = { jobId: "other", status: "running", percent: 30, stage: "shots" };
  const p = moment({ render: newer });
  const job = createJob("u1", { durationSec: 15 });
  cancelJob(job.jobId, "u1");
  await momentRenderStage(ctx, p.projectId, job.jobId, {});
  assert.deepEqual(readProject(ctx.dataDir, p.projectId).render, newer);
});

test("running progress is a fresh record, not the old render's fields", async () => {
  const seen = [];
  _setEngineForTest({
    renderPlan: async (opts) => {
      opts.onProgress({ stage: "shots", fraction: 0.5 });
      seen.push(readProject(ctx.dataDir, p.projectId).render);
      fs.writeFileSync(opts.out, "mp4");
      return { ok: true, file: opts.out };
    },
  });
  const p = moment({ render: { jobId: null, status: "running", percent: 0, stage: "waiting", file: "/outputs/old.mp4", notes: ["old"], error: "old" } });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.deepEqual(Object.keys(seen[0]).sort(), ["jobId", "percent", "stage", "status"]);
});

test("a job record that cannot be saved does not turn a finished Moment into an error", async () => {
  const p = moment();
  // A file where the persisted-jobs folder goes makes persistJob throw.
  fs.writeFileSync(path.join(ctx.dataDir, "render-jobs"), "not a folder");
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(movieFiles().length, 1);
});

test("a project deleted during the render leaves no orphan video", async () => {
  const p = moment();
  _setEngineForTest({
    renderPlan: async (opts) => {
      fs.writeFileSync(opts.out, "mp4");
      fs.rmSync(projectFile(p));
      return { ok: true, file: opts.out };
    },
  });
  await assert.doesNotReject(momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {}));
  assert.deepEqual(movieFiles(), []);
});

test("a cancel during photo preparation says Cancelled, not 'need 3 photos'", async () => {
  const ac = new AbortController();
  let n = 0;
  // Cancelled during the last photo's conversion: it fails, and so would the 3-photo minimum.
  _setEngineForTest({
    runFfmpeg: async (args) => {
      n += 1;
      if (n < 3) { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; }
      ac.abort();
      return { ok: false, error: "cancelled" };
    },
  });
  const p = moment({ photos: [photo(), photo(), photo()] });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, { signal: ac.signal });
  assert.equal(readProject(ctx.dataDir, p.projectId).render.error, "Cancelled.");
});

test("cancelMomentRender is false before the stage registers, and an older run does not unregister a newer one", async () => {
  const p = moment();
  assert.equal(cancelMomentRender(p.projectId), false, "nothing registered yet");
  const releases = [];
  _setEngineForTest({
    renderPlan: (opts) => new Promise((resolve) => {
      calls.render.push(opts);
      releases.push(() => resolve({ ok: false, error: "Rendering failed at shot 1 of 3." }));
      opts.signal.addEventListener("abort", () => resolve({ ok: false, error: "cancelled" }), { once: true });
    }),
  });
  const first = momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  while (calls.render.length < 1) await new Promise((r) => setTimeout(r, 5));
  const second = momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  while (calls.render.length < 2) await new Promise((r) => setTimeout(r, 5));
  // The newer run registered last, so the older run finishing must leave it registered.
  releases[0]();
  await first;
  assert.equal(calls.render[1].signal.aborted, false);
  assert.equal(cancelMomentRender(p.projectId), true, "the newer run is still cancellable");
  await second;
  assert.equal(calls.render[1].signal.aborted, true);
  assert.equal(cancelMomentRender(p.projectId), false);
});

// ---- R11: an unreadable voiceover is a note, not a failure

test("a voiceover that cannot be decoded is noted and the Moment renders without it", async () => {
  const name = voiceName();
  const voicePath = path.join(ctx.outputDir, name);
  fs.writeFileSync(voicePath, "mp3");
  const p = moment({ sound: { song: null, voiceover: { file: name } } });
  _setEngineForTest({
    decode: async (file) => {
      if (path.basename(file) === name) throw new Error("bad mp3");
      return Buffer.alloc(11025 * 2 * 30);
    },
  });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.equal(calls.render[0].voice, null);
  assert.equal(calls.render[0].song, null);
  assert.match(done.render.notes.join(" "), /The voiceover couldn't be read, so this Moment has no voice\. Make it again\./);
});

test("an unreadable voiceover with a song keeps the song", async () => {
  const name = voiceName();
  fs.writeFileSync(path.join(ctx.outputDir, name), "mp3");
  const p = moment({ sound: { song: { ref: "library:hopeful", windowStartSec: 7 }, voiceover: { file: name } } });
  _setEngineForTest({
    decode: async (file) => {
      if (path.basename(file) === name) throw new Error("bad mp3");
      return Buffer.alloc(11025 * 2 * 30);
    },
  });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.equal(readProject(ctx.dataDir, p.projectId).render.status, "done");
  assert.equal(calls.render[0].voice, null);
  assert.equal(calls.render[0].song.startSec, 7);
});

function historyEntry(i) {
  const name = `moment-${crypto.randomUUID()}.mp4`;
  fs.writeFileSync(path.join(ctx.outputDir, name), "old");
  return { name, entry: { jobId: `old${i}`, file: `/outputs/${name}`, createdAt: i, seed: i } };
}

test("a render that pushes the oldest history entry out removes that entry's video", async () => {
  const olds = Array.from({ length: 20 }, (_, i) => historyEntry(i));
  const p = moment({ history: olds.map((o) => o.entry) });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.history.length, 20);
  const left = movieFiles();
  assert.ok(!left.includes(olds[0].name), "the dropped entry's file is gone");
  for (const o of olds.slice(1)) assert.ok(left.includes(o.name), "the kept entries' files stay");
  assert.ok(left.includes(path.basename(done.render.file)), "the new video stays");
  assert.equal(left.length, 20);
});

test("a dropped history entry whose file name is not a Moment video is never deleted", async () => {
  const olds = Array.from({ length: 20 }, (_, i) => historyEntry(i));
  fs.writeFileSync(path.join(ctx.outputDir, "precious.txt"), "keep");
  olds[0].entry.file = "/outputs/precious.txt";
  const p = moment({ history: olds.map((o) => o.entry) });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  assert.ok(fs.existsSync(path.join(ctx.outputDir, "precious.txt")));
});

test("a render that cannot be saved removes no history videos", async () => {
  const olds = Array.from({ length: 20 }, (_, i) => historyEntry(i));
  const newer = { jobId: "other", status: "running", percent: 30, stage: "shots" };
  const p = moment({ history: olds.map((o) => o.entry), render: newer });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  for (const o of olds) assert.ok(fs.existsSync(path.join(ctx.outputDir, o.name)));
});

test("the seed and the plan are not written over a newer job's render", async () => {
  const newer = { jobId: "other", status: "running", percent: 30, stage: "shots" };
  const p = moment({ render: newer, plan: null });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, { seed: 4321 });
  const after = readProject(ctx.dataDir, p.projectId);
  assert.equal(after.seed, 9, "the seed write is skipped");
  assert.equal(after.plan, null, "the plan write is skipped");
  assert.deepEqual(after.render, newer);
});

test("droppedNote suggests the next longer length, and nothing at 60 s", () => {
  assert.equal(droppedNote(4, 15), "4 photos didn't fit 15 s. Try 30 s?");
  assert.equal(droppedNote(1, 30), "1 photo didn't fit 30 s. Try 60 s?");
  assert.equal(droppedNote(2, 60), "2 photos didn't fit 60 s.");
});

test("a Moment with too many photos for 15 s notes the dropped ones and suggests 30 s", async () => {
  const p = moment({ photos: Array.from({ length: 20 }, () => photo()) });
  await momentRenderStage(ctx, p.projectId, createJob("u1", { durationSec: 15 }).jobId, {});
  const done = readProject(ctx.dataDir, p.projectId);
  assert.equal(done.render.status, "done", JSON.stringify(done.render));
  assert.match(done.render.notes.join(" "), /\d+ photos? didn't fit 15 s\. Try 30 s\?/);
});
