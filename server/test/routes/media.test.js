import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import mediaRouter from "../../src/routes/media.js";

function tinyMp4Base64() {
  // Minimal valid MP4 ftyp box — 32 bytes. Whisper isn't invoked here; this
  // just needs to pass the ≥128 byte length gate so we know the route is wired.
  const ftyp = Buffer.concat([
    Buffer.alloc(4, 0), Buffer.from("ftypisom"), Buffer.alloc(8, 0),
    Buffer.from("isomiso2avc1mp41"), Buffer.alloc(96, 0),
  ]);
  ftyp.writeUInt32BE(ftyp.length, 0);
  return `data:video/mp4;base64,${ftyp.toString("base64")}`;
}

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
  return app;
}

describe("POST /api/media/upload-source-video", () => {
  test("writes the bytes verbatim (no audio strip) and returns the file path", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const app = makeApp(outDir);
    const res = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl: tinyMp4Base64(), filename: "sermon.mp4" });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.file, /\.mp4$/);
    assert.ok(fs.existsSync(res.body.file));
  });

  test("rejects empty / undersized payloads", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const app = makeApp(outDir);
    const res = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl: "data:video/mp4;base64,AAAA" });

    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });
});
