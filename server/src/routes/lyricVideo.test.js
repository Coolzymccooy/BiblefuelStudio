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
import { markRunning, markDone, getJob, cancelJob } from "../lib/renderJobs.js";
import { writeBranding, logoFileFor } from "../lib/branding.js";

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
    statfs: (p) => (stub.statfs ? stub.statfs(p) : fs.statfsSync(p)),
    songProbed: (id) => stub.songProbed?.(id),
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
    assert.deepEqual(ok.json.project.background, { file: fs.realpathSync(img), kind: "image", fit: "cover" });
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
    assert.equal(r.json.project.song.file, fs.realpathSync(song));
  });
  test("a new song clears the old timing, hand-moved lines included (R40)", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), sections: p.sections.map((s) => ({ ...s, start: 0.5 })) });
    const nudged = await call("PATCH", `/${p.projectId}/lines/${p.lines[1].id}`, { start: 4.5 });
    assert.equal(nudged.json.project.lines[1].locked, true);
    const song = path.join(ctx.outputDir, "new-song.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=3", "-c:a", "aac", song]);
    const r = await call("POST", `/${p.projectId}/song`, { path: song });
    assert.equal(r.status, 200);
    for (const saved of [r.json.project, readProject(ctx.dataDir, p.projectId)]) {
      assert.equal(saved.lines.length, 3, "the lyrics stay");
      for (const l of saved.lines) {
        for (const key of ["words", "start", "end", "confidence", "flag", "locked"]) assert.equal(l[key], undefined, `${l.id}.${key}`);
      }
      for (const s of saved.sections) assert.equal(s.start, undefined, `${s.id}.start`);
      assert.equal(saved.timing.status, "idle");
    }
  });
  test("a song refused because timing started meanwhile leaves no picture behind (R45)", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = placedProject(ctx);
    const clip = path.join(ctx.outputDir, "race-clip.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=2", "-f", "lavfi", "-i", "sine=d=2", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", clip]);
    const covers = () => fs.readdirSync(ctx.outputDir).filter((n) => n.startsWith("lyric-cover-"));
    const before = covers();
    let release;
    stub.align = { prepareAudio: () => new Promise((res) => { release = res; }), log: () => {} };
    stub.songProbed = async () => { assert.equal((await call("POST", `/${p.projectId}/align`)).status, 202); };
    const sounds = () => fs.readdirSync(ctx.outputDir).filter((n) => n.startsWith("lyric-song-"));
    const soundsBefore = sounds();
    try {
      const r = await call("POST", `/${p.projectId}/song`, { path: clip });
      assert.equal(r.status, 409);
      assert.deepEqual(covers(), before, "the picture taken from the refused song is removed");
      assert.deepEqual(sounds(), soundsBefore, "the sound taken from the refused song is removed");
      assert.ok(fs.existsSync(clip), "the user's own upload stays");
    } finally {
      stub.songProbed = null;
      release?.();
      assert.ok(await until(() => !isAligning(p.projectId)));
      stub.align = {};
    }
  });
  test("a song uploaded as plain audio (an .mp3 named by the uploader) is attached (R40)", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const song = path.join(ctx.outputDir, "user-audio-1234.mp3");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2", "-c:a", "libmp3lame", song]);
    // The upload answers with forward slashes, whatever the platform.
    const r = await call("POST", `/${id}/song`, { path: song.replace(/\\/g, "/") });
    assert.equal(r.status, 200);
    assert.ok(Math.abs(r.json.project.song.durationSec - 2) < 0.2);
    assert.equal(r.json.project.song.coverStill, null);
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

describe("song taken from a video (Codex #60)", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const FP = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const streams = (file, sel) => spawnSync(FP, ["-v", "error", "-select_streams", sel, "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const durationOf = (file) => Number(spawnSync(FP, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim());
  const extracted = () => fs.readdirSync(ctx.outputDir).filter((n) => n.startsWith("lyric-song-"));
  const makeClip = (name, { d = 3, audio = ["-c:a", "aac"] } = {}) => {
    const clip = path.join(ctx.outputDir, name);
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=s=160x90:d=${d}`, "-f", "lavfi", "-i", `sine=d=${d}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", ...audio, clip]);
    assert.ok(fs.existsSync(clip), `made ${name}`);
    return clip;
  };

  test("a video's sound is taken out as an .m4a song; the picture still comes from the video", async () => {
    const id = await newProject();
    const clip = makeClip("source-video-aac.mp4");
    const r = await call("POST", `/${id}/song`, { path: clip });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const song = r.json.project.song;
    assert.match(path.basename(song.file), /^lyric-song-[\w-]+\.m4a$/);
    assert.equal(fs.realpathSync(path.dirname(song.file)), fs.realpathSync(ctx.outputDir), "kept in the user's outputs");
    assert.equal(streams(song.file, "v"), "", "no picture in the song");
    assert.equal(streams(song.file, "a"), "aac");
    assert.ok(Math.abs(durationOf(song.file) - 3) < 0.2, `duration ${durationOf(song.file)}`);
    assert.ok(Math.abs(song.durationSec - 3) < 0.2, `durationSec ${song.durationSec}`);
    assert.ok(song.coverStill && fs.existsSync(song.coverStill), "cover still from the video");
    assert.ok(fs.existsSync(clip), "the user's own upload stays");
  });

  test("a video whose sound is not AAC is encoded to AAC", async () => {
    const id = await newProject();
    const clip = makeClip("source-video-pcm.mov", { audio: ["-c:a", "pcm_s16le"] });
    const r = await call("POST", `/${id}/song`, { path: clip });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.project.song.file, /\.m4a$/);
    assert.equal(streams(r.json.project.song.file, "a"), "aac");
    assert.equal(streams(r.json.project.song.file, "v"), "");
  });

  test("an audio upload is used as it is, even one with cover art", async () => {
    const id = await newProject();
    const before = extracted();
    const mp3 = path.join(ctx.outputDir, "audio-with-art.mp3");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2", "-f", "lavfi", "-i", "testsrc=s=64x64:d=1",
      "-map", "0:a", "-map", "1:v", "-frames:v", "1", "-c:a", "libmp3lame", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-id3v2_version", "3", mp3]);
    assert.ok(fs.existsSync(mp3));
    const r = await call("POST", `/${id}/song`, { path: mp3 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.project.song.file, fs.realpathSync(mp3));
    assert.deepEqual(extracted(), before, "no copy of an audio file is made");
  });

  test("replacing a video song removes the sound taken from it, never the user's upload", async () => {
    const id = await newProject();
    const first = makeClip("source-video-first.mp4");
    const a = await call("POST", `/${id}/song`, { path: first });
    assert.equal(a.status, 200);
    const firstSong = a.json.project.song.file;
    const second = makeClip("source-video-second.mp4", { d: 2 });
    const b = await call("POST", `/${id}/song`, { path: second });
    assert.equal(b.status, 200);
    assert.ok(!fs.existsSync(firstSong), "the old extracted sound is removed");
    assert.ok(fs.existsSync(b.json.project.song.file));
    assert.ok(fs.existsSync(first) && fs.existsSync(second), "both uploads stay");
    // Swapping to plain audio removes the extracted sound too, and keeps the audio upload.
    const audio = path.join(ctx.outputDir, "audio-replace.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2", "-c:a", "aac", audio]);
    const c = await call("POST", `/${id}/song`, { path: audio });
    assert.equal(c.status, 200);
    assert.ok(!fs.existsSync(b.json.project.song.file), "the second extracted sound is removed");
    // And replacing a plain audio song never deletes that upload.
    const d = await call("POST", `/${id}/song`, { path: makeClip("source-video-third.mp4", { d: 1 }) });
    assert.equal(d.status, 200);
    assert.ok(fs.existsSync(audio), "the user's audio upload stays");
  });

  test("deleting the project removes the extracted sound, never the user's upload", async () => {
    const id = await newProject();
    const clip = makeClip("source-video-delete.mp4", { d: 1 });
    const r = await call("POST", `/${id}/song`, { path: clip });
    assert.equal(r.status, 200);
    const song = r.json.project.song.file;
    assert.equal((await call("DELETE", `/${id}`)).status, 200);
    assert.ok(!fs.existsSync(song), "the extracted sound is removed");
    assert.ok(fs.existsSync(clip), "the upload stays");
  });

  test("a song whose project vanished while it was probed leaves no extracted sound behind", async () => {
    const id = await newProject();
    const clip = makeClip("source-video-vanish.mp4", { d: 1 });
    const before = extracted();
    stub.songProbed = async () => { assert.equal((await call("DELETE", `/${id}`)).status, 200); };
    try {
      const r = await call("POST", `/${id}/song`, { path: clip });
      assert.equal(r.status, 404);
      assert.deepEqual(extracted(), before);
      assert.ok(fs.existsSync(clip));
    } finally {
      stub.songProbed = null;
    }
  });

  test("a project with an old video song.file still deletes cleanly without touching that video", async () => {
    const p = placedProject(ctx, { n: 1 });
    const clip = makeClip("source-video-legacy.mp4", { d: 1 });
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), song: { file: clip, durationSec: 1, coverStill: null } });
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 200);
    assert.ok(fs.existsSync(clip), "a legacy video song is the user's upload and stays");
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

describe("effects", () => {
  /** A timed chorus: a lead line, then a response to it. */
  function callAndEcho(c) {
    let p = createProject(c.dataDir, { title: "T", artist: "A" });
    p = applySheet(p, "[CHORUS]\nWho talk say\n(WHO TALK SAY?!)");
    const times = [[10, "lead"], [11.2, "response"]];
    const lines = p.lines.map((l, i) => {
      const [s, kind] = times[i];
      const words = l.text.split(" ").map((t, k) => ({ text: t, start: s + k * 0.3, end: s + k * 0.3 + 0.28 }));
      return { ...l, kind, words, start: s, end: words[words.length - 1].end };
    });
    return writeProject(c.dataDir, { ...p, lines });
  }

  test("GET /:id/effects returns each placed line's resolved effect, and does not charge the render allowance", async () => {
    ctx = userCtx("effects-user");
    const p = callAndEcho(ctx);
    assert.deepEqual(p.lines.map((l) => l.kind), ["lead", "response"]);
    const before = readUsage(ctx.dataDir).counts.render;
    const r = await call("GET", `/${p.projectId}/effects`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.effects), p.lines.map((l) => l.id));
    assert.equal(r.json.effects[p.lines[1].id], "echo");
    assert.equal(typeof r.json.effects[p.lines[0].id], "string");
    assert.equal(readUsage(ctx.dataDir).counts.render, before, "reading effects is free");
  });

  test("effects leave out lines that are not placed, and an unknown or another user's project is a 404", async () => {
    ctx = userCtx("effects-owner");
    const p = callAndEcho(ctx);
    const untimed = writeProject(ctx.dataDir, { ...p, lines: p.lines.map((l, i) => (i === 0 ? { ...l, words: [], start: undefined, end: undefined } : l)) });
    const r = await call("GET", `/${untimed.projectId}/effects`);
    assert.deepEqual(Object.keys(r.json.effects), [untimed.lines[1].id]);
    assert.equal((await call("GET", "/lv_nope/effects")).status, 404);
    ctx = userCtx("effects-stranger");
    assert.equal((await call("GET", `/${p.projectId}/effects`)).status, 404);
  });
});

describe("publish draft", () => {
  test("GET /:id/publish-draft returns the YouTube draft for the project, free of charge", async () => {
    ctx = userCtx("draft-user");
    let p = createProject(ctx.dataDir, { title: "My Time", artist: "Sthill Waters" });
    p = writeProject(ctx.dataDir, applySheet(p, "[CHORUS]\nMy time no late"));
    const before = readUsage(ctx.dataDir).counts.render;
    const r = await call("GET", `/${p.projectId}/publish-draft`);
    assert.equal(r.status, 200);
    assert.equal(r.json.draft.title, "My Time — Sthill Waters (Official Lyric Video)");
    assert.ok(r.json.draft.description.includes("[CHORUS]\nMy time no late"));
    assert.equal(r.json.draft.categoryId, "10");
    assert.equal(readUsage(ctx.dataDir).counts.render, before, "the draft is free");
  });

  test("another user's project, or an unknown one, is a 404", async () => {
    ctx = userCtx("draft-owner");
    const p = createProject(ctx.dataDir, { title: "Mine", artist: "" });
    assert.equal((await call("GET", "/lv_nope/publish-draft")).status, 404);
    ctx = userCtx("draft-stranger");
    assert.equal((await call("GET", `/${p.projectId}/publish-draft`)).status, 404);
  });
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
  test("an interrupted re-run keeps the earlier timing and notes that it stopped (R44)", async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...p, timing: { status: "running", progress: { step: "listening" }, rerun: true } });
    const r = await call("GET", `/${p.projectId}`);
    assert.equal(r.json.project.timing.status, "done");
    assert.equal(r.json.project.timing.lastError, "Timing stopped before it finished — run it again.");
    assert.equal(r.json.project.timing.progress, null);
    assert.deepEqual(r.json.project.lines, p.lines);
    assert.equal(readProject(ctx.dataDir, p.projectId).timing.status, "done", "persisted");
  });
  test("listing also settles an interrupted timing job", async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...p, timing: { status: "running" } });
    await call("GET", "/");
    assert.equal(readProject(ctx.dataDir, p.projectId).timing.status, "error");
  });
  test("the lyrics cannot be changed while timing runs (R40)", async () => {
    const p = placedProject(ctx);
    let release;
    stub.align = { prepareAudio: () => new Promise((r) => { release = r; }), log: () => {} };
    assert.equal((await call("POST", `/${p.projectId}/align`)).status, 202);
    const r = await call("PUT", `/${p.projectId}/sheet`, { sheet: "something else" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "Wait for the timing to finish before changing the lyrics.");
    const saved = readProject(ctx.dataDir, p.projectId);
    assert.equal(saved.timing.status, "running", "the page keeps following the run");
    assert.deepEqual(saved.lines.map((l) => l.text), p.lines.map((l) => l.text));
    release();
    assert.ok(await until(() => !isAligning(p.projectId)));
    stub.align = {};
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
    assert.deepEqual(fs.readdirSync(ctx.outputDir).filter((n) => n.endsWith(".ass")), [], "scratch captions removed");
    assert.match(path.basename(seen.outPath), /^lyric-[0-9a-f-]{36}\.mp4$/, "output name is a UUID, not the project id");
    assert.ok(!seen.outPath.includes(p.projectId));
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
    assert.equal((await call("POST", `/${p.projectId}/song`, { path: p.song.file })).status, 409, "song swap refused while rendering");
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
  test("the running render's job is kept on the project until it is done, so the page can find it again (R43)", async () => {
    const p = placedProject(ctx);
    let release;
    stub.render = finishingRender(() => new Promise((r) => { release = r; }));
    const r = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(r.status, 202);
    assert.deepEqual(readProject(ctx.dataDir, p.projectId).render, { activeJobId: r.json.jobId });
    assert.deepEqual((await call("GET", `/${p.projectId}`)).json.project.render, { activeJobId: r.json.jobId }, "a live render is left alone");
    release();
    assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).render === null));
    const saved = readProject(ctx.dataDir, p.projectId);
    assert.equal(saved.renders.length, 1, "the video is on the project by the time the job is cleared");
    stub.render = finishingRender();
  });
  test("a failed or cancelled render clears the saved job too (R43)", async () => {
    const p = placedProject(ctx);
    const { markError } = await import("../lib/renderJobs.js");
    stub.render = async (o) => { markRunning(o.jobId); markError(o.jobId, "ffmpeg exited 1"); return { ok: false }; };
    await call("POST", `/${p.projectId}/render`, {});
    assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).render === null));
    let release;
    stub.render = finishingRender(() => new Promise((r) => { release = r; }));
    const second = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(readProject(ctx.dataDir, p.projectId).render.activeJobId, second.json.jobId);
    assert.equal((await call("POST", `/${p.projectId}/render/${second.json.jobId}/cancel`)).status, 200);
    release();
    assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).render === null));
    stub.render = finishingRender();
  });
  test("a saved render that is not running any more (a restart) is cleared when the project is read (R43)", async () => {
    const p = placedProject(ctx);
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), render: { activeJobId: "gone-after-restart" } });
    assert.equal((await call("GET", `/${p.projectId}`)).json.project.render, null);
    assert.equal(readProject(ctx.dataDir, p.projectId).render, null, "persisted, not just reported");
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), render: { activeJobId: "gone-again" } });
    await call("GET", "/");
    assert.equal(readProject(ctx.dataDir, p.projectId).render, null, "listing settles it too");
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

describe("limits", () => {
  const holdingRender = () => {
    const held = { release: null };
    stub.render = finishingRender(() => new Promise((r) => { held.release = r; }));
    return held;
  };
  const doneJob = (c, p, jobId) => until(async () => { const prev = ctx; ctx = c; const r = (await call("GET", `/${p.projectId}/render/${jobId}`)).json.job.status === "done"; ctx = prev; return r; });

  test("one render per user, across projects", async () => {
    ctx = userCtx("one-per-user", "premium");
    const a = placedProject(ctx);
    const b = placedProject(ctx);
    const held = holdingRender();
    const first = await call("POST", `/${a.projectId}/render`, {});
    assert.equal(first.status, 202);
    const second = await call("POST", `/${b.projectId}/render`, {});
    assert.equal(second.status, 409);
    assert.equal(second.json.error, "You already have a video being made — wait for it to finish.");
    held.release();
    assert.ok(await doneJob(ctx, a, first.json.jobId));
    await sleep(30);
    stub.render = finishingRender();
    assert.equal((await call("POST", `/${b.projectId}/render`, {})).status, 202, "free again once the first finished");
    await sleep(60);
    ctx = userCtx("u1");
  });

  test("at most two lyric renders run on the server at once", async () => {
    const users = ["cap-a", "cap-b", "cap-c"].map((n) => userCtx(n, "premium"));
    const projects = users.map((c) => placedProject(c));
    const releases = [];
    stub.render = finishingRender(() => new Promise((r) => { releases.push(r); }));
    const jobs = [];
    for (let i = 0; i < 2; i++) {
      ctx = users[i];
      const r = await call("POST", `/${projects[i].projectId}/render`, {});
      assert.equal(r.status, 202, `render ${i + 1}`);
      jobs.push(r.json.jobId);
    }
    ctx = users[2];
    const third = await call("POST", `/${projects[2].projectId}/render`, {});
    assert.equal(third.status, 409);
    assert.equal(third.json.error, "The studio is busy making other videos — try again in a few minutes.");
    releases.forEach((r) => r());
    for (let i = 0; i < 2; i++) assert.ok(await doneJob(users[i], projects[i], jobs[i]));
    await sleep(30);
    stub.render = finishingRender();
    ctx = users[2];
    assert.equal((await call("POST", `/${projects[2].projectId}/render`, {})).status, 202, "a slot is free again");
    await sleep(60);
    ctx = userCtx("u1");
  });

  test("a render is refused with a plain 507 when the disk is short, before any quota is charged", async () => {
    ctx = userCtx("disk-free"); // free plan: a charge would show in usage
    const p = placedProject(ctx);
    stub.statfs = () => ({ bavail: 1, bsize: 100 * 1024 * 1024 }); // 100 MB free, below the reserve
    const r = await call("POST", `/${p.projectId}/render`, { aspect: "portrait", quality: "1080p" });
    assert.equal(r.status, 507);
    assert.equal(r.json.error, "The server is short of space right now — try again later.");
    assert.equal(readUsage(ctx.dataDir).counts.render, 0);
    stub.statfs = null;
    ctx = userCtx("u1");
  });

  test("the disk check counts the renders already running", async () => {
    const a = userCtx("disk-a", "premium");
    const b = userCtx("disk-b", "premium");
    const pa = placedProject(a);
    const pb = placedProject(b);
    // 10 s at 720p is about 7.7 MB. Room for one with the 1 GB reserve, not for two.
    stub.statfs = () => ({ bavail: 1034, bsize: 1024 * 1024 });
    const held = holdingRender();
    ctx = a;
    const first = await call("POST", `/${pa.projectId}/render`, {});
    assert.equal(first.status, 202);
    ctx = b;
    assert.equal((await call("POST", `/${pb.projectId}/render`, {})).status, 507);
    held.release();
    assert.ok(await doneJob(a, pa, first.json.jobId));
    await sleep(30);
    stub.statfs = null;
    stub.render = finishingRender();
    ctx = userCtx("u1");
  });

  test("one timing run per user at a time, across projects", async () => {
    ctx = userCtx("timing-user");
    const a = placedProject(ctx);
    const b = placedProject(ctx);
    let release;
    stub.align = { prepareAudio: () => new Promise((r) => { release = r; }), log: () => {} };
    assert.equal((await call("POST", `/${a.projectId}/align`)).status, 202);
    const other = await call("POST", `/${b.projectId}/align`);
    assert.equal(other.status, 409);
    assert.equal(other.json.error, "Timing is already running for another song — wait for it to finish.");
    assert.equal(readUsage(ctx.dataDir).counts.render, 1, "the refused run was not charged");
    release();
    assert.ok(await until(() => !isAligning(a.projectId)));
    await sleep(30);
    stub.align = { prepareAudio: async () => { throw new Error("stop"); }, log: () => {} };
    assert.equal((await call("POST", `/${b.projectId}/align`)).status, 202, "free again afterwards");
    assert.ok(await until(() => !isAligning(b.projectId)));
    stub.align = {};
    ctx = userCtx("u1");
  });

  test("a failed render is logged once, however often it is polled", async () => {
    ctx = userCtx("log-once", "premium");
    const p = placedProject(ctx);
    const { markError } = await import("../lib/renderJobs.js");
    stub.render = async (o) => { markRunning(o.jobId); markError(o.jobId, "ffmpeg exited 1: boom"); return { ok: false, error: "ffmpeg exited 1" }; };
    const logged = [];
    const original = console.error;
    console.error = (...a) => { logged.push(a.join(" ")); };
    try {
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "error"));
      for (let i = 0; i < 5; i++) await call("GET", `/${p.projectId}/render/${r.json.jobId}`);
      await sleep(30);
    } finally { console.error = original; }
    assert.equal(logged.filter((l) => l.includes("failed")).length, 1, logged.join("\n"));
    stub.render = finishingRender();
    ctx = userCtx("u1");
  });
});

describe("branding options and the branded render", () => {
  const DEFAULTS = { logo: null, intro: true, endCard: true };
  let n = 0;
  /** A premium user of its own, so branding.json and the logo never leak between tests. */
  const freshUser = () => { ctx = userCtx(`brand-${++n}`, "premium"); return ctx; };
  const writeLogo = (c) => {
    const file = logoFileFor(c.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=white:s=64x32", "-frames:v", "1", file]);
    return file;
  };
  const jobDone = (p, jobId) => until(async () => ["done", "error"].includes((await call("GET", `/${p.projectId}/render/${jobId}`)).json.job.status));
  after(() => { stub.render = finishingRender(); stub.statfs = null; ctx = userCtx("u1"); });

  test("a new project and an older one without the field both read as the defaults", async () => {
    freshUser();
    const id = await newProject();
    assert.deepEqual((await call("GET", `/${id}`)).json.project.branding, DEFAULTS);
    const raw = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, "lyric-projects", `${id}.json`), "utf8"));
    delete raw.branding;
    fs.writeFileSync(path.join(ctx.dataDir, "lyric-projects", `${id}.json`), JSON.stringify(raw));
    assert.deepEqual((await call("GET", `/${id}`)).json.project.branding, DEFAULTS);
    const b = (await call("GET", `/${id}/branding`)).json.branding;
    assert.deepEqual(b, { logo: false, intro: true, endCard: true, hasLogo: false, logoFromSettings: false });
  });
  test("PUT takes booleans (and null for the logo) and refuses anything else", async () => {
    freshUser();
    const id = await newProject();
    for (const body of [{ logo: "yes" }, { intro: 1 }, { endCard: null }, { intro: "false" }, { logo: [] }, {}]) {
      assert.equal((await call("PUT", `/${id}/branding`, body)).status, 400, JSON.stringify(body));
    }
    const r = await call("PUT", `/${id}/branding`, { logo: true, intro: false, endCard: false, extra: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.project.branding, { logo: true, intro: false, endCard: false });
    const partial = await call("PUT", `/${id}/branding`, { intro: true });
    assert.deepEqual(partial.json.project.branding, { logo: true, intro: true, endCard: false }, "other options keep their value");
    const back = await call("PUT", `/${id}/branding`, { logo: null });
    assert.equal(back.json.project.branding.logo, null, "null goes back to following Settings");
  });
  test("another user's project is a 404 for both branding routes", async () => {
    freshUser();
    const id = await newProject();
    ctx = userCtx("brand-intruder");
    assert.equal((await call("GET", `/${id}/branding`)).status, 404);
    assert.equal((await call("PUT", `/${id}/branding`, { intro: false })).status, 404);
  });
  test("GET resolves the logo from the project, else from Settings", async () => {
    freshUser();
    const id = await newProject();
    const get = async () => (await call("GET", `/${id}/branding`)).json.branding;
    assert.deepEqual(await get(), { logo: false, intro: true, endCard: true, hasLogo: false, logoFromSettings: false });
    writeBranding(ctx.dataDir, { enabled: true });
    assert.deepEqual(await get(), { logo: true, intro: true, endCard: true, hasLogo: false, logoFromSettings: true }, "Settings on, no file uploaded");
    await call("PUT", `/${id}/branding`, { logo: false });
    assert.deepEqual(await get(), { logo: false, intro: true, endCard: true, hasLogo: false, logoFromSettings: true }, "the project wins");
    await call("PUT", `/${id}/branding`, { logo: null });
    writeBranding(ctx.dataDir, { enabled: false });
    assert.equal((await get()).logo, false);
    if (hasFfmpeg) { writeLogo(ctx); assert.equal((await get()).hasLogo, true); }
  });
  test("a render gets a plan and a document holding the branding events", async () => {
    freshUser();
    const p = placedProject(ctx);
    let seen;
    let ass = "";
    stub.render = finishingRender(async (o) => { seen = o; ass = fs.readFileSync(o.assPath, "utf8"); });
    const r = await call("POST", `/${p.projectId}/render`, { aspect: "landscape" });
    assert.equal(r.status, 202);
    assert.ok(await jobDone(p, r.json.jobId));
    assert.ok(seen.plan && seen.geometry, "the plan and band geometry reach the renderer");
    assert.equal(seen.plan.totalSec, 13, "a 10 s song whose last line ends near the end gets the 3 s tail");
    assert.ok(seen.plan.endCard && seen.plan.intro.length > 0);
    assert.ok(ass.includes("song by A"), "the intro credit is in the document");
    assert.equal(seen.logo, null, "no logo uploaded, none drawn");
  });
  test("the project's intro and end card switches reach the plan", async () => {
    freshUser();
    const p = placedProject(ctx);
    await call("PUT", `/${p.projectId}/branding`, { intro: false, endCard: false });
    let seen;
    stub.render = finishingRender(async (o) => { seen = o; });
    const r = await call("POST", `/${p.projectId}/render`, {});
    assert.ok(await jobDone(p, r.json.jobId));
    assert.deepEqual(seen.plan.intro, []);
    assert.equal(seen.plan.endCard, null);
    assert.equal(seen.plan.totalSec, 10, "no end card, no tail");
  });
  test("a logo is drawn when the project says so, or follows Settings", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    freshUser();
    const file = writeLogo(ctx);
    const p = placedProject(ctx);
    const renderOnce = async () => {
      let seen;
      stub.render = finishingRender(async (o) => { seen = o; });
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.equal(r.status, 202);
      assert.ok(await jobDone(p, r.json.jobId));
      await sleep(40);
      return seen;
    };
    const off = await renderOnce();
    assert.equal(off.logo, null, "Settings off and the project follows Settings");
    assert.equal(off.plan.showLogo, false);
    writeBranding(ctx.dataDir, { enabled: true, opacity: 0.6 });
    const on = await renderOnce();
    assert.deepEqual(on.logo, { file, opacity: 0.6 });
    assert.equal(on.plan.showLogo, true);
    await call("PUT", `/${p.projectId}/branding`, { logo: false });
    assert.equal((await renderOnce()).logo, null, "the project overrides Settings");
    writeBranding(ctx.dataDir, { enabled: false });
    await call("PUT", `/${p.projectId}/branding`, { logo: true });
    assert.deepEqual((await renderOnce()).logo, { file, opacity: 0.6 }, "the project can switch it on over Settings");
  });
  test("a logo file that cannot be read is left out of the render, with one logged line", async () => {
    freshUser();
    const file = logoFileFor(ctx.dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not a png");
    writeBranding(ctx.dataDir, { enabled: true });
    const p = placedProject(ctx);
    let seen;
    stub.render = finishingRender(async (o) => { seen = o; });
    const logged = [];
    const original = console.warn;
    console.warn = (...a) => { logged.push(a.join(" ")); };
    try {
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.equal(r.status, 202);
      assert.ok(await jobDone(p, r.json.jobId));
    } finally { console.warn = original; }
    assert.equal(seen.logo, null);
    assert.equal(seen.plan.showLogo, false);
    assert.equal(logged.filter((l) => l.includes("logo")).length, 1, logged.join("\n"));
  });

  describe("the Shorts trim", () => {
    test("shortsTrim must be a boolean", async () => {
      freshUser();
      const p = placedProject(ctx);
      for (const shortsTrim of ["true", 1, null, {}, []]) {
        assert.equal((await call("POST", `/${p.projectId}/render`, { shortsTrim })).status, 400, JSON.stringify(shortsTrim));
      }
    });
    test("a trim that is not offered is refused with the offer's sentence, before anything is charged", async () => {
      freshUser();
      const p = placedProject(ctx);
      const r = await call("POST", `/${p.projectId}/render`, { aspect: "portrait", shortsTrim: true });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, "Only for portrait songs between 3:00 and 3:10.");
      assert.equal(readUsage(ctx.dataDir).counts.render, 0);
    });
    test("a line that ends after 2:58 refuses the trim with its reason", async () => {
      freshUser();
      const p = placedProject(ctx, { n: 2, durationSec: 185, every: 178 });
      const r = await call("POST", `/${p.projectId}/render`, { aspect: "portrait", shortsTrim: true });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, "A lyric line ends after 2:58, so trimming would cut it.");
      assert.equal(readUsage(ctx.dataDir).counts.render, 0);
    });
    test("an allowed trim cuts to 2:59 and is recorded with that length", async () => {
      freshUser();
      const p = placedProject(ctx, { n: 3, durationSec: 185, every: 10 });
      let seen;
      stub.render = finishingRender(async (o) => { seen = o; });
      const r = await call("POST", `/${p.projectId}/render`, { aspect: "portrait", shortsTrim: true });
      assert.equal(r.status, 202);
      assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).renders.length === 1));
      assert.equal(seen.plan.totalSec, 179);
      const saved = readProject(ctx.dataDir, p.projectId).renders[0];
      assert.equal(saved.durationSec, 179);
      assert.equal(saved.shortsTrim, true);
    });
  });

  test("a recorded render's length is the plan's, and shortsTrim is false by default", async () => {
    freshUser();
    const p = placedProject(ctx);
    let seen;
    stub.render = finishingRender(async (o) => { seen = o; });
    await call("POST", `/${p.projectId}/render`, {});
    assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).renders.length === 1));
    const saved = readProject(ctx.dataDir, p.projectId).renders[0];
    assert.equal(saved.durationSec, seen.plan.totalSec);
    assert.equal(saved.durationSec, 13);
    assert.equal(saved.shortsTrim, false);
  });
  test("the disk check uses the extended length", async () => {
    freshUser();
    const p = placedProject(ctx);
    // 10 s at 720p is about 7.4 MB and 13 s about 9.6 MB. Room for the first with the 1 GB reserve, not the second.
    stub.statfs = () => ({ bavail: 1033, bsize: 1024 * 1024 });
    stub.render = finishingRender();
    const r = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(r.status, 507);
    await call("PUT", `/${p.projectId}/branding`, { endCard: false });
    const fits = await call("POST", `/${p.projectId}/render`, {});
    assert.equal(fits.status, 202, "no end card, no extension, it fits");
    assert.ok(await jobDone(p, fits.json.jobId));
    stub.statfs = null;
  });

  describe("a branded render that fails is made again without the logo", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
    const setup = () => {
      freshUser();
      writeLogo(ctx);
      writeBranding(ctx.dataDir, { enabled: true });
      return placedProject(ctx);
    };
    const captureWarnings = () => {
      const logged = [];
      const original = console.warn;
      console.warn = (...a) => { logged.push(a.join(" ")); };
      return { logged, restore: () => { console.warn = original; } };
    };

    test("one retry with logo null, the same plan and document; the job ends done", async () => {
      const p = setup();
      const calls = [];
      stub.render = async (o) => {
        calls.push({ ...o, assText: fs.readFileSync(o.assPath, "utf8") });
        if (calls.length === 1) { markRunning(o.jobId); return { ok: false, error: "x" }; }
        return finishingRender()(o);
      };
      const warn = captureWarnings();
      try {
        const r = await call("POST", `/${p.projectId}/render`, {});
        assert.ok(await jobDone(p, r.json.jobId));
        assert.equal((await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status, "done");
        assert.equal((await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.error, null);
      } finally { warn.restore(); }
      assert.equal(calls.length, 2);
      assert.ok(calls[0].logo, "the first try had the logo");
      assert.equal(calls[1].logo, null);
      assert.equal(calls[1].plan, calls[0].plan, "the same plan");
      assert.equal(calls[1].assText, calls[0].assText, "the same document");
      assert.equal(calls[1].assPath, calls[0].assPath);
      assert.deepEqual(warn.logged, ["[lyric-video] branded render failed, retrying without the logo: x"]);
      assert.ok(await until(() => readProject(ctx.dataDir, p.projectId).renders.length === 1));
    });
    test("a render that throws is retried too, and a second failure is a plain failed job", async () => {
      const p = setup();
      const calls = [];
      stub.render = async (o) => { calls.push(o); markRunning(o.jobId); throw new Error("filter exploded"); };
      const warn = captureWarnings();
      const errors = [];
      const original = console.error;
      console.error = (...a) => { errors.push(a.join(" ")); };
      try {
        const r = await call("POST", `/${p.projectId}/render`, {});
        assert.ok(await jobDone(p, r.json.jobId));
        await sleep(30);
        assert.equal((await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status, "error");
      } finally { warn.restore(); console.error = original; }
      assert.equal(calls.length, 2, "one retry only");
      assert.equal(calls[1].logo, null);
      assert.equal(readProject(ctx.dataDir, p.projectId).renders.length, 0);
    });
    test("a cancelled render is never retried", async () => {
      const p = setup();
      const calls = [];
      stub.render = async (o) => {
        calls.push(o);
        markRunning(o.jobId);
        cancelJob(o.jobId, ctx.userId);
        return { ok: false, error: "Render cancelled" };
      };
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.ok(await jobDone(p, r.json.jobId));
      await sleep(40);
      assert.equal(calls.length, 1);
      assert.equal((await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.error, "Render cancelled");
    });
    test("a job cancelled during the run is not retried even when the error is something else", async () => {
      const p = setup();
      const calls = [];
      stub.render = async (o) => { calls.push(o); markRunning(o.jobId); cancelJob(o.jobId, ctx.userId); return { ok: false, error: "ffmpeg exited 255" }; };
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.ok(await jobDone(p, r.json.jobId));
      await sleep(40);
      assert.equal(calls.length, 1);
    });
    test("a render without a logo is not retried", async () => {
      freshUser();
      const p = placedProject(ctx);
      const calls = [];
      stub.render = async (o) => { calls.push(o); markRunning(o.jobId); return { ok: false, error: "x" }; };
      const r = await call("POST", `/${p.projectId}/render`, {});
      assert.ok(await until(async () => (await call("GET", `/${p.projectId}/render/${r.json.jobId}`)).json.job.status === "error"));
      await sleep(40);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].logo, null);
    });
  });
});

describe("song limits and links", () => {
  test("a song over 15 minutes is refused", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = await newProject();
    const long = path.join(ctx.outputDir, "long.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "901", "-c:a", "aac", "-b:a", "8k", long], { timeout: 60000 });
    const r = await call("POST", `/${id}/song`, { path: long });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "That song is longer than 15 minutes. Trim it and upload again.");
    assert.equal(readProject(ctx.dataDir, id).song, null);
  });
  test("a link inside the outputs folder that points outside it is refused", { skip: !hasFfmpeg && "ffmpeg not installed" }, async (t) => {
    const id = await newProject();
    const outside = path.join(root, "outside-dir");
    fs.mkdirSync(outside, { recursive: true });
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=2", "-c:a", "aac", path.join(outside, "secret.m4a")]);
    const link = path.join(ctx.outputDir, "linked");
    try { fs.symlinkSync(outside, link, "junction"); } catch { return t.skip("this OS refused to create a link"); }
    assert.equal((await call("POST", `/${id}/song`, { path: path.join(link, "secret.m4a") })).status, 400);
    assert.equal((await call("PUT", `/${id}/background`, { path: path.join(link, "secret.m4a") })).status, 400);
    assert.equal(readProject(ctx.dataDir, id).song, null);
  });
});
