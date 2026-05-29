import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";

function makeApp(outDir, userId = "test-user") {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    req.ctx = { outputDir: outDir, dataDir: outDir, userId };
    next();
  });
  app.use("/api/render", renderRouter);
  return app;
}

describe("POST /api/render/captioned-video — validation", () => {
  test("rejects when videoPath is missing", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ words: [{ text: "Hi", startMs: 0, endMs: 200 }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /videoPath/);
  });

  test("rejects when words[] is empty", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const vid = path.join(outDir, "v.mp4");
    fs.writeFileSync(vid, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ videoPath: vid, words: [] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /words/);
  });

  test("accepts audioPath + backgroundPath as a videoPath alternative", async (t) => {
    // Sermon-on-background mode: pass audio+background; the route should get
    // past the "videoPath required" gate and only fail later when it tries to
    // resolve the (fake) asset paths.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const aud = path.join(outDir, "a.wav");
    const bg = path.join(outDir, "bg.mp4");
    fs.writeFileSync(aud, Buffer.alloc(200, 0));
    fs.writeFileSync(bg, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ audioPath: aud, backgroundPath: bg, words: [{ text: "Hi", startMs: 0, endMs: 200 }] });
    // Should NOT 400 on the "Provide either videoPath OR (audioPath + backgroundPath)"
    // gate. A later probe failure (because the .wav/.mp4 are zeroed-out
    // sentinel files) is acceptable and is what we expect.
    if (res.status === 400) {
      assert.doesNotMatch(res.body.error || "", /Provide either/);
    }
  });

  test("accepts backgroundPaths[] (multi-background sequence)", async (t) => {
    // Multi-bg shape: pass an array; same probe-failure-on-fake-file pattern
    // as the single-bg case but locks the new contract.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const aud = path.join(outDir, "a.wav");
    const bg1 = path.join(outDir, "bg1.mp4");
    const bg2 = path.join(outDir, "bg2.mp4");
    fs.writeFileSync(aud, Buffer.alloc(200, 0));
    fs.writeFileSync(bg1, Buffer.alloc(200, 0));
    fs.writeFileSync(bg2, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({
        audioPath: aud,
        backgroundPaths: [bg1, bg2],
        words: [{ text: "Hi", startMs: 0, endMs: 200 }],
      });
    if (res.status === 400) {
      assert.doesNotMatch(res.body.error || "", /Provide either/);
      assert.doesNotMatch(res.body.error || "", /at most/);
    }
  });

  test("rejects more than 4 backgrounds", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const aud = path.join(outDir, "a.wav");
    fs.writeFileSync(aud, Buffer.alloc(200, 0));
    const bgs = ["bg1.mp4", "bg2.mp4", "bg3.mp4", "bg4.mp4", "bg5.mp4"].map((n) => {
      const p = path.join(outDir, n);
      fs.writeFileSync(p, Buffer.alloc(200, 0));
      return p;
    });
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({
        audioPath: aud,
        backgroundPaths: bgs,
        words: [{ text: "Hi", startMs: 0, endMs: 200 }],
      });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /at most 4 backgrounds/);
  });
});

describe("GET /api/render/captioned-video-history — listing + isolation", () => {
  test("returns empty list when no renders exist", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .get("/api/render/captioned-video-history");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.items.length, 0);
  });

  test("lists prior renders newest-first", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    // Seed two history entries directly via the helper so the test doesn't
    // depend on a live ffmpeg run.
    const { appendRender } = await import("../../src/lib/renderHistory.js");
    appendRender(outDir, { jobId: "j1", file: "/tmp/one.mp4", createdAt: 1000, durationSec: 30, mode: "video" });
    appendRender(outDir, { jobId: "j2", file: "/tmp/two.mp4", createdAt: 2000, durationSec: 45, mode: "audio+bg" });

    const res = await request(makeApp(outDir))
      .get("/api/render/captioned-video-history");
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.items[0].jobId, "j2", "newest first");
    assert.equal(res.body.items[1].jobId, "j1");
  });
});

describe("GET /api/render/captioned-video-status/:jobId — auth + lookup", () => {
  test("404s when job doesn't exist", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .get("/api/render/captioned-video-status/does-not-exist");
    assert.equal(res.status, 404);
    assert.match(res.body.error || "", /not found/i);
  });

  test("403s when polled by a different user", async (t) => {
    // Drive a real job creation through the route as user A, then poll status
    // as user B — must be rejected so jobs don't leak across tenants.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const aud = path.join(outDir, "a.wav");
    const bg = path.join(outDir, "bg.mp4");
    fs.writeFileSync(aud, Buffer.alloc(200, 0));
    fs.writeFileSync(bg, Buffer.alloc(200, 0));

    // Validation/probe failures still create no job, so we can't reuse the
    // sentinel-files path. Instead, point at a tiny real fixture so the route
    // gets far enough to create the job, then immediately probe status.
    const { spawnSync } = await import("child_process");
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const probeOk = spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
    if (!probeOk) return t.skip("ffmpeg not available");

    const realAud = path.join(outDir, "real.wav");
    const realBg = path.join(outDir, "real.mp4");
    spawnSync(bin, ["-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "1", realAud], { stdio: "ignore" });
    spawnSync(bin, ["-y", "-f", "lavfi", "-i", "color=size=64x64:rate=10:color=black", "-t", "1", "-pix_fmt", "yuv420p", realBg], { stdio: "ignore" });

    const created = await request(makeApp(outDir, "user-A"))
      .post("/api/render/captioned-video")
      .send({ audioPath: realAud, backgroundPath: realBg, words: [{ text: "Hi", startMs: 0, endMs: 500 }] });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.ok(created.body.jobId);

    const peek = await request(makeApp(outDir, "user-B"))
      .get(`/api/render/captioned-video-status/${created.body.jobId}`);
    assert.equal(peek.status, 403);
    assert.match(peek.body.error || "", /another user/i);
  });
});
