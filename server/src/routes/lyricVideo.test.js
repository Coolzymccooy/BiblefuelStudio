// server/src/routes/lyricVideo.test.js
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import { createLyricVideoRouter } from "./lyricVideo.js";
import { readProject, writeProject, createProject, applySheet } from "../lib/lyricVideo/projectStore.js";
import { isAligning } from "../lib/lyricVideo/alignJob.js";
import { readUsage } from "../lib/usageStore.js";
import { markRunning, markDone, getJob } from "../lib/renderJobs.js";

let root;
let server;
let base;
let ctx; // the request context for the next calls; swap per test
// Stubs the tests drive: timing steps and the render.
const stub = { align: {}, render: null };

const userCtx = (name, plan = "free") => {
  const dataDir = path.join(root, name);
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir, { recursive: true });
  return { userId: name, dataDir, outputDir, plan };
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-route-"));
  ctx = userCtx("u1");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use("/api/lyric-video", createLyricVideoRouter({
    alignDeps: () => stub.align,
    runRender: (opts) => stub.render(opts),
  }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/lyric-video`;
});
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });

const call = async (method, url, body) => {
  const r = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text), headers: r.headers }; } catch { return { status: r.status, text, headers: r.headers }; }
};
const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const newProject = async (title = "T") => (await call("POST", "/", { title })).json.project.projectId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(15); } return false; };

/** A project with `n` placed lines of 1 s each: line k starts at k*gapEvery + 1. */
function placedProject(c, { n = 3, durationSec = 10, every = 3, song = true } = {}) {
  let p = createProject(c.dataDir, { title: "T", artist: "A" });
  p = applySheet(p, Array.from({ length: n }, (_, i) => `aa${i} bb${i}`).join("\n"));
  const lines = p.lines.map((l, i) => {
    const s = i * every + 1;
    return { ...l, words: [{ text: `aa${i}`, start: s, end: s + 0.5 }, { text: `bb${i}`, start: s + 0.5, end: s + 1 }], start: s, end: s + 1 };
  });
  const songFile = path.join(c.outputDir, "song-fake.m4a");
  if (song) fs.writeFileSync(songFile, "x");
  return writeProject(c.dataDir, { ...p, song: song ? { file: songFile, durationSec, coverStill: null } : null, lines });
}

const finishingRender = (extra = async () => {}) => async (o) => {
  markRunning(o.jobId);
  await extra(o);
  fs.writeFileSync(o.outPath, "mp4");
  markDone(o.jobId, o.outPath);
  return { ok: true, file: o.outPath };
};

describe("projects", () => {
  test("create, list, read, delete", async () => {
    const c = await call("POST", "/", { title: "My Time No Late", artist: "Sthill Waters" });
    assert.equal(c.status, 200);
    const id = c.json.project.projectId;
    assert.equal((await call("GET", "/")).json.projects[0].projectId, id);
    assert.equal((await call("GET", `/${id}`)).json.project.title, "My Time No Late");
    assert.equal((await call("DELETE", `/${id}`)).status, 200);
    assert.equal((await call("GET", `/${id}`)).status, 404);
  });
  test("artist prefs", async () => {
    await call("PUT", "/prefs", { artist: "Sthill Waters" });
    assert.equal((await call("GET", "/prefs")).json.artist, "Sthill Waters");
  });
  test("an unknown or malformed id is a plain 404", async () => {
    assert.equal((await call("GET", "/lv_nope")).status, 404);
    assert.equal((await call("GET", "/..%2F..%2Fetc")).status, 404);
    assert.equal((await call("DELETE", "/lv_nope")).status, 404);
  });
});

describe("sheet and lines", () => {
  test("sheet over the limit is refused; a good sheet is parsed", async () => {
    const id = await newProject();
    assert.equal((await call("PUT", `/${id}/sheet`, { sheet: "x".repeat(20001) })).status, 400);
    assert.equal((await call("PUT", `/${id}/sheet`, { sheet: "   " })).status, 400);
    const ok = await call("PUT", `/${id}/sheet`, { sheet: "[CHORUS]\nWho talk say?\nMy time no late" });
    assert.deepEqual(ok.json.project.lines.map((l) => l.text), ["Who talk say?", "My time no late"]);
  });
  test("a sheet over 400 lines is refused", async () => {
    const id = await newProject();
    const r = await call("PUT", `/${id}/sheet`, { sheet: Array.from({ length: 401 }, (_, i) => `line ${i}`).join("\n") });
    assert.equal(r.status, 400);
  });
  test("a nudge is clamped between neighbours and inside the song, and locks the line", async () => {
    const p = placedProject(ctx);
    const lineId = p.lines[1].id;
    const r = await call("PATCH", `/${p.projectId}/lines/${lineId}`, { start: 0.2 });
    const moved = r.json.project.lines[1];
    assert.ok(moved.start >= 2.05 - 1e-9, `clamped after line 0 ends (+gap), got ${moved.start}`);
    assert.equal(moved.locked, true);
    assert.equal(moved.flag, null);
    const late = await call("PATCH", `/${p.projectId}/lines/${p.lines[2].id}`, { start: 99 });
    assert.ok(late.json.project.lines[2].end <= 10 + 1e-9);
    assert.equal((await call("PATCH", `/${p.projectId}/lines/${lineId}`, { effect: "explode" })).status, 400);
  });
  test("a nudge shifts the whole line, words included", async () => {
    const p = placedProject(ctx, { every: 4 });
    const r = await call("PATCH", `/${p.projectId}/lines/${p.lines[1].id}`, { start: 6 });
    const l = r.json.project.lines[1];
    assert.equal(l.start, 6);
    assert.equal(l.end, 7);
    assert.deepEqual(l.words.map((w) => [w.start, w.end]), [[6, 6.5], [6.5, 7]]);
  });
  test("a bad start, an unknown line and an unplaced line are refused", async () => {
    const p = placedProject(ctx);
    for (const start of ["abc", null, NaN, "", [], {}]) {
      const r = await call("PATCH", `/${p.projectId}/lines/${p.lines[0].id}`, { start });
      assert.equal(r.status, 400, `start=${JSON.stringify(start)}`);
    }
    assert.equal((await call("PATCH", `/${p.projectId}/lines/l99999`, { start: 2 })).status, 404);
    assert.equal((await call("PATCH", `/${p.projectId}/lines/${p.lines[0].id}`, {})).status, 400);
    const fresh = await newProject();
    await call("PUT", `/${fresh}/sheet`, { sheet: "no timing here" });
    const lineId = (await call("GET", `/${fresh}`)).json.project.lines[0].id;
    const r = await call("PATCH", `/${fresh}/lines/${lineId}`, { start: 2 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no timing/);
  });
  test("an effect alone is accepted without locking the timing", async () => {
    const p = placedProject(ctx);
    const r = await call("PATCH", `/${p.projectId}/lines/${p.lines[0].id}`, { effect: "slam" });
    assert.equal(r.status, 200);
    assert.equal(r.json.project.lines[0].effect, "slam");
    assert.equal(r.json.project.lines[0].locked, false);
  });
  test("random nudges never leave lines out of order or outside the song", async () => {
    const p = placedProject(ctx, { n: 8, durationSec: 40, every: 4 });
    let seed = 20261013;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let k = 0; k < 80; k++) {
      const i = Math.floor(rnd() * 8);
      const start = Math.round((rnd() * 60 - 10) * 100) / 100;
      const r = await call("PATCH", `/${p.projectId}/lines/${p.lines[i].id}`, { start });
      assert.equal(r.status, 200);
      const lines = r.json.project.lines;
      for (let j = 0; j < lines.length; j++) {
        assert.ok(lines[j].start >= 0, `line ${j} start ${lines[j].start}`);
        assert.ok(lines[j].end <= 40 + 1e-6, `line ${j} end ${lines[j].end}`);
        assert.ok(lines[j].start < lines[j].end);
        for (const w of lines[j].words) assert.ok(w.start >= lines[j].start - 1e-6 && w.end <= lines[j].end + 1e-6, "words stay inside the line");
        if (j > 0) assert.ok(lines[j - 1].end <= lines[j].start + 1e-6, `order broken between ${j - 1} and ${j}: ${lines[j - 1].end} > ${lines[j].start}`);
      }
    }
  });
  test("a nudge cannot make already-cramped lines worse", async () => {
    const p = placedProject(ctx, { n: 3, durationSec: 10, every: 1 }); // lines touch end-to-start with no gap
    const r = await call("PATCH", `/${p.projectId}/lines/${p.lines[1].id}`, { start: 5 });
    assert.equal(r.status, 200);
    const lines = r.json.project.lines;
    assert.ok(lines[0].end <= lines[1].start + 1e-6 && lines[1].end <= lines[2].start + 1e-6);
  });
  test("a deleted project is a 404, not a recreated file", async () => {
    const p = placedProject(ctx);
    await call("DELETE", `/${p.projectId}`);
    assert.equal((await call("PATCH", `/${p.projectId}/lines/${p.lines[0].id}`, { start: 2 })).status, 404);
    assert.equal(readProject(ctx.dataDir, p.projectId), null);
  });
});

describe("look and background", () => {
  test("look is validated", async () => {
    const id = await newProject();
    assert.equal((await call("PUT", `/${id}/look`, { id: "nope" })).status, 400);
    assert.equal((await call("PUT", `/${id}/look`, { energy: "mad" })).status, 400);
    assert.equal((await call("PUT", `/${id}/look`, { seed: -3 })).status, 400);
    assert.equal((await call("PUT", `/${id}/look`, { seed: 1.5 })).status, 400);
    const ok = await call("PUT", `/${id}/look`, { id: "studio-clean-white", energy: "calm", seed: 7 });
    assert.deepEqual(ok.json.project.look, { id: "studio-clean-white", energy: "calm", seed: 7 });
  });
  test("background rejects a missing path, an outside path and a non-media file", async () => {
    const id = await newProject();
    assert.equal((await call("PUT", `/${id}/background`, {})).status, 400);
    assert.equal((await call("PUT", `/${id}/background`, { path: "/etc/passwd" })).status, 400);
    const txt = path.join(ctx.outputDir, "notes.txt");
    fs.writeFileSync(txt, "hello");
    assert.equal((await call("PUT", `/${id}/background`, { path: txt })).status, 400);
    assert.equal((await call("PUT", `/${id}/background`, { path: null })).json.project.background, null);
  });
  test("a picture is attached, with a fit; an unknown fit is refused", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const img = path.join(ctx.outputDir, "bg.jpg");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", "-frames:v", "1", img]);
    const ok = await call("PUT", `/${id}/background`, { path: img, fit: "cover" });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.project.background, { file: img, kind: "image", fit: "cover" });
    assert.equal((await call("PUT", `/${id}/background`, { path: img, fit: "stretch" })).status, 400);
  });
});

describe("song upload", () => {
  test("a path outside the outputs folder is refused", async () => {
    const id = await newProject();
    assert.equal((await call("POST", `/${id}/song`, { path: "/etc/passwd" })).status, 400);
    assert.equal((await call("POST", `/${id}/song`, { path: path.join(ctx.outputDir, "missing.mp3") })).status, 400);
  });
  test("a silent video is refused with a plain message", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const silent = path.join(ctx.outputDir, "silent.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", silent]);
    const r = await call("POST", `/${id}/song`, { path: silent });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /That file has no sound in it/);
    assert.equal(readProject(ctx.dataDir, id).song, null, "nothing was attached");
  });
  test("a file that is not audio or video is refused", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const txt = path.join(ctx.outputDir, "lyrics.txt");
    fs.writeFileSync(txt, "not media at all");
    const r = await call("POST", `/${id}/song`, { path: txt });
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.json.error, /[\\/]/, "no paths in the message");
  });
  test("an audio file is attached with its duration", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const song = path.join(ctx.outputDir, "song.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=3", "-c:a", "aac", song]);
    const r = await call("POST", `/${id}/song`, { path: song });
    assert.equal(r.status, 200);
    assert.ok(Math.abs(r.json.project.song.durationSec - 3) < 0.2);
    assert.equal(r.json.project.song.file, song);
  });
  test("a video song gets a cover still that exists, even when shorter than a second", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const clip = path.join(ctx.outputDir, "clip.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=0.5", "-f", "lavfi", "-i", "sine=d=0.5", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", clip]);
    const r = await call("POST", `/${id}/song`, { path: clip });
    assert.equal(r.status, 200);
    const still = r.json.project.song.coverStill;
    assert.ok(still && fs.existsSync(still), `cover still ${still}`);
  });
});

test("captions.ass returns text for placed lines", async () => {
  const p = placedProject(ctx, { n: 1 });
  const r = await call("GET", `/${p.projectId}/captions.ass?w=720&h=1280`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/plain/);
  assert.match(r.text, /PlayResY: 1280/);
  const clamped = await call("GET", `/${p.projectId}/captions.ass?w=99999&h=1`);
  assert.match(clamped.text, /PlayResX: 3840/);
});

describe("timing", () => {
  test("align without a song, or without lines, is refused", async () => {
    const id = await newProject();
    assert.equal((await call("POST", `/${id}/align`)).status, 409);
    const noLines = writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, id), song: { file: path.join(ctx.outputDir, "x.m4a"), durationSec: 5 } });
    assert.equal((await call("POST", `/${noLines.projectId}/align`)).status, 409);
  });
  test("align is refused when the song file has gone", async () => {
    const p = placedProject(ctx);
    fs.rmSync(p.song.file);
    assert.equal((await call("POST", `/${p.projectId}/align`)).status, 409);
  });
  test("align starts the job (202), refuses a second run, and the project settles", async () => {
    const p = placedProject(ctx);
    let release;
    const gate = new Promise((r) => { release = r; });
    stub.align = { prepareAudio: () => gate, log: () => {} };
    const first = await call("POST", `/${p.projectId}/align`);
    assert.equal(first.status, 202);
    assert.equal(first.json.project.timing.status, "running");
    assert.equal((await call("POST", `/${p.projectId}/align`)).status, 409);
    // While it runs, the song and the project cannot be swapped out from under it.
    assert.equal((await call("POST", `/${p.projectId}/song`, { path: p.song.file })).status, 409);
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 409);
    release();
    // prepareAudio resolved with undefined: the job ends in an error the user can read.
    assert.ok(await until(() => !isAligning(p.projectId)));
    const settled = (await call("GET", `/${p.projectId}`)).json.project;
    assert.equal(settled.timing.status, "error");
    assert.equal(typeof settled.timing.error, "string");
    stub.align = {};
  });
  test("a timing job that is not running any more is reported as stopped, and saved so", async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...p, timing: { status: "running", progress: { step: "listening" } } });
    const r = await call("GET", `/${p.projectId}`);
    assert.equal(r.json.project.timing.status, "error");
    assert.equal(r.json.project.timing.error, "Timing stopped before it finished — run it again.");
    assert.equal(readProject(ctx.dataDir, p.projectId).timing.status, "error", "persisted, not just reported");
    assert.equal(r.json.project.timing.progress, null);
  });
  test("listing also settles an interrupted timing job", async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...p, timing: { status: "running" } });
    await call("GET", "/");
    assert.equal(readProject(ctx.dataDir, p.projectId).timing.status, "error");
  });
  test("a timing job that is really running is left alone by GET", async () => {
    const p = placedProject(ctx);
    let release;
    stub.align = { prepareAudio: () => new Promise((r) => { release = r; }), log: () => {} };
    await call("POST", `/${p.projectId}/align`);
    assert.equal((await call("GET", `/${p.projectId}`)).json.project.timing.status, "running");
    release();
    assert.ok(await until(() => !isAligning(p.projectId)));
    stub.align = {};
  });
});

describe("render", () => {
  // Premium: these tests start many renders, which is not what they are about.
  before(() => { ctx = userCtx("renderer", "premium"); });
  after(() => { ctx = userCtx("u1"); });


  test("a render is refused before the lyrics are timed, with a bad shape, or with a bad song length", async () => {
    const id = await newProject();
    assert.equal((await call("POST", `/${id}/render`, { aspect: "portrait", quality: "720p" })).status, 409);
    const p = placedProject(ctx);
    assert.equal((await call("POST", `/${p.projectId}/render`, { aspect: "weird" })).status, 400);
    assert.equal((await call("POST", `/${p.projectId}/render`, { quality: "8k" })).status, 400);
    for (const durationSec of [0, -3, NaN, null, "abc"]) {
      writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), song: { ...p.song, durationSec } });
      const r = await call("POST", `/${p.projectId}/render`, { aspect: "portrait", quality: "720p" });
      assert.equal(r.status, 409, `durationSec=${durationSec}`);
    }
  });
  test("a render runs, reports basenames only, and is recorded on the project", async () => {
    const p = placedProject(ctx);
    let seen;
    stub.render = finishingRender(async (o) => { seen = o; });
    const r = await call("POST", `/${p.projectId}/render`, { aspect: "square", quality: "720p" });
    assert.equal(r.status, 202);
    const { jobId } = r.json;
    assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${jobId}`)).json.job.status === "done"));
    const job = (await call("GET", `/${p.projectId}/render/${jobId}`)).json.job;
    assert.equal(job.progress, 100);
    assert.ok(!job.file.includes(path.sep) && !job.file.includes("/"), `basename only, got ${job.file}`);
    assert.equal(seen.width, 720);
    assert.equal(seen.height, 720);
    assert.equal(seen.durationSec, 10);
    assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).renders.length === 1));
    const saved = readProject(ctx.dataDir, p.projectId).renders[0];
    assert.equal(saved.jobId, jobId);
    assert.equal(saved.aspect, "square");
    assert.ok(!fs.existsSync(path.join(ctx.outputDir, `lyric-${p.projectId}-720x720.ass`)), "scratch captions removed");
  });
  test("a second render of the same project is refused while one runs, and allowed after", async () => {
    const p = placedProject(ctx);
    let release;
    stub.render = finishingRender(() => new Promise((r) => { release = r; }));
    const first = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(first.status, 202);
    const second = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(second.status, 409);
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 409);
    release();
    assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${first.json.jobId}`)).json.job.status === "done"));
    stub.render = finishingRender();
    assert.equal((await call("POST", `/${p.projectId}/render`, {})).status, 202);
  });
  test("a failed render shows a plain message, never the ffmpeg detail or a path", async () => {
    const p = placedProject(ctx);
    const { markError } = await import("../lib/renderJobs.js");
    stub.render = async (o) => { markRunning(o.jobId); markError(o.jobId, `ffmpeg exited 1: Error opening ${o.outPath}`); return { ok: false, error: "ffmpeg exited 1" }; };
    const r = await call("POST", `/${p.projectId}/render`, {});
    assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "error"));
    const job = (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job;
    assert.doesNotMatch(job.error, /ffmpeg|[\\/]/);
    assert.ok(job.error.length > 10);
    assert.equal(readProject(ctx.dataDir, p.projectId).renders.length, 0);
  });
  test("a render rejected by the runner is a failed job, not a crash", async () => {
    const p = placedProject(ctx);
    stub.render = async () => { throw new Error("boom at /srv/secret/path"); };
    const r = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(r.status, 202);
    assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "error"));
    assert.doesNotMatch(JSON.stringify((await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json), /secret/);
    stub.render = finishingRender();
    assert.equal((await call("POST", `/${p.projectId}/render`, {})).status, 202, "the project is free to render again");
  });
  test("cancel stops a running render; status and cancel belong to the owner and the project", async () => {
    const p = placedProject(ctx);
    const other = placedProject(ctx);
    let release;
    stub.render = finishingRender(() => new Promise((r) => { release = r; }));
    const r = await call("POST", `/${p.projectId}/render`, {});
    const { jobId } = r.json;
    assert.equal((await call("GET", `/${other.projectId}/render/${jobId}`)).status, 404, "another project's id does not reveal the job");
    assert.equal((await call("POST", `/${other.projectId}/render/${jobId}/cancel`)).status, 404);
    const mine = ctx;
    ctx = userCtx("intruder");
    assert.equal((await call("GET", `/${p.projectId}/render/${jobId}`)).status, 404);
    ctx = mine;
    const c = await call("POST", `/${p.projectId}/render/${jobId}/cancel`);
    assert.equal(c.status, 200);
    assert.equal(getJob(jobId).status, "error");
    assert.equal((await call("GET", `/${p.projectId}/render/${jobId}`)).json.job.error, "Render cancelled");
    assert.equal((await call("POST", `/${p.projectId}/render/${jobId}/cancel`)).status, 409, "already finished");
    release();
    stub.render = finishingRender();
  });
  test("an unknown job is a 404", async () => {
    const p = placedProject(ctx);
    assert.equal((await call("GET", `/${p.projectId}/render/nope`)).status, 404);
    assert.equal((await call("POST", `/${p.projectId}/render/nope/cancel`)).status, 404);
  });
});

describe("quota (R26): only align and render are charged, and only once they are accepted", () => {
  test("polling and reading never use up the free allowance", async () => {
    ctx = userCtx("quota-polls");
    const p = placedProject(ctx);
    for (let i = 0; i < 25; i++) {
      for (const url of ["/", `/${p.projectId}`, `/${p.projectId}/captions.ass?w=720&h=1280`, "/prefs", `/${p.projectId}/render/nope`]) {
        const r = await call("GET", url);
        assert.notEqual(r.status, 429, `${url} #${i}`);
      }
    }
    assert.equal(readUsage(ctx.dataDir).counts.render, 0);
    ctx = userCtx("u1");
  });
  test("the 6th render in a day is refused; refused requests were not charged", async () => {
    ctx = userCtx("quota-render");
    const p = placedProject(ctx);
    stub.render = async (o) => { markRunning(o.jobId); markDone(o.jobId, o.outPath); return { ok: true, file: o.outPath }; };
    // A refusal (409: nothing timed yet) does not spend a render.
    const empty = await newProject();
    for (let i = 0; i < 6; i++) assert.equal((await call("POST", `/${empty}/render`, {})).status, 409);
    assert.equal(readUsage(ctx.dataDir).counts.render, 0);
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.equal(r.status, 202, `render #${i + 1}`);
      assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "done"));
      await sleep(20); // the render slot frees just after the job reports done
    }
    const sixth = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(sixth.status, 429);
    assert.equal(sixth.json.error, "QUOTA_EXCEEDED");
    stub.render = finishingRender();
    ctx = userCtx("u1");
  });
  test("the 6th timing run in a day is refused", async () => {
    ctx = userCtx("quota-align");
    const p = placedProject(ctx);
    stub.align = { prepareAudio: async () => { throw new Error("stub: stop here"); }, log: () => {} };
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", `/${p.projectId}/align`);
      assert.equal(r.status, 202, `align #${i + 1}`);
      assert.ok(await until(() => !isAligning(p.projectId)));
    }
    const sixth = await call("POST", `/${p.projectId}/align`);
    assert.equal(sixth.status, 429);
    stub.align = {};
    ctx = userCtx("u1");
  });
  test("a premium plan is never limited", async () => {
    ctx = userCtx("quota-premium", "premium");
    const p = placedProject(ctx);
    stub.render = async (o) => { markRunning(o.jobId); markDone(o.jobId, o.outPath); return { ok: true, file: o.outPath }; };
    for (let i = 0; i < 7; i++) {
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.equal(r.status, 202);
      assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "done"));
      await sleep(20);
    }
    ctx = userCtx("u1");
  });
});

describe("delete", () => {
  test("removes the project and the files the project itself made, not the user's uploads", async () => {
    const p = placedProject(ctx);
    const cover = path.join(ctx.outputDir, "lyric-cover-del.jpg");
    const rendered = path.join(ctx.outputDir, "lyric-del-render.mp4");
    fs.writeFileSync(cover, "c");
    fs.writeFileSync(rendered, "r");
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), song: { ...p.song, coverStill: cover }, renders: [{ jobId: "j", file: rendered }, { jobId: "k", file: "/etc/passwd" }] });
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 200);
    assert.ok(!fs.existsSync(cover));
    assert.ok(!fs.existsSync(rendered));
    assert.ok(fs.existsSync(p.song.file), "the uploaded song stays");
  });
});
