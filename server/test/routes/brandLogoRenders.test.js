import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";
import audioAdvRouter from "../../src/routes/audio_advanced.js";
import {
  _setJobCtxForTest, _resetJobCtxForTest, _renderVideoCoreForTest, _executeJobForTest,
} from "../../src/routes/jobs.js";
import { logoFileFor, logoGeometry, writeBranding } from "../../src/lib/branding.js";

// The operator asked for the channel logo on EVERY video the studio makes.
// These render real (tiny) videos through each route and job path and look at
// the pixels: a solid red logo must sit in the top-right corner of a solid
// green picture. A filter string can look right and still draw nothing.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const skip = !hasFfmpeg && "ffmpeg not installed";

let dir;
let media;

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

function dims(video) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video]);
  const [w, h] = String(r.stdout).trim().split(",").map(Number);
  return { w, h };
}

function pixelAt(video, x, y, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 3)];
}

/** True when the top-right logo square is red, early and late in the video. */
function assertLogo(video, { present = true, late = 0.8 } = {}) {
  assert.ok(fs.existsSync(video), `no output at ${video}`);
  const { w, h } = dims(video);
  const { box: width, marginX, marginY } = logoGeometry(w, h);
  const x = w - marginX - width / 2;
  const y = marginY + width / 2;
  for (const t of [0.1, late]) {
    const [r, g] = pixelAt(video, x, y, t);
    if (present) assert.ok(r > 170 && g < 100, `${path.basename(video)} at ${t}s: expected the logo, got rgb ${r},${g}`);
    else assert.ok(r < 100, `${path.basename(video)} at ${t}s: expected no logo, got rgb ${r},${g}`);
  }
}

function app(ctx) {
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use((req, _res, next) => { req.ctx = ctx; next(); });
  a.use("/api/render", renderRouter);
  a.use("/api/audio-adv", audioAdvRouter);
  return a;
}

before(() => {
  if (!hasFfmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-render-"));
  media = {
    bg: path.join(dir, "bg.mp4"),
    clip: path.join(dir, "clip.mp4"),
    voice: path.join(dir, "voice.m4a"),
    music: path.join(dir, "music.m4a"),
  };
  ff(["-f", "lavfi", "-i", "color=c=0x00FF00:s=320x240:d=2:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", media.bg]);
  ff(["-f", "lavfi", "-i", "color=c=0x00FF00:s=640x360:d=2:r=25", "-f", "lavfi", "-i", "sine=f=330:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media.clip]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=2", "-c:a", "aac", media.voice]);
  ff(["-f", "lavfi", "-i", "sine=f=220:d=2", "-c:a", "aac", media.music]);
  // A branded account: logo uploaded, branding on, fully opaque for the test.
  fs.mkdirSync(path.dirname(logoFileFor(dir)), { recursive: true });
  ff(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", logoFileFor(dir)]);
  writeBranding(dir, { enabled: true, opacity: 1 });
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const ctx = () => ({ dataDir: dir, outputDir: dir, userId: "brand-user" });

describe("render routes draw the account logo", { skip }, () => {
  test("quick render, no music (plain -vf chain)", async () => {
    const res = await request(app(ctx())).post("/api/render/video")
      .send({ backgroundPath: media.bg, lines: ["Peace"], durationSec: 3, aspect: "landscape" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Quick renders fade to black at the end, logo included; sample before it.
    assertLogo(res.body.file, { late: 1.5 });
  });

  test("quick render with music (filter graph)", async () => {
    const res = await request(app(ctx())).post("/api/render/video")
      .send({ backgroundPath: media.bg, musicPath: media.music, audioPath: media.voice, lines: ["Peace"], durationSec: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertLogo(res.body.file, { late: 1.5 });
  });

  test("waveform render", async () => {
    const res = await request(app(ctx())).post("/api/render/waveform")
      .send({ backgroundPath: media.bg, audioPath: media.voice, lines: ["Peace"], durationSec: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertLogo(res.body.file);
  });

  test("captioned video", async () => {
    const res = await request(app(ctx())).post("/api/render/captioned-video")
      .send({ videoPath: media.clip, words: [{ text: "Peace", startMs: 0, endMs: 900 }, { text: "be", startMs: 900, endMs: 1800 }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    let job = res.body;
    for (let i = 0; i < 120 && !["done", "error", "cancelled"].includes(job.status); i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      job = (await request(app(ctx())).get(`/api/render/captioned-video-status/${res.body.jobId}`)).body;
    }
    assert.equal(job.status, "done", JSON.stringify(job));
    // The ending fade runs over the last stretch; check before it starts.
    assertLogo(job.file, { late: 1.0 });
  });

  test("an account with branding off gets no logo", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "brand-off-"));
    try {
      const res = await request(app({ dataDir: plain, outputDir: plain, userId: "plain" })).post("/api/render/video")
        .send({ backgroundPath: media.bg, lines: ["Peace"], durationSec: 1, aspect: "landscape" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assertLogo(res.body.file, { present: false });
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("background render jobs draw the account logo", { skip }, () => {
  before(() => _setJobCtxForTest(ctx()));
  after(() => _resetJobCtxForTest());

  test("render_video, single background", async () => {
    const { outFile } = await _renderVideoCoreForTest({ backgroundPath: media.bg, lines: ["Peace"], durationSec: 1 }, "t-simple");
    assertLogo(outFile);
  });

  test("render_video with music", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, musicPath: media.music, lines: ["Peace"], durationSec: 1,
    }, "t-music");
    assertLogo(outFile);
  });

  test("render_video with word timings (series and auto-posts render this way)", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, durationSec: 2,
      words: [{ text: "Peace", start: 0, end: 0.9 }, { text: "be", start: 0.9, end: 1.8 }],
    }, "t-words");
    assertLogo(outFile, { late: 1.0 });
  });

  test("render_waveform", async () => {
    const { outFile } = await _executeJobForTest({
      id: "t-wave", type: "render_waveform",
      payload: { backgroundPath: media.bg, audioPath: media.voice, lines: ["Peace"], durationSec: 1 },
    });
    assertLogo(outFile);
  });
});

describe("the timeline's quick preview draws the account logo", { skip }, () => {
  // The timeline's Preview button renders through /api/audio-adv/timeline-preview,
  // not the timeline renderer, so it must brand the picture too, or the
  // preview misleads about what the final render will hold.
  const preview = (c) => request(app(c)).post("/api/audio-adv/timeline-preview")
    .send({ backgroundPath: media.bg, clips: [{ path: media.voice }], normalizeLUFS: -14 });

  test("a branded account sees its logo in the preview", async () => {
    const res = await preview(ctx());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertLogo(res.body.file, { late: 1.5 });
  });

  test("a preview with no loudness or fades still renders (it used an ffmpeg filter that doesn't exist)", async () => {
    const res = await request(app(ctx())).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: media.bg, clips: [{ path: media.voice }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertLogo(res.body.file, { late: 1.5 });
  });

  test("an account with branding off gets a preview without one", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "brand-off-"));
    try {
      const res = await preview({ dataDir: plain, outputDir: plain, userId: "plain" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assertLogo(res.body.file, { present: false, late: 1.5 });
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
