/**
 * /api/render/* (video, waveform, captioned-video) read every input path a
 * request names (#112). For anyone but the owner, a local input must be the
 * caller's own file, a shared tts-* voice file or a generated image made for
 * them; another tenant's file, the owner's global files, traversal, a system
 * path, UNC and a junction escape are refused with 403 PATH_OUTSIDE_MEDIA
 * before ffmpeg runs. Library refs, saved library ids and stock links keep
 * working; the owner keeps today's behaviour.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "render-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: renderRouter } = await import("../../src/routes/render.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const OUT = process.env.OUTPUT_DIR;
const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", plan: "premium", dataDir: userDir, outputDir: mine, isOwner: false };
const ownerCtx = { userId: "owner", plan: "super_admin", isSuperAdmin: true, isOwner: true, dataDir: process.env.DATA_DIR, outputDir: OUT };
const f = {};
let junction = null;
let server;
let hits = 0;

function make(file, args) {
  if (noFfmpeg) { fs.writeFileSync(file, "x"); return file; }
  const r = spawnSync(FF, ["-y", "-v", "error", ...args, file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}
const tone = (file) => make(file, ["-f", "lavfi", "-i", "sine=f=440:d=1"]);
const clip = (file) => make(file, ["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=1", "-pix_fmt", "yuv420p"]);
const still = (file) => make(file, ["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"]);

before(async () => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  fs.mkdirSync(path.join(OUT, "genImg", "genvis-me-1234abcd"), { recursive: true });
  f.voice = tone(path.join(mine, "voice.mp3"));
  f.bg = clip(path.join(mine, "bg.mp4"));
  f.theirVoice = tone(path.join(theirs, "voice.mp3"));
  f.theirBg = clip(path.join(theirs, "bg.mp4"));
  f.globalBg = clip(path.join(OUT, "owner-bg.mp4"));
  f.tts = tone(path.join(OUT, "tts-edge-abc.mp3"));
  f.genvis = still(path.join(OUT, "genImg", "genvis-me-1234abcd", "part-1.png"));
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  server = http.createServer((_req, res) => { hits += 1; res.writeHead(404).end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "701", url: `http://127.0.0.1:${server.address().port}/stock.mp4` },
    { id: "702", url: f.theirBg, previewUrl: f.theirBg },
  ] }));
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (junction) fs.rmdirSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function appFor(scope) {
  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/render", renderRouter);
  return a;
}

function outsideOf(kind) {
  const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
  const theirFile = kind === "audio" ? f.theirVoice : f.theirBg;
  const list = [theirFile, f.globalBg, "/outputs/../../them/outputs/bg.mp4",
    path.join(mine, "..", "..", "them", "outputs", "bg.mp4"), system, "\\\\evil-host\\share\\a.mp4", "702"];
  if (junction) list.push(path.join(junction, path.basename(theirFile)));
  return list;
}

const words = [{ text: "Peace", startMs: 0, endMs: 500 }];
const produced = () => fs.readdirSync(mine).filter((n) => /\.(mp4|txt)$/.test(n) && !["bg.mp4"].includes(n));

async function assertAllRefused(name, cases) {
  const cap = captureFfmpegReports(path.join(root, `reports-${name}`));
  try {
    for (const [label, send] of cases) {
      const res = await send();
      assert.equal(res.status, 403, `${name} ${label}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", `${name} ${label}`);
    }
    // The route's one-off `ffmpeg -version` availability probe opens nothing.
    const runs = cap.commands().filter((c) => !c.tokens.includes("-version"));
    assert.deepEqual(runs, [], `${name}: ffmpeg/ffprobe must not run`);
  } finally {
    cap.stop();
  }
  assert.deepEqual(produced(), [], `${name}: nothing may be written`);
}

const post = (scope, route, body) => request(appFor(scope)).post(`/api/render/${route}`).send(body);

describe("render routes refuse a non-owner's paths outside their folder", () => {
  test("/video: background, audio and music", async () => {
    const cases = [];
    for (const bad of outsideOf("video")) cases.push([`bg ${bad}`, () => post(ctx, "video", { backgroundPath: bad, lines: ["Peace"], durationSec: 1 })]);
    for (const bad of outsideOf("audio")) {
      cases.push([`audio ${bad}`, () => post(ctx, "video", { backgroundPath: f.bg, audioPath: bad, lines: ["Peace"], durationSec: 1 })]);
      cases.push([`music ${bad}`, () => post(ctx, "video", { backgroundPath: f.bg, musicPath: bad, lines: ["Peace"], durationSec: 1 })]);
    }
    await assertAllRefused("video", cases);
  });

  test("/waveform: audio, background and music", async () => {
    const cases = [];
    for (const bad of outsideOf("audio")) cases.push([`audio ${bad}`, () => post(ctx, "waveform", { audioPath: bad, durationSec: 1 })]);
    for (const bad of outsideOf("video")) {
      cases.push([`bg ${bad}`, () => post(ctx, "waveform", { audioPath: f.voice, backgroundPath: bad, durationSec: 1 })]);
      cases.push([`music ${bad}`, () => post(ctx, "waveform", { audioPath: f.voice, musicPath: bad, durationSec: 1 })]);
    }
    await assertAllRefused("waveform", cases);
  });

  test("/captioned-video: video, audio, backgrounds and music tracks", async () => {
    const cases = [];
    for (const bad of outsideOf("video")) {
      cases.push([`video ${bad}`, () => post(ctx, "captioned-video", { videoPath: bad, words })]);
      cases.push([`bg ${bad}`, () => post(ctx, "captioned-video", { audioPath: f.voice, backgroundPaths: [f.bg, bad], words })]);
      cases.push([`bg1 ${bad}`, () => post(ctx, "captioned-video", { audioPath: f.voice, backgroundPath: bad, words })]);
      cases.push([`music ${bad}`, () => post(ctx, "captioned-video", { audioPath: f.voice, backgroundPaths: [f.bg], musicPaths: [f.voice, bad], words })]);
    }
    for (const bad of outsideOf("audio")) cases.push([`audio ${bad}`, () => post(ctx, "captioned-video", { audioPath: bad, backgroundPaths: [f.bg], words })]);
    await assertAllRefused("captioned", cases);
  });

  test("the /outputs/ alias of a global file looks only in the caller's own folder", async () => {
    const cap = captureFfmpegReports(path.join(root, "reports-alias"));
    try {
      for (const [route, body] of [
        ["video", { backgroundPath: "/outputs/owner-bg.mp4", lines: ["Peace"], durationSec: 1 }],
        ["waveform", { audioPath: "/outputs/owner-bg.mp4", durationSec: 1 }],
        ["captioned-video", { videoPath: "/outputs/owner-bg.mp4", words }],
      ]) {
        const res = await post(ctx, route, body);
        assert.equal(res.status, 400, `${route}: ${JSON.stringify(res.body)}`);
        assert.match(res.body.error, /not found/i);
      }
      assert.deepEqual(cap.commands().filter((c) => !c.tokens.includes("-version")), []);
    } finally {
      cap.stop();
    }
  });

  test("a saved library item's stock link still goes to the SSRF-guarded download", async () => {
    hits = 0;
    const res = await post(ctx, "captioned-video", { audioPath: f.voice, backgroundPaths: ["701"], words });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(String(res.body.error).startsWith("URL_PRIVATE: "), res.body.error);
    assert.equal(hits, 0);
  });
});

describe("render routes still serve own and shared media", { skip: noFfmpeg }, () => {
  test("/video with own background and voice, a shared tts-* file and bundled music", async () => {
    let res = await post(ctx, "video", { backgroundPath: f.bg, audioPath: f.voice, musicPath: "library:peaceful-worship", lines: ["Peace"], durationSec: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await post(ctx, "video", { backgroundPath: "/outputs/bg.mp4", audioPath: f.tts, lines: ["Peace"], durationSec: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("/waveform with own voice", async () => {
    const res = await post(ctx, "waveform", { audioPath: f.voice, backgroundPath: f.bg, durationSec: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("/captioned-video with own voice, own background and an own generated image", async () => {
    const res = await post(ctx, "captioned-video", { audioPath: f.voice, backgroundPaths: [f.bg, f.genvis], words });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.jobId);
  });

  test("the owner keeps today's behaviour", async () => {
    const res = await post(ownerCtx, "video", { backgroundPath: f.theirBg, audioPath: f.theirVoice, lines: ["Peace"], durationSec: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
