/**
 * Queued renders (jobs.js) must not hand remote audio, music or background
 * URLs to ffmpeg: it fetches them with no SSRF check. Each is localised through
 * the guard first, so a private address fails the job and the loopback fixture
 * below is never reached.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// jobs.js and paths.js read DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-remote-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { _setJobCtxForTest, _resetJobCtxForTest, _executeJobForTest, _renderVideoCoreForTest } =
  await import("../../src/routes/jobs.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

let server;
let port;
let hits = 0;
let localBg;
let localAudio;

before(async () => {
  server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.alloc(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  localBg = path.join(process.env.OUTPUT_DIR, "bg.mp4");
  localAudio = path.join(process.env.OUTPUT_DIR, "a.mp3");
  fs.writeFileSync(localBg, Buffer.alloc(200, 0));
  fs.writeFileSync(localAudio, Buffer.alloc(200, 0));
  _setJobCtxForTest({ userId: "u-remote", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR });
});

after(async () => {
  _resetJobCtxForTest();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const loopback = (p) => `http://127.0.0.1:${port}${p}`;
const refusedPrivate = (err) => /URL_PRIVATE/.test(String(err?.message));

describe("render_waveform job remote inputs", { skip }, () => {
  test("a private audioPath fails the job without being requested", async () => {
    hits = 0;
    await assert.rejects(
      _executeJobForTest({ id: "j-wave-audio", type: "render_waveform", payload: { audioPath: loopback("/a.mp3"), lines: ["x"] } }),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a private background fails the job", async () => {
    hits = 0;
    await assert.rejects(
      _executeJobForTest({
        id: "j-wave-bg", type: "render_waveform",
        payload: { audioPath: localAudio, backgroundPath: loopback("/bg.mp4"), lines: ["x"] },
      }),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a single-slash http: audioPath fails the job without being requested", async () => {
    hits = 0;
    await assert.rejects(
      _executeJobForTest({ id: "j-wave-slash", type: "render_waveform", payload: { audioPath: `http:/127.0.0.1:${port}/a.mp3`, lines: ["x"] } }),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a metadata-address music track fails the job", async () => {
    await assert.rejects(
      _executeJobForTest({
        id: "j-wave-music", type: "render_waveform",
        payload: { audioPath: localAudio, musicPath: "http://169.254.169.254/latest/meta-data/m.mp3", lines: ["x"] },
      }),
      refusedPrivate,
    );
  });
});

describe("render_video remote inputs", { skip }, () => {
  test("a private audioPath fails the render without being requested", async () => {
    hits = 0;
    await assert.rejects(
      _renderVideoCoreForTest({ backgroundPath: localBg, audioPath: loopback("/voice.mp3"), lines: ["Peace"], durationSec: 1 }, "j-vid-audio"),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a private music track fails the render without being requested", async () => {
    hits = 0;
    await assert.rejects(
      _renderVideoCoreForTest({ backgroundPath: localBg, musicPath: loopback("/m.mp3"), lines: ["Peace"], durationSec: 1 }, "j-vid-music"),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a background in another scheme, or http: without //, never reaches ffmpeg", async () => {
    await assert.rejects(
      _renderVideoCoreForTest({ scenes: [{ backgroundPath: `tcp://127.0.0.1:${port}`, duration: 1 }], lines: ["Peace"], durationSec: 1 }, "j-vid-tcp"),
      (err) => /URL_SCHEME/.test(String(err?.message)),
    );
    hits = 0;
    await assert.rejects(
      _renderVideoCoreForTest({ backgroundPath: `http:/127.0.0.1:${port}/bg.mp4`, lines: ["Peace"], durationSec: 1 }, "j-vid-slash"),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });

  test("a private scene background fails the render without being requested", async () => {
    hits = 0;
    await assert.rejects(
      _renderVideoCoreForTest({
        scenes: [{ backgroundPath: loopback("/s.mp4"), duration: 1 }],
        lines: ["Peace"], durationSec: 1,
      }, "j-vid-scene"),
      refusedPrivate,
    );
    assert.equal(hits, 0);
  });
});
