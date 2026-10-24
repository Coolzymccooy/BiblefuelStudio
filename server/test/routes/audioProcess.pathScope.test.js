/**
 * POST /api/audio/process reads the file named by inputPath (#112). It must
 * be the caller's own file (or a shared tts-* voice file); anything else is
 * refused with 403 PATH_OUTSIDE_MEDIA before ffmpeg runs.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawnSync } from "node:child_process";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-process-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: audioRouter } = await import("../../src/routes/audio.js");
const { captureFfmpegReports, unguardedInputs } = await import("../helpers/ffreport.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const mine = path.join(process.env.DATA_DIR, "users", "me", "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", dataDir: path.dirname(mine), outputDir: mine };
const ownerCtx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
const files = {};

function tone(file) {
  if (noFfmpeg) { fs.writeFileSync(file, "x"); return file; }
  const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=1", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return file;
}

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  files.own = tone(path.join(mine, "mine.mp3"));
  files.theirs = tone(path.join(theirs, "theirs.mp3"));
  files.tts = tone(path.join(process.env.OUTPUT_DIR, "tts-edge-abc.mp3"));
  files.owner = tone(path.join(process.env.OUTPUT_DIR, "owner.mp3"));
});

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/audio", audioRouter);
  return a;
}

const processed = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("audio-processed-"));

function assertOutside(res) {
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
  assert.equal(typeof res.body.message, "string");
}

describe("/api/audio/process path scope", () => {
  test("refuses another tenant's file, traversal, a system path, UNC and URLs without running ffmpeg", async () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const bad = [
      files.theirs,
      path.join(mine, "..", "..", "them", "outputs", "theirs.mp3"),
      "/outputs/../../them/outputs/theirs.mp3",
      system,
      "\\\\evil-host\\share\\a.wav",
      "//evil-host/share/a.wav",
      "http://127.0.0.1:9/a.mp3",
      "concat:a|b",
    ];
    const cap = captureFfmpegReports(path.join(root, "reports-refused"));
    try {
      for (const inputPath of bad) {
        const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath, preset: "raw" });
        assertOutside(res);
      }
      assert.deepEqual(cap.commands(), [], "ffmpeg must not run for a refused path");
    } finally {
      cap.stop();
    }
    assert.deepEqual(processed(mine), []);
  });

  test("refuses a junction inside the folder that leads to another tenant", async (t) => {
    const link = path.join(mine, "escape");
    try {
      fs.symlinkSync(theirs, link, "junction");
    } catch (err) {
      t.skip(`cannot create a junction here: ${err.code}`);
      return;
    }
    t.after(() => fs.rmdirSync(link));
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: path.join(link, "theirs.mp3"), preset: "raw" });
    assertOutside(res);
    assert.deepEqual(processed(mine), []);
  });

  test("the owner's global files are outside an ordinary user's scope", async () => {
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: files.owner, preset: "raw" });
    assertOutside(res);
  });

  test("a missing input is a 400, not a 403", async () => {
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: path.join(mine, "nope.mp3") });
    assert.equal(res.status, 400);
  });

  test("processes the caller's own file", { skip: noFfmpeg }, async () => {
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: files.own, preset: "clean_voice" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(fs.existsSync(res.body.file));
    assert.equal(path.dirname(path.resolve(res.body.file)), path.resolve(mine));
  });

  test("ffmpeg reads the caller's file under -protocol_whitelist file,pipe", { skip: noFfmpeg }, async () => {
    // Reports are named per program and second, so the case has to run
    // ffmpeg once: preset raw skips the loudnorm measure, and an undecodable
    // input fails the encode so the MP3 header remux never runs.
    const bogus = path.join(mine, "not-audio.mp3");
    fs.writeFileSync(bogus, "this is not audio");
    const cap = captureFfmpegReports(path.join(root, "reports-guard"));
    let res;
    try {
      res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: bogus, preset: "raw" });
    } finally {
      cap.stop();
    }
    assert.equal(res.status, 400, JSON.stringify(res.body));
    const runs = cap.commands().filter((c) => c.program === "ffmpeg");
    assert.equal(runs.length, 1);
    const { tokens } = runs[0];
    assert.deepEqual(unguardedInputs(tokens), [], tokens.join(" "));
    assert.ok(tokens.some((tok, i) => tokens[i - 1] === "-i" && path.resolve(tok) === path.resolve(fs.realpathSync(bogus))), tokens.join(" "));
  });

  test("accepts the /outputs/ alias for the caller's own file", { skip: noFfmpeg }, async () => {
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: "/outputs/mine.mp3", preset: "raw" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("accepts a shared tts-* voice file", { skip: noFfmpeg }, async () => {
    const res = await request(appFor(ctx)).post("/api/audio/process").send({ inputPath: files.tts, preset: "raw" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("the owner still processes files in the global output folder", { skip: noFfmpeg }, async () => {
    const res = await request(appFor(ownerCtx)).post("/api/audio/process").send({ inputPath: files.owner, preset: "raw" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(path.dirname(path.resolve(res.body.file)), path.resolve(process.env.OUTPUT_DIR));
  });
});
