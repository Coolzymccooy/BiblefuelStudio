/**
 * /api/audio-adv routes hand their inputs to ffmpeg, which fetches URL inputs
 * itself with no SSRF check (including URLs written into a concat list). Remote
 * inputs must be localised through the guard first, so a private address is
 * refused and the loopback fixture below is never reached.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import audioAdvRouter from "../../src/routes/audio_advanced.js";

let server;
let port;
let hits = 0;

before(async () => {
  server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.alloc(4096));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-adv-remote-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = path.join(dir, "a.mp3");
  fs.writeFileSync(a, Buffer.alloc(200, 0));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: dir, outputDir: dir }; next(); });
  app.use("/api/audio-adv", audioAdvRouter);
  return { app, dir, a };
}

const loopback = (p) => `http://127.0.0.1:${port}${p}`;

function assertRefused(res) {
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.ok(String(res.body.error).startsWith("URL_PRIVATE: "), res.body.error);
}

describe("audio-adv remote inputs", () => {
  test("/merge refuses a private input and writes no concat list", async (t) => {
    const { app, dir, a } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/merge").send({ inputs: [a, loopback("/b.mp3")] });
    assertRefused(res);
    assert.equal(hits, 0);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith("concat-")), []);
  });

  test("/merge never writes a URL into the concat list", async (t) => {
    const { app, a } = sandbox(t);
    const res = await request(app).post("/api/audio-adv/merge").send({ inputs: [a, "http://169.254.169.254/x.mp3"] });
    assertRefused(res);
  });

  test("/timeline refuses a private clip", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/timeline").send({ clips: [{ path: loopback("/c.mp3") }] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/timeline-preview refuses a private background", async (t) => {
    const { app, a } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: loopback("/bg.mp4"), clips: [{ path: a }] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/timeline refuses a single-slash http: URL that ffmpeg would still fetch", async (t) => {
    const { app } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/timeline")
      .send({ clips: [{ path: `http:/127.0.0.1:${port}/latest/meta-data/` }] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("/timeline-preview refuses a no-slash http: background", async (t) => {
    const { app, a } = sandbox(t);
    hits = 0;
    const res = await request(app).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: `http:127.0.0.1:${port}/latest/meta-data/`, clips: [{ path: a }] });
    assertRefused(res);
    assert.equal(hits, 0);
  });

  test("other schemes (tcp:, gopher:, concat:) are refused with URL_SCHEME", async (t) => {
    const { app, a } = sandbox(t);
    for (const bad of [`tcp://127.0.0.1:${port}`, `gopher://127.0.0.1:${port}/x`, `concat:${a}|${a}`]) {
      const res = await request(app).post("/api/audio-adv/merge").send({ inputs: [a, bad] });
      assert.equal(res.status, 400, bad);
      assert.ok(String(res.body.error).startsWith("URL_SCHEME: "), `${bad}: ${res.body.error}`);
    }
  });

  test("/timeline-preview refuses a private clip", async (t) => {
    const { app, dir } = sandbox(t);
    const bg = path.join(dir, "bg.mp4");
    fs.writeFileSync(bg, Buffer.alloc(200, 0));
    hits = 0;
    const res = await request(app).post("/api/audio-adv/timeline-preview")
      .send({ backgroundPath: bg, clips: [{ path: loopback("/c.mp3") }] });
    assertRefused(res);
    assert.equal(hits, 0);
  });
});
