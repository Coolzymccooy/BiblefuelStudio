import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
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
});
