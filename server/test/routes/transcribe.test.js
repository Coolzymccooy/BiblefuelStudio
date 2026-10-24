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

function makeAgentApp(outDir, user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/transcribe", transcribeRouter);
  return app;
}

describe("POST /api/transcribe — media-folder jail for agents", () => {
  const AGENT = { sub: "u1", via: "mcp" };

  test("an mcp call with a path outside the media folder is refused before any fs read", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-jail-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const outside = path.join(os.tmpdir(), "somewhere-else", "secret.mp3");
    const exists = t.mock.method(fs, "existsSync");
    const res = await request(makeAgentApp(outDir, AGENT)).post("/api/transcribe").send({ mediaPath: outside });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      ok: false,
      error: "PATH_OUTSIDE_MEDIA",
      message: "mediaPath must be a file in your media folder",
    });
    assert.equal(exists.mock.callCount(), 0, "the existence of an outside file is never probed");
  });

  test("a ../ escape from the media folder is refused", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-jail-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeAgentApp(outDir, AGENT)).post("/api/transcribe")
      .send({ mediaPath: path.join(outDir, "..", "elsewhere.mp3") });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
  });

  test("an mcp call with a path inside the media folder proceeds to the existence check", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-jail-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeAgentApp(outDir, AGENT)).post("/api/transcribe")
      .send({ mediaPath: path.join(outDir, "missing.mp3") });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "mediaPath not found");
  });

  test("an mcp call with an existing file inside the media folder transcribes", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-jail-"));
    const audioPath = path.join(outDir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => {
      _resetTranscribeAudioImpl();
      fs.rmSync(outDir, { recursive: true, force: true });
    });
    _setTranscribeAudioImpl(async () => ({ words: [{ text: "Amen", startMs: 0, endMs: 300 }] }));
    const res = await request(makeAgentApp(outDir, AGENT)).post("/api/transcribe").send({ mediaPath: audioPath });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.words, [{ text: "Amen", startMs: 0, endMs: 300 }]);
  });

  test("a normal app session may still name a file outside the media folder", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-jail-"));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "tx-elsewhere-"));
    const audioPath = path.join(elsewhere, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => {
      _resetTranscribeAudioImpl();
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(elsewhere, { recursive: true, force: true });
    });
    _setTranscribeAudioImpl(async () => ({ words: [{ text: "Grace", startMs: 0, endMs: 400 }] }));
    const res = await request(makeAgentApp(outDir, { sub: "u1", role: "user" })).post("/api/transcribe")
      .send({ mediaPath: audioPath });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
