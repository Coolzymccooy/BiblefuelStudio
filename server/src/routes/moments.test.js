import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import momentsRouter, {
  _setQuotaImpl, _resetQuotaImpl, _setRenderStageImpl, _resetRenderStageImpl, _setTtsImpl, _resetTtsImpl,
  _setSongGridImpl, _resetSongGridImpl, _setStatementsImpl, _resetStatementsImpl,
} from "./moments.js";
import { readProject, writeProject, deleteProject } from "../lib/moments/projectStore.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/moments/statements.js";
import { _resetHeavyGate } from "../lib/heavyJobGate.js";
import { createJob, getJob, cancelJob } from "../lib/renderJobs.js";
import { MAX_PHOTOS } from "../lib/moments/projectStore.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

let dataDir;
let outputDir;
let app;
let charges;
let stageCalls;

function makeApp(userId = "u1", dir = dataDir, out = outputDir) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId, plan: "free", dataDir: dir, outputDir: out }; next(); });
  a.use("/api/moments", momentsRouter);
  return a;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-route-"));
  outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  app = makeApp();
  charges = [];
  stageCalls = [];
  _setQuotaImpl((bucket) => (_req, _res, next) => { charges.push(bucket); next(); });
  _setRenderStageImpl(async (...args) => { stageCalls.push(args); });
  _setLlmImpl(async () => JSON.stringify({ title: "Happy 40th!", statements: ["A", "B"] }));
  _setTtsImpl(async () => {
    const f = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.mp3`);
    fs.writeFileSync(f, "mp3");
    return { ok: true, file: f };
  });
  _resetHeavyGate();
});
afterEach(() => {
  _resetQuotaImpl(); _resetRenderStageImpl(); _resetLlmImpl(); _resetTtsImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function upload() {
  const name = `bg-image-${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(outputDir, name), PNG);
  return { kind: "upload", path: name };
}

async function newMoment(occasion = "birthday") {
  const r = await request(app).post("/api/moments").send({ occasion });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.project;
}

test("GET /meta lists occasions, styles, lengths and limits", async () => {
  const r = await request(app).get("/api/moments/meta");
  assert.equal(r.status, 200);
  assert.equal(r.body.occasions.length, 8);
  assert.deepEqual(r.body.styles.map((s) => s.id), ["glow", "celebrate", "hype", "gallery"]);
  assert.deepEqual(r.body.styles.map((s) => s.energy), [0.2, 0.6, 0.85, 0.45], "each style's natural Energy");
  assert.deepEqual(r.body.lengths, [15, 30, 60]);
  assert.deepEqual(r.body.limits.statements, { 15: 3, 30: 5, 60: 8 });
  assert.equal(r.body.limits.scriptMax, 1200);
  const birthday = r.body.occasions.find((o) => o.id === "birthday");
  assert.deepEqual(birthday.fields, ["name", "milestone"]);
  assert.equal(birthday.style, "celebrate");
});

test("create needs a known occasion", async () => {
  assert.equal((await request(app).post("/api/moments").send({ occasion: "party" })).status, 400);
  const p = await newMoment("memorial");
  assert.equal(p.style, "glow");
});

test("PUT resolves photo refs and saves them; a bad photo is named", async () => {
  const p = await newMoment();
  const ok = await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()], heroIndex: 1, title: "Hi" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.project.photos.length, 3);
  assert.match(ok.body.project.photos[0].url, /^\/outputs\/bg-image-/);
  const bad = await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), { kind: "upload", path: "../../x.png" }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Photo 2:/);
});

test("another user's Moment is a 404", async () => {
  const p = await newMoment();
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-other-"));
  const other = makeApp("u2", otherDir, otherDir);
  assert.equal((await request(other).get(`/api/moments/${p.projectId}`)).status, 404);
  assert.equal((await request(other).put(`/api/moments/${p.projectId}`).send({ title: "x" })).status, 404);
  fs.rmSync(otherDir, { recursive: true, force: true });
});

test("statements charge scripts once and are returned, not saved", async () => {
  const p = await newMoment();
  const r = await request(app).post(`/api/moments/${p.projectId}/statements`).send();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.suggestion.statements, ["A", "B"]);
  assert.deepEqual(charges, ["scripts"]);
  assert.deepEqual(readProject(dataDir, p.projectId).statements, []);
});

test("a voiceover is synthesised, stored in the user's outputs, and charged to tts", async () => {
  const p = await newMoment();
  const r = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday Tolu, God bless you.", voiceId: "en-GB-SoniaNeural" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const vo = r.body.project.sound.voiceover;
  assert.match(vo.file, /^moment-vo-[0-9a-f-]{36}\.mp3$/);
  assert.ok(fs.existsSync(path.join(outputDir, vo.file)));
  assert.deepEqual(charges, ["tts"]);
  const empty = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "  " });
  assert.equal(empty.status, 400);
  assert.deepEqual(charges, ["tts"], "nothing charged for a refused request");
});

test("render needs 3 photos, charges once after validation, and a second render is 409", async () => {
  const p = await newMoment();
  const few = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(few.status, 400);
  assert.deepEqual(charges, []);
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const first = await request(app).post(`/api/moments/${p.projectId}/render`).send({ seed: 77 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.jobId);
  const second = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(second.status, 409);
  assert.deepEqual(charges, ["render"]);
  await new Promise((r) => setImmediate(r));
  assert.equal(stageCalls.length, 1);
  assert.equal(stageCalls[0][3].seed, 77);
});

test("polling GET /:id never charges", async () => {
  const p = await newMoment();
  for (let i = 0; i < 5; i += 1) await request(app).get(`/api/moments/${p.projectId}`);
  assert.deepEqual(charges, []);
});

test("a running render with no live job (a restart) reads as interrupted", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: "gone-job", status: "running", percent: 40, stage: "shots" } });
  const r = await request(app).get(`/api/moments/${p.projectId}`);
  assert.equal(r.body.project.render.status, "interrupted");
});

test("PUT and DELETE are refused while rendering", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: createJob("u1", { durationSec: 15 }).jobId, status: "running", percent: 0, stage: "x" } });
  assert.equal((await request(app).put(`/api/moments/${p.projectId}`).send({ title: "x" })).status, 409);
  assert.equal((await request(app).delete(`/api/moments/${p.projectId}`)).status, 409);
});

test("DELETE removes the Moment, its videos and its voiceover", async () => {
  const p = await newMoment();
  const video = `moment-${crypto.randomUUID()}.mp4`;
  const vo = `moment-vo-${crypto.randomUUID()}.mp3`;
  fs.writeFileSync(path.join(outputDir, video), "v");
  fs.writeFileSync(path.join(outputDir, vo), "a");
  writeProject(dataDir, {
    ...readProject(dataDir, p.projectId),
    history: [{ jobId: "j", file: `/outputs/${video}`, createdAt: 1, seed: 1 }, { jobId: "k", file: "/outputs/../../etc/passwd", createdAt: 2, seed: 2 }],
    sound: { song: null, voiceover: { script: "s", voiceId: "v", file: vo } },
  });
  const r = await request(app).delete(`/api/moments/${p.projectId}`);
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(outputDir, video)), false);
  assert.equal(fs.existsSync(path.join(outputDir, vo)), false);
  assert.equal(readProject(dataDir, p.projectId), null);
});

test("library images are listed as URLs, never server paths", async () => {
  const r = await request(app).get("/api/moments/library-images");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.images, []);
});

test("song-window reports the auto window and the user's own start, and needs a song", async () => {
  const calls = [];
  _setSongGridImpl(async (_ctx, _file, opts) => {
    calls.push(opts);
    return { durationSec: 180, tempo: 99.5, windowStartSec: opts.windowStartSec ?? 42, grid: {} };
  });
  try {
    const p = await newMoment();
    const auto = await request(app).get(`/api/moments/${p.projectId}/song-window`);
    assert.equal(auto.status, 200, JSON.stringify(auto.body));
    assert.deepEqual(auto.body, { ok: true, durationSec: 180, tempo: 99.5, windowStartSec: 42, autoStartSec: 42 });
    await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { song: { ref: "library:gospel-fire", windowStartSec: 10 } } });
    const own = await request(app).get(`/api/moments/${p.projectId}/song-window`);
    assert.equal(own.body.windowStartSec, 10);
    assert.equal(own.body.autoStartSec, 42);
    await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { song: null } });
    assert.equal((await request(app).get(`/api/moments/${p.projectId}/song-window`)).status, 400);
    assert.deepEqual(charges, [], "never charged");
  } finally {
    _resetSongGridImpl();
  }
});

test("a free user over quota gets 429 from the render", async () => {
  _setQuotaImpl(() => (_req, res) => res.status(429).json({ ok: false, error: "Daily limit reached" }));
  const p = await newMoment();
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const r = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  assert.equal(r.status, 429);
  assert.equal(stageCalls.length, 0);
  assert.equal(readProject(dataDir, p.projectId).render, null);
});

test("cancel stops a queued render: its stage never runs and the Moment reads as cancelled", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  _setRenderStageImpl(async (...args) => { stageCalls.push(args); await held; });
  const first = await newMoment();
  const second = await newMoment();
  for (const p of [first, second]) {
    await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  }
  assert.equal((await request(app).post(`/api/moments/${first.projectId}/render`).send()).status, 200);
  const queued = await request(app).post(`/api/moments/${second.projectId}/render`).send();
  assert.equal(queued.status, 200);
  assert.equal(readProject(dataDir, second.projectId).render.stage, "waiting for another video to finish");

  const cancel = await request(app).post(`/api/moments/${second.projectId}/cancel`).send();
  assert.equal(cancel.status, 200);
  await new Promise((r) => setImmediate(r));
  const after = readProject(dataDir, second.projectId).render;
  assert.equal(after.status, "error");
  assert.equal(after.error, "Cancelled.");
  assert.equal(after.jobId, queued.body.jobId);
  assert.equal(getJob(queued.body.jobId).cancelled, true);

  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stageCalls.length, 1, "only the first render ever reached its stage");
  assert.equal(stageCalls[0][1], first.projectId);
  assert.equal(readProject(dataDir, second.projectId).render.error, "Cancelled.");
});

test("cancel on a Moment that is not rendering is a harmless ok", async () => {
  const p = await newMoment();
  const r = await request(app).post(`/api/moments/${p.projectId}/cancel`).send();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(readProject(dataDir, p.projectId).render, null);
});

test("the render stage is handed the job id and a cancel signal, and the project owns that job", async () => {
  const p = await newMoment();
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const r = await request(app).post(`/api/moments/${p.projectId}/render`).send();
  await new Promise((res) => setImmediate(res));
  assert.equal(stageCalls[0][2], r.body.jobId);
  assert.ok(stageCalls[0][3].signal instanceof AbortSignal);
  assert.equal(readProject(dataDir, p.projectId).render.jobId, r.body.jobId);
});

test("removing the voiceover through PUT deletes its file", async () => {
  const p = await newMoment();
  const made = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday Tolu, God bless you." });
  const file = made.body.project.sound.voiceover.file;
  assert.ok(fs.existsSync(path.join(outputDir, file)));
  const r = await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { voiceover: null } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project.sound.voiceover, null);
  assert.equal(fs.existsSync(path.join(outputDir, file)), false);
  assert.equal(readProject(dataDir, p.projectId).sound.voiceover, null);
});

test("a voiceover file outside the naming pattern is never deleted by PUT", async () => {
  const p = await newMoment();
  fs.writeFileSync(path.join(outputDir, "precious.mp3"), "x");
  writeProject(dataDir, {
    ...readProject(dataDir, p.projectId),
    sound: { song: null, voiceover: { script: "s", voiceId: null, file: "precious.mp3" } },
  });
  const r = await request(app).put(`/api/moments/${p.projectId}`).send({ sound: { voiceover: null } });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(path.join(outputDir, "precious.mp3")));
});

test("a voiceover TTS that is switched off is a 400, any other failure a 500", async () => {
  const p = await newMoment();
  _setTtsImpl(async () => { throw new Error("Edge TTS is disabled"); });
  const off = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday Tolu, God bless you." });
  assert.equal(off.status, 400);
  assert.equal(off.body.error, "Edge TTS is disabled");
  _setTtsImpl(async () => { throw new Error("socket hang up"); });
  const broken = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday Tolu, God bless you." });
  assert.equal(broken.status, 500);
});

test("PUT refuses photos that are not a list, or too many, before resolving any", async () => {
  const p = await newMoment();
  const notList = await request(app).put(`/api/moments/${p.projectId}`).send({ photos: "nope" });
  assert.equal(notList.status, 400);
  assert.match(notList.body.error, /list/);
  const tooMany = await request(app).put(`/api/moments/${p.projectId}`)
    .send({ photos: Array.from({ length: MAX_PHOTOS + 1 }, () => ({ kind: "upload", path: "does-not-exist.png" })) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, new RegExp(`${MAX_PHOTOS} photos`), "refused on the count, not on the first missing file");
  assert.doesNotMatch(tooMany.body.error, /^Photo 1:/);
});

test("PUT with no body is an empty update; voiceover and POST / refuse it; render uses the Moment's own seed", async () => {
  const p = await newMoment();
  const put = await request(app).put(`/api/moments/${p.projectId}`);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.project.title, p.title);
  assert.equal((await request(app).post(`/api/moments/${p.projectId}/voiceover`)).status, 400);
  assert.equal((await request(app).post("/api/moments")).status, 400);

  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  const render = await request(app).post(`/api/moments/${p.projectId}/render`);
  assert.equal(render.status, 200, JSON.stringify(render.body));
  await new Promise((r) => setImmediate(r));
  assert.equal(stageCalls[0][3].seed, p.seed);
});

test("another user gets 404 from every route that takes a Moment id", async () => {
  const p = await newMoment();
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-other-"));
  const other = makeApp("u2", otherDir, otherDir);
  const base = `/api/moments/${p.projectId}`;
  try {
    assert.equal((await request(other).delete(base)).status, 404);
    assert.equal((await request(other).post(`${base}/voiceover`).send({ script: "Happy birthday Tolu, God bless you." })).status, 404);
    assert.equal((await request(other).post(`${base}/render`).send()).status, 404);
    assert.equal((await request(other).post(`${base}/cancel`).send()).status, 404);
    assert.equal((await request(other).post(`${base}/statements`).send()).status, 404);
    assert.equal((await request(other).get(`${base}/song-window`)).status, 404);
    assert.deepEqual(charges, [], "nothing charged to a stranger");
    assert.ok(readProject(dataDir, p.projectId), "the owner's Moment is untouched");
  } finally {
    fs.rmSync(otherDir, { recursive: true, force: true });
  }
});

const voiceFiles = () => fs.readdirSync(outputDir).filter((n) => n.startsWith("moment-vo-"));
const SPEAK = { script: "Happy birthday Tolu, God bless you." };

test("voiceover failures never put server paths or upstream text in the response", async () => {
  const p = await newMoment();
  const url = `/api/moments/${p.projectId}/voiceover`;
  const leaks = (body) => /secret|moments-route|ENOENT/i.test(JSON.stringify(body));
  const quiet = console.error;
  console.error = () => {};
  try {
    _setTtsImpl(async () => { throw new Error("ENOENT: no such file C:\\secret\\path\\voice.mp3"); });
    const thrown = await request(app).post(url).send(SPEAK);
    assert.equal(thrown.status, 500);
    assert.equal(thrown.body.error, "Couldn't make the voiceover. Please try again.");
    assert.equal(leaks(thrown.body), false);

    _setTtsImpl(async () => ({ ok: false, error: "upstream said C:\\secret\\path" }));
    const refused = await request(app).post(url).send(SPEAK);
    assert.equal(refused.status, 502);
    assert.equal(leaks(refused.body), false);

    _setTtsImpl(async () => ({ ok: true, file: "C:\\secret\\path\\missing.mp3" }));
    const unmovable = await request(app).post(url).send(SPEAK);
    assert.equal(unmovable.status, 500);
    assert.equal(leaks(unmovable.body), false);

    // The project file can't be saved: a directory sits where its temp file would go.
    _setTtsImpl(async () => {
      fs.mkdirSync(path.join(dataDir, "moments", `${p.projectId}.json.${process.pid}.tmp`), { recursive: true });
      const f = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.mp3`);
      fs.writeFileSync(f, "mp3");
      return { ok: true, file: f };
    });
    const unsaved = await request(app).post(url).send(SPEAK);
    assert.equal(unsaved.status, 500);
    assert.equal(leaks(unsaved.body), false);
    assert.deepEqual(voiceFiles(), [], "no orphan voice file is left behind");
  } finally {
    console.error = quiet;
  }
});

test("a voiceover that finishes after the Moment was deleted is dropped with a 404", async () => {
  const p = await newMoment();
  _setTtsImpl(async () => {
    deleteProject(dataDir, p.projectId);
    const f = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.mp3`);
    fs.writeFileSync(f, "mp3");
    return { ok: true, file: f };
  });
  const r = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send(SPEAK);
  assert.equal(r.status, 404);
  assert.deepEqual(voiceFiles(), []);
});

test("a voiceover that finishes after a render started is dropped with a 409 and the old voice stays", async () => {
  const p = await newMoment();
  const first = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send(SPEAK);
  const oldFile = first.body.project.sound.voiceover.file;
  _setTtsImpl(async () => {
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      render: { jobId: createJob("u1", { durationSec: 15 }).jobId, status: "running", percent: 5, stage: "shots" },
    });
    const f = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.mp3`);
    fs.writeFileSync(f, "mp3");
    return { ok: true, file: f };
  });
  const r = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send(SPEAK);
  assert.equal(r.status, 409);
  assert.deepEqual(voiceFiles(), [oldFile], "the new file is gone and the running render's voice is untouched");
  assert.equal(readProject(dataDir, p.projectId).sound.voiceover.file, oldFile);
});

test("statements failures return a fixed message", async () => {
  const p = await newMoment();
  _setStatementsImpl(async () => { throw new Error("boom C:\\secret\\path"); });
  const quiet = console.error;
  console.error = () => {};
  try {
    const r = await request(app).post(`/api/moments/${p.projectId}/statements`).send();
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.error, "Couldn't write the lines. Please try again.");
    assert.equal(/secret/i.test(JSON.stringify(r.body)), false);
  } finally {
    console.error = quiet;
    _resetStatementsImpl();
  }
});

test("a queued run cancelled after a newer render took over leaves that render untouched", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  _setRenderStageImpl(async (...args) => { stageCalls.push(args); await held; });
  const first = await newMoment();
  const second = await newMoment();
  for (const p of [first, second]) {
    await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  }
  await request(app).post(`/api/moments/${first.projectId}/render`).send();
  await request(app).post(`/api/moments/${second.projectId}/render`).send();
  const newer = { jobId: createJob("u1", { durationSec: 15 }).jobId, status: "running", percent: 30, stage: "shots" };
  writeProject(dataDir, { ...readProject(dataDir, second.projectId), render: newer });

  assert.equal((await request(app).post(`/api/moments/${second.projectId}/cancel`).send()).status, 200);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(readProject(dataDir, second.projectId).render, newer, "the newer render's record is not overwritten");
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stageCalls.length, 1);
});

test("starting a render sweeps stale job records on its own", async () => {
  const stale = createJob("u1", { durationSec: 15 });
  stale.status = "done";
  stale.updatedAt = Date.now() - 2 * 60 * 60 * 1000;
  const p = await newMoment();
  await request(app).put(`/api/moments/${p.projectId}`).send({ photos: [upload(), upload(), upload()] });
  assert.equal((await request(app).post(`/api/moments/${p.projectId}/render`).send()).status, 200);
  assert.equal(getJob(stale.jobId), null);
});

test("PUT on an interrupted Moment returns it as interrupted", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: "gone-job", status: "running", percent: 40, stage: "shots" } });
  const r = await request(app).put(`/api/moments/${p.projectId}`).send({ title: "Hello" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project.title, "Hello");
  assert.equal(r.body.project.render.status, "interrupted");
});

test("the voiceover response also reads an interrupted Moment as interrupted", async () => {
  const p = await newMoment();
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: "gone-job", status: "running", percent: 40, stage: "shots" } });
  const r = await request(app).post(`/api/moments/${p.projectId}/voiceover`).send({ script: "Happy birthday to you" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project.render.status, "interrupted");
});

test("a cancelled job reads as a Cancelled error straight away, before the stage records it", async () => {
  const p = await newMoment();
  const job = createJob("u1", { durationSec: 15 });
  cancelJob(job.jobId, "u1");
  writeProject(dataDir, { ...readProject(dataDir, p.projectId), render: { jobId: job.jobId, status: "running", percent: 40, stage: "shots" } });
  const r = await request(app).get(`/api/moments/${p.projectId}`);
  assert.equal(r.body.project.render.status, "error");
  assert.equal(r.body.project.render.error, "Cancelled.");
  assert.equal(r.body.project.render.jobId, job.jobId);
});
