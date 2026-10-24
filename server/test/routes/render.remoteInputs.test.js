/**
 * Remote inputs to the render routes are fetched by the server only through
 * the SSRF guard, and never handed to ffmpeg as URLs (ffmpeg would fetch them
 * unvetted). A loopback fixture counts every request it receives: a refused
 * input must reach it zero times (no HEAD pre-check, no ffmpeg fetch).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";

let server;
let port;
let hits = 0;

before(async () => {
  server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "video/mp4", "content-length": "4096" }).end(Buffer.alloc(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir, userId: "u-remote" }; next(); });
  app.use("/api/render", renderRouter);
  return app;
}

function sandbox(t) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-remote-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const audio = path.join(outDir, "a.wav");
  const bg = path.join(outDir, "bg.mp4");
  fs.writeFileSync(audio, Buffer.alloc(200, 0));
  fs.writeFileSync(bg, Buffer.alloc(200, 0));
  return { app: makeApp(outDir), audio, bg };
}

const loopback = (p) => `http://127.0.0.1:${port}${p}`;
const METADATA = "http://169.254.169.254/latest/meta-data/x.mp4";
const words = [{ text: "Hi", startMs: 0, endMs: 200 }];

function assertRefused(res, code = "URL_PRIVATE") {
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.ok, false);
  assert.ok(String(res.body.error).startsWith(`${code}: `), res.body.error);
}

describe("POST /api/render/captioned-video remote inputs", () => {
  test("a private background is refused with 400 URL_PRIVATE and never requested (no HEAD)", async (t) => {
    const { app, audio } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: audio, backgroundPaths: [loopback("/bg.mp4")], words });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("a metadata-address background is refused with 400, not 502", async (t) => {
    const { app, audio } = sandbox(t);
    const res = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: audio, backgroundPath: METADATA, words });
    assertRefused(res);
  });

  test("a private remote audioPath is refused, not handed to ffprobe", async (t) => {
    const { app, bg } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: loopback("/voice.mp3"), backgroundPath: bg, words });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("a private videoPath is refused with 400", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/captioned-video")
      .send({ videoPath: loopback("/v.mp4"), words });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("single-slash and no-slash http: forms are refused, not handed to ffmpeg", async (t) => {
    const { app, audio, bg } = sandbox(t);
    hits = 0;
    const bgRes = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: audio, backgroundPath: `http:/127.0.0.1:${port}/bg.mp4`, words });
    assertRefused(bgRes);
    const audioRes = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: `http:127.0.0.1:${port}/a.mp3`, backgroundPath: bg, words });
    assertRefused(audioRes);
    assert.equal(hits, 0);
  });

  test("a non-http scheme is refused with URL_SCHEME", async (t) => {
    const { app, audio } = sandbox(t);
    const res = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: audio, backgroundPath: `tcp://127.0.0.1:${port}`, words });
    assertRefused(res, "URL_SCHEME");
  });

  test("an IPv6 loopback background is refused", async (t) => {
    const { app, audio } = sandbox(t);
    const res = await request(app).post("/api/render/captioned-video")
      .send({ audioPath: audio, backgroundPath: "http://[::1]/bg.mp4", words });
    assertRefused(res);
  });
});

describe("POST /api/render/video and /waveform remote inputs", () => {
  test("/video refuses a private background before ffmpeg runs", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/video")
      .send({ backgroundPath: loopback("/bg.mp4"), lines: ["Hello"] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/video refuses a private music track", async (t) => {
    const { app, bg } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/video")
      .send({ backgroundPath: bg, musicPath: loopback("/m.mp3"), lines: ["Hello"] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/waveform refuses a private audioPath before ffmpeg runs", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/render/waveform")
      .send({ audioPath: loopback("/voice.mp3"), lines: ["Hello"] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/video and /waveform refuse a single-slash http: input and other schemes", async (t) => {
    const { app, audio } = sandbox(t);
    hits = 0;
    const video = await request(app).post("/api/render/video")
      .send({ backgroundPath: `http:/127.0.0.1:${port}/bg.mp4`, lines: ["Hello"] });
    assertRefused(video);
    const wave = await request(app).post("/api/render/waveform")
      .send({ audioPath: audio, musicPath: `gopher://127.0.0.1:${port}/m`, lines: ["Hello"] });
    assertRefused(wave, "URL_SCHEME");
    assert.equal(hits, 0);
  });

  test("/waveform refuses a metadata-address background", async (t) => {
    const { app, audio } = sandbox(t);
    const res = await request(app).post("/api/render/waveform")
      .send({ audioPath: audio, backgroundPath: METADATA, lines: ["Hello"] });
    assertRefused(res);
  });
});
