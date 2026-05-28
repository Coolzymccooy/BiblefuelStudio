import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";
import request from "supertest";

import mediaRouter from "../../src/routes/media.js";
import transcribeRouter, {
  _setTranscribeAudioImpl,
  _resetTranscribeAudioImpl,
} from "../../src/routes/transcribe.js";
import renderRouter from "../../src/routes/render.js";

function ffmpegAvailable() {
  const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try { return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0; }
  catch { return false; }
}

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
  app.use("/api/transcribe", transcribeRouter);
  app.use("/api/render", renderRouter);
  return app;
}

describe("Sermon Clip Studio — end-to-end (Whisper stubbed)", () => {
  test("upload video → transcribe → render captioned video", async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg not available");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "scs-"));
    t.after(() => {
      _resetTranscribeAudioImpl();
      fs.rmSync(outDir, { recursive: true, force: true });
    });

    // 1. Synthesise a 2s test video with silent audio so the route's ffprobe
    //    can resolve real dimensions + duration.
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const fixture = path.join(outDir, "fixture.mp4");
    const r = spawnSync(bin, [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x180:rate=10:color=black",
      "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
      "-t", "2", "-pix_fmt", "yuv420p", fixture,
    ], { stdio: "ignore" });
    assert.equal(r.status, 0, "fixture generation must succeed");

    // 2. Upload as a source video via the public dataUrl endpoint.
    const app = makeApp(outDir);
    const dataUrl = `data:video/mp4;base64,${fs.readFileSync(fixture).toString("base64")}`;
    const upload = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl, filename: "fixture.mp4" });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    assert.ok(upload.body.file);

    // 3. Stub Whisper, run transcribe.
    _setTranscribeAudioImpl(async () => ({
      words: [
        { text: "Test",  startMs:   0, endMs:  500 },
        { text: "verse", startMs: 500, endMs: 1500 },
      ],
    }));

    const tx = await request(app).post("/api/transcribe").send({ mediaPath: upload.body.file });
    assert.equal(tx.status, 200, JSON.stringify(tx.body));
    assert.ok(Array.isArray(tx.body.words) && tx.body.words.length > 0);

    // 4. Render captioned video — burns the transcribe-shaped words onto the
    //    source video's own frames via buildWordDrawtext.
    const render = await request(app)
      .post("/api/render/captioned-video")
      .send({ videoPath: upload.body.file, words: tx.body.words });
    assert.equal(render.status, 200, JSON.stringify(render.body));
    assert.ok(fs.existsSync(render.body.file), "rendered file must exist on disk");
    assert.ok(fs.statSync(render.body.file).size > 0, "rendered file must be non-empty");
  });
});
