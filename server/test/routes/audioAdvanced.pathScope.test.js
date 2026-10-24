/**
 * Every /api/audio-adv route that takes a path reads only the caller's own
 * files (#112): another tenant's file, traversal, a system path, a UNC path,
 * a URL or a junction out of the folder is refused with 403
 * PATH_OUTSIDE_MEDIA before ffmpeg runs. Bundled library audio, the caller's
 * saved library items and shared tts-* voice files still work, and so does
 * the owner.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-adv-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: audioAdvRouter } = await import("../../src/routes/audio_advanced.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", dataDir: userDir, outputDir: mine };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
const f = {};
let junction = null;

function make(file, args) {
  if (noFfmpeg) { fs.writeFileSync(file, "x"); return file; }
  const r = spawnSync(FF, ["-y", "-v", "error", ...args, file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}
const tone = (file) => make(file, ["-f", "lavfi", "-i", "sine=f=440:d=1"]);

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.own = tone(path.join(mine, "mine.mp3"));
  f.own2 = tone(path.join(mine, "mine2.mp3"));
  f.bg = make(path.join(mine, "bg.mp4"), ["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=10:d=1", "-pix_fmt", "yuv420p"]);
  f.theirs = tone(path.join(theirs, "theirs.mp3"));
  f.tts = tone(path.join(process.env.OUTPUT_DIR, "tts-edge-abc.mp3"));
  f.owner = tone(path.join(process.env.OUTPUT_DIR, "owner.mp3"));
  f.owner2 = tone(path.join(process.env.OUTPUT_DIR, "owner2.mp3"));
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  // The caller's saved library: one stock item that points at another
  // tenant's file on disk, which must not become a way round the rule.
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({
    items: [{ id: "777", url: f.theirs, previewUrl: f.theirs }],
  }));
});

after(() => {
  // rmdir removes the junction itself; a recursive rm would follow it.
  if (junction) fs.rmdirSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/audio-adv", audioAdvRouter);
  return a;
}

function outsidePaths() {
  const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
  const list = [
    f.theirs,
    f.owner,
    path.join(mine, "..", "..", "them", "outputs", "theirs.mp3"),
    "/outputs/../../them/outputs/theirs.mp3",
    system,
    "\\\\evil-host\\share\\a.wav",
    "//evil-host/share/a.wav",
    "http://127.0.0.1:9/a.mp3",
    "https://example.com/a.mp3",
    "tcp://127.0.0.1:9",
    "777",
  ];
  if (junction) list.push(path.join(junction, "theirs.mp3"));
  return list;
}

function assertOutside(res, what) {
  assert.equal(res.status, 403, `${what}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", what);
}

const PRODUCED = /^(waveform-|concat-|audio-merged-|audio-timeline-|timeline-preview-)/;
const produced = () => fs.readdirSync(mine).filter((n) => PRODUCED.test(n));

/** Send every outside path through `send`, assert each is refused and nothing ran. */
async function assertAllRefused(name, send) {
  const cap = captureFfmpegReports(path.join(root, `reports-${name}`));
  try {
    for (const bad of outsidePaths()) assertOutside(await send(bad), `${name} ${bad}`);
    assert.deepEqual(cap.commands(), [], `${name}: ffmpeg/ffprobe must not run`);
  } finally {
    cap.stop();
  }
  assert.deepEqual(produced(), [], `${name}: nothing may be written`);
}

const enc = encodeURIComponent;

describe("audio-adv refuses paths outside the caller's media folder", () => {
  test("GET /waveform.png", async () => {
    await assertAllRefused("waveform", (bad) => request(appFor(ctx)).get(`/api/audio-adv/waveform.png?inputPath=${enc(bad)}`));
  });

  test("GET /info", async () => {
    await assertAllRefused("info", (bad) => request(appFor(ctx)).get(`/api/audio-adv/info?inputPath=${enc(bad)}`));
  });

  test("POST /merge", async () => {
    await assertAllRefused("merge", (bad) => request(appFor(ctx)).post("/api/audio-adv/merge").send({ inputs: [f.own, bad] }));
  });

  test("POST /timeline", async () => {
    await assertAllRefused("timeline", (bad) => request(appFor(ctx)).post("/api/audio-adv/timeline")
      .send({ clips: [{ path: f.own }, { path: bad }] }));
  });

  test("POST /timeline-preview, background", async () => {
    await assertAllRefused("preview-bg", (bad) => request(appFor(ctx)).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: bad, clips: [{ path: f.own }] }));
  });

  test("POST /timeline-preview, clip", async () => {
    await assertAllRefused("preview-clip", (bad) => request(appFor(ctx)).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: f.bg, clips: [{ path: bad }] }));
  });

  test("a missing file in the caller's own folder is a 400, not a 403", async () => {
    const res = await request(appFor(ctx)).get(`/api/audio-adv/info?inputPath=${enc(path.join(mine, "nope.mp3"))}`);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("an unknown library item id is not found, not dropped or read from the server's folder", async () => {
    for (const id of ["999999", "package.json"]) {
      const res = await request(appFor(ctx)).post("/api/audio-adv/timeline").send({ clips: [{ path: f.own }, { path: id }] });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error, "FILE_NOT_FOUND");
    }
    assert.deepEqual(produced(), []);
  });
});

describe("audio-adv still serves the caller's own media", { skip: noFfmpeg }, () => {
  test("GET /waveform.png on the caller's file", async () => {
    const res = await request(appFor(ctx)).get(`/api/audio-adv/waveform.png?inputPath=${enc(f.own)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
  });

  test("GET /info on the caller's file and on its /outputs/ alias", async () => {
    for (const p of [f.own, "/outputs/mine.mp3"]) {
      const res = await request(appFor(ctx)).get(`/api/audio-adv/info?inputPath=${enc(p)}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(res.body.durationSec > 0.5);
    }
  });

  test("POST /merge of two own files", async () => {
    const res = await request(appFor(ctx)).post("/api/audio-adv/merge").send({ inputs: [f.own, f.own2] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(path.dirname(path.resolve(res.body.file)), path.resolve(mine));
  });

  test("POST /timeline with an own file, a shared tts-* file and bundled library audio", async () => {
    const res = await request(appFor(ctx)).post("/api/audio-adv/timeline").send({
      clips: [{ path: f.own }, { path: f.tts }, { path: "library:peaceful-worship", durationSec: 0.5 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("POST /timeline-preview with an own background and clip", async () => {
    const res = await request(appFor(ctx)).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: f.bg, clips: [{ path: "/outputs/mine.mp3" }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("the owner still merges files in the global output folder", async () => {
    const res = await request(appFor(ownerCtx)).post("/api/audio-adv/merge").send({ inputs: [f.owner, "/outputs/owner2.mp3"] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(path.dirname(path.resolve(res.body.file)), path.resolve(process.env.OUTPUT_DIR));
  });
});
