import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";

import transcribeRouter, {
  _setTranscribeAudioImpl,
  _resetTranscribeAudioImpl,
} from "../../src/routes/transcribe.js";

function makeApp(outDir) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/transcribe", transcribeRouter);
  return app;
}

describe("POST /api/transcribe", () => {
  test("returns 400 when mediaPath is missing", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir)).post("/api/transcribe").send({});
    assert.equal(res.status, 400);
  });

  test("returns words contract when transcribeAudio resolves", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(outDir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => {
      _resetTranscribeAudioImpl();
      fs.rmSync(outDir, { recursive: true, force: true });
    });

    _setTranscribeAudioImpl(async () => ({
      words: [{ text: "Grace", startMs: 0, endMs: 400 }],
    }));

    const res = await request(makeApp(outDir)).post("/api/transcribe").send({ mediaPath: audioPath });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.words, [{ text: "Grace", startMs: 0, endMs: 400 }]);
  });

  test("returns 502 when transcribeAudio returns null", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(outDir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => {
      _resetTranscribeAudioImpl();
      fs.rmSync(outDir, { recursive: true, force: true });
    });

    _setTranscribeAudioImpl(async () => null);

    const res = await request(makeApp(outDir)).post("/api/transcribe").send({ mediaPath: audioPath });
    assert.equal(res.status, 502);
  });
});
