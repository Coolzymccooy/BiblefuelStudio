/**
 * POST /api/transcribe reads mediaPath for every caller from the caller's own
 * media folder (#112), not only for agents. Shared voice files (tts-*) in the
 * global output folder stay usable, the /outputs/ alias maps to the caller's
 * folder, and a junction inside the folder cannot lead out.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tx-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: transcribeRouter, _setTranscribeAudioImpl, _resetTranscribeAudioImpl } = await import("../../src/routes/transcribe.js");

const mine = path.join(root, "data", "users", "u1", "outputs");
const theirs = path.join(root, "data", "users", "u2", "outputs");
const door = path.join(mine, "door");
const ctx = { userId: "u1", dataDir: path.dirname(mine), outputDir: mine, isSuperAdmin: false, isOwner: false };
const seen = [];

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { sub: "u1" }; req.ctx = ctx; next(); });
  a.use("/api/transcribe", transcribeRouter);
  return a;
}

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(mine, "talk.mp3"), Buffer.alloc(200, 0));
  fs.writeFileSync(path.join(theirs, "private.mp3"), Buffer.alloc(200, 0));
  fs.writeFileSync(path.join(process.env.OUTPUT_DIR, "tts-abc.mp3"), Buffer.alloc(200, 0));
  fs.writeFileSync(path.join(process.env.OUTPUT_DIR, "owner-sermon.mp3"), Buffer.alloc(200, 0));
  fs.symlinkSync(theirs, door, "junction");
  _setTranscribeAudioImpl(async (file) => { seen.push(file); return { words: [{ text: "Amen", startMs: 0, endMs: 300 }] }; });
});

after(() => {
  _resetTranscribeAudioImpl();
  try { fs.unlinkSync(door); } catch { /* already gone */ }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

test("the caller's own file, by path or /outputs/ alias, transcribes", async () => {
  for (const mediaPath of [path.join(mine, "talk.mp3"), "/outputs/talk.mp3"]) {
    const res = await request(app()).post("/api/transcribe").send({ mediaPath });
    assert.equal(res.status, 200, `${mediaPath}: ${JSON.stringify(res.body)}`);
  }
});

test("a shared tts-* voice file in the global output folder transcribes", async () => {
  const res = await request(app()).post("/api/transcribe").send({ mediaPath: path.join(process.env.OUTPUT_DIR, "tts-abc.mp3") });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("another tenant's file, the owner's media, a junction escape and UNC paths are refused unread", async () => {
  seen.length = 0;
  for (const mediaPath of [
    path.join(theirs, "private.mp3"),
    path.join(process.env.OUTPUT_DIR, "owner-sermon.mp3"),
    path.join(door, "private.mp3"),
    "\\\\server\\share\\a.mp3",
    "http://127.0.0.1/a.mp3",
  ]) {
    const res = await request(app()).post("/api/transcribe").send({ mediaPath });
    assert.equal(res.status, 400, mediaPath);
    assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", mediaPath);
  }
  assert.deepEqual(seen, []);
});

test("a missing file inside the caller's folder still says not found", async () => {
  const res = await request(app()).post("/api/transcribe").send({ mediaPath: path.join(mine, "missing.mp3") });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "mediaPath not found");
});
