/**
 * TTS routes that hand a file to a provider (#112):
 *  - /clone-voice reads sample files: only the caller's own (or a shared
 *    tts-* voice file); anything else is 403 PATH_OUTSIDE_MEDIA before any
 *    upload.
 *  - Chatterbox takes a voice as `audio_prompt_path`, a file the bridge opens
 *    on its own host. A voice addressed to Chatterbox must be empty or a saved
 *    clone `cb:<id>` from the caller's own store; anything else is a 400, and
 *    the generic voiceId never reaches the bridge.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time; no provider but the
// stub Chatterbox bridge may be available.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tts-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });
process.env.EDGE_TTS_ENABLED = "false";
for (const k of ["ELEVENLABS_API_KEY", "AZURE_SPEECH_KEY", "FISH_API_KEY", "PIPER_URL", "CHATTERBOX_AUDIO_PROMPT"]) delete process.env[k];

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const ttsModule = await import("../../src/routes/tts.js");
const ttsRouter = ttsModule.default;
const { _setCompareSynthImpl } = ttsModule;
const { addChatterboxVoice } = await import("../../src/lib/chatterboxVoicesStore.js");

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const otherDir = path.join(process.env.DATA_DIR, "users", "them");
const mine = path.join(userDir, "outputs");
const theirs = path.join(otherDir, "outputs");
const ctx = { userId: "me", plan: "premium", dataDir: userDir, outputDir: mine };
const ownerCtx = { userId: "owner", plan: "super_admin", isSuperAdmin: true, isOwner: true, dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR };
const f = {};
let junction = null;
let bridge;
let calls = [];
let myVoice;
let theirVoice;

const wav = (file) => { fs.writeFileSync(file, Buffer.alloc(4096, 1)); return file; };

before(async () => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.own = wav(path.join(mine, "sample.wav"));
  f.theirs = wav(path.join(theirs, "secret.wav"));
  f.tts = wav(path.join(process.env.OUTPUT_DIR, "tts-edge-abc.wav"));
  f.owner = wav(path.join(process.env.OUTPUT_DIR, "owner-sample.wav"));
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  bridge = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = null;
    try { body = JSON.parse(raw.toString("utf8")); } catch { /* multipart */ }
    calls.push({ url: req.url, body, bytes: raw.length });
    if (req.url === "/upload") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: "/bridge/refs/uploaded.wav", filename: "uploaded.wav" }));
      return;
    }
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.alloc(64, 1));
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  process.env.CHATTERBOX_URL = `http://127.0.0.1:${bridge.address().port}`;
  myVoice = await addChatterboxVoice(userDir, { name: "Mine", refPath: "/bridge/refs/mine.wav" });
  theirVoice = await addChatterboxVoice(otherDir, { name: "Theirs", refPath: "/bridge/refs/theirs.wav" });
});

after(async () => {
  bridge.closeAllConnections();
  await new Promise((resolve) => bridge.close(resolve));
  if (junction) fs.rmdirSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => { calls = []; });

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/tts", ttsRouter);
  return a;
}

const consent = { hasRights: true, noImpersonation: true, termsAccepted: true };
const clone = (scope, samplePaths) => request(appFor(scope)).post("/api/tts/clone-voice")
  .send({ provider: "chatterbox", name: "Test voice", samplePaths, consent });

describe("/clone-voice sample paths", () => {
  test("refuses another tenant's file, traversal, a system path, UNC, URLs and a junction with no upload", async () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const bad = [
      f.theirs,
      f.owner,
      path.join(mine, "..", "..", "them", "outputs", "secret.wav"),
      "/outputs/../../them/outputs/secret.wav",
      "server/../../../secret.wav",
      system,
      "\\\\evil-host\\share\\a.wav",
      "//evil-host/share/a.wav",
      "http://127.0.0.1:9/a.wav",
    ];
    if (junction) bad.push(path.join(junction, "secret.wav"));
    for (const p of bad) {
      const res = await clone(ctx, [f.own, p]);
      assert.equal(res.status, 403, `${p}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", p);
    }
    assert.deepEqual(calls, [], "nothing may be uploaded");
  });

  test("clones from the caller's own sample, by path and by /outputs/ alias", async () => {
    for (const p of [f.own, "/outputs/sample.wav"]) {
      const res = await clone(ctx, [p]);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.voiceId, /^cb:/);
    }
    assert.equal(calls.filter((c) => c.url === "/upload").length, 2);
  });

  test("accepts a shared tts-* voice file", async () => {
    const res = await clone(ctx, [f.tts]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("the owner still clones from the global output folder", async () => {
    const res = await clone(ownerCtx, [f.owner]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});

const ttsCalls = () => calls.filter((c) => c.url === "/tts");

describe("Chatterbox voice ids", () => {
  test("/chatterbox refuses a voiceId that is not a saved clone, without calling the bridge", async () => {
    for (const voiceId of ["/etc/passwd", "C:\\Windows\\win.ini", "\\\\evil\\share\\x.wav", "../x.wav", "cb:", "cb:../../x", "en-US-AriaNeural"]) {
      const res = await request(appFor(ctx)).post("/api/tts/chatterbox").send({ text: "Hello there friend", voiceId });
      assert.equal(res.status, 400, `${voiceId}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, "INVALID_VOICE_ID", voiceId);
    }
    assert.deepEqual(calls, []);
  });

  test("/chatterbox resolves the caller's own clone to its reference", async () => {
    const res = await request(appFor(ctx)).post("/api/tts/chatterbox").send({ text: "Hello there friend", voiceId: myVoice.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(ttsCalls()[0].body.audio_prompt_path, "/bridge/refs/mine.wav");
  });

  test("/chatterbox does not resolve another tenant's clone", async () => {
    const res = await request(appFor(ctx)).post("/api/tts/chatterbox").send({ text: "Hello there friend", voiceId: theirVoice.id });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.deepEqual(calls, []);
  });

  test("/chatterbox with no voiceId uses the bridge's default voice", async () => {
    const res = await request(appFor(ctx)).post("/api/tts/chatterbox").send({ text: "Hello there friend" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(ttsCalls()[0].body.audio_prompt_path, undefined);
  });

  test("/synthesize-category refuses a Chatterbox override that is not a saved clone", async () => {
    const res = await request(appFor(ctx)).post("/api/tts/synthesize-category").send({
      text: "Hello there friend", category: "devotional", preferredProvider: "chatterbox",
      overrides: { voiceIds: { chatterbox: "/etc/passwd" } },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "INVALID_VOICE_ID");
    assert.deepEqual(calls, []);
  });

  test("/synthesize-category resolves a saved clone override", async () => {
    const res = await request(appFor(ctx)).post("/api/tts/synthesize-category").send({
      text: "Hello there friend", category: "devotional", preferredProvider: "chatterbox",
      overrides: { voiceIds: { chatterbox: myVoice.id } },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(ttsCalls()[0].body.audio_prompt_path, "/bridge/refs/mine.wav");
  });

  test("a generic voiceId never reaches the bridge as a file (category and auto routing)", async () => {
    const category = await request(appFor(ctx)).post("/api/tts/synthesize-category").send({
      text: "Hello there friend", category: "devotional", preferredProvider: "chatterbox",
      overrides: { voiceId: "/etc/passwd" },
    });
    assert.equal(category.status, 200, JSON.stringify(category.body));
    const auto = await request(appFor({ ...ctx, plan: "super_admin" })).post("/api/tts/auto")
      .send({ text: "Hello there friend", voiceId: "/etc/passwd" });
    assert.equal(auto.status, 200, JSON.stringify(auto.body));
    const sent = ttsCalls();
    assert.equal(sent.length, 2);
    for (const c of sent) assert.equal(c.body.audio_prompt_path, undefined, JSON.stringify(c.body));
  });

  // Ruling R36: the owner runs the bridge on their own machine and may name a
  // reference file on it. Every other account, other super-admins included,
  // is held to saved clones.
  test("the owner may send a free-text reference path on /chatterbox and /synthesize-category", async () => {
    const direct = await request(appFor(ownerCtx)).post("/api/tts/chatterbox")
      .send({ text: "Hello there friend", voiceId: "C:/voices/pastor.wav" });
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    const category = await request(appFor(ownerCtx)).post("/api/tts/synthesize-category").send({
      text: "Hello there friend", category: "devotional", preferredProvider: "chatterbox",
      overrides: { voiceIds: { chatterbox: "/home/me/voices/pastor.wav" } },
    });
    assert.equal(category.status, 200, JSON.stringify(category.body));
    assert.deepEqual(ttsCalls().map((c) => c.body.audio_prompt_path), ["C:/voices/pastor.wav", "/home/me/voices/pastor.wav"]);
  });

  test("the voices list tells the client whether a free-text reference is allowed", async () => {
    const owner = await request(appFor(ownerCtx)).get("/api/tts/chatterbox-voices");
    assert.equal(owner.body.freeTextReference, true);
    const other = await request(appFor({ ...ctx, plan: "super_admin", isSuperAdmin: true, isOwner: false })).get("/api/tts/chatterbox-voices");
    assert.equal(other.body.freeTextReference, false);
    const ids = other.body.voices.map((v) => v.id);
    assert.ok(ids.includes(myVoice.id) && !ids.includes(theirVoice.id), ids.join(" "));
  });

  test("the owner's saved clones still resolve", async () => {
    const ownerVoice = await addChatterboxVoice(process.env.DATA_DIR, { name: "Owner", refPath: "/bridge/refs/owner.wav" });
    const res = await request(appFor(ownerCtx)).post("/api/tts/chatterbox").send({ text: "Hello there friend", voiceId: ownerVoice.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(ttsCalls()[0].body.audio_prompt_path, "/bridge/refs/owner.wav");
  });

  test("another super-admin may not send a free-text reference path", async () => {
    const admin = { ...ctx, plan: "super_admin", isSuperAdmin: true, isOwner: false };
    const direct = await request(appFor(admin)).post("/api/tts/chatterbox").send({ text: "Hello there friend", voiceId: "/etc/passwd" });
    assert.equal(direct.status, 400, JSON.stringify(direct.body));
    assert.equal(direct.body.error, "INVALID_VOICE_ID");
    const category = await request(appFor(admin)).post("/api/tts/synthesize-category").send({
      text: "Hello there friend", category: "devotional", preferredProvider: "chatterbox",
      overrides: { voiceIds: { chatterbox: "/etc/passwd" } },
    });
    assert.equal(category.status, 400, JSON.stringify(category.body));
    assert.deepEqual(calls, []);
  });

  test("/compare: the owner's free-text path passes, another account's is refused", async (t) => {
    const seen = [];
    _setCompareSynthImpl(async ({ preferredProvider, voiceIds }) => {
      seen.push(voiceIds);
      return { ok: true, file: "x.mp3", provider: preferredProvider, voice: voiceIds?.[preferredProvider], words: [] };
    });
    t.after(() => _setCompareSynthImpl(null));
    const body = { text: "Hello there friend", candidates: [{ provider: "chatterbox", voiceId: "C:/voices/pastor.wav" }] };
    const owner = await request(appFor(ownerCtx)).post("/api/tts/compare").send(body);
    assert.equal(owner.body.results[0].status, "ok", JSON.stringify(owner.body));
    const other = await request(appFor({ ...ctx, plan: "super_admin", isSuperAdmin: true, isOwner: false })).post("/api/tts/compare").send(body);
    assert.equal(other.body.results[0].status, "error", JSON.stringify(other.body));
    assert.deepEqual(seen, [{ chatterbox: "C:/voices/pastor.wav" }]);
  });

  test("/compare refuses a Chatterbox candidate that is not a saved clone, and resolves one that is", async (t) => {
    const seen = [];
    _setCompareSynthImpl(async ({ preferredProvider, voiceIds }) => {
      seen.push(voiceIds);
      return { ok: true, file: "x.mp3", provider: preferredProvider, voice: voiceIds?.[preferredProvider], words: [] };
    });
    t.after(() => _setCompareSynthImpl(null));
    const res = await request(appFor(ctx)).post("/api/tts/compare").send({
      text: "Hello there friend",
      candidates: [{ provider: "chatterbox", voiceId: "/etc/passwd" }, { provider: "chatterbox", voiceId: myVoice.id }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.results[0].status, "error");
    assert.match(res.body.results[0].error, /saved clone/i);
    assert.equal(res.body.results[1].status, "ok");
    assert.deepEqual(seen, [{ chatterbox: "/bridge/refs/mine.wav" }]);
  });
});
