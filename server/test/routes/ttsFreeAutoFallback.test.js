/**
 * #120: a free plan's `auto` is Edge alone. When Edge fails and Azure is
 * configured it falls back to Azure (never to ElevenLabs or Fish, which a free
 * plan cannot use). Every provider is stubbed: no network.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tts-free-auto-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const ttsModule = await import("../../src/routes/tts.js");
const { default: ttsRouter, _setEdgeTtsImpl } = ttsModule;
const { quota } = await import("../../src/middleware/quota.js");
const { readUsage, incrementUsage } = await import("../../src/lib/usageStore.js");
const azure = await import("../../src/lib/voice/providers/azureSpeechProvider.js");

const AZURE_ENV = ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"];
const savedEnv = Object.fromEntries(AZURE_ENV.map((k) => [k, process.env[k]]));

let userSeq = 0;
function freeUser(used = 0) {
  userSeq += 1;
  const dataDir = path.join(root, "users", `u_free_${userSeq}`);
  fs.mkdirSync(dataDir, { recursive: true });
  if (used > 0) incrementUsage(dataDir, "tts", used);
  return { userId: `u_free_${userSeq}`, dataDir, plan: "free", outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
}

function appFor(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  // Same mount as index.js.
  app.use("/api/tts", quota("tts", { refundOnFailure: true }), ttsRouter);
  return app;
}

const ttsUsed = (ctx) => Number(readUsage(ctx.dataDir).counts.tts || 0);

const edgeOk = async ({ voiceId }) => ({ ok: true, file: "/outputs/tts-edge-fake.mp3", provider: "edge", voice: voiceId || "en-US-AriaNeural" });
const edgeDown = async () => { throw new Error("Edge TTS handshake refused: HTTP 403"); };

function configureAzure(synth) {
  process.env.AZURE_SPEECH_KEY = "test-key";
  process.env.AZURE_SPEECH_REGION = "uksouth";
  azure._setSynthImpl(synth);
}

function unconfigureAzure() {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  azure._resetSynthImpl();
}

before(() => unconfigureAzure());
beforeEach(() => { _setEdgeTtsImpl(null); unconfigureAzure(); });
after(() => {
  _setEdgeTtsImpl(null);
  azure._resetSynthImpl();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

test("free auto: Edge failing falls back to Azure when Azure is configured", async () => {
  _setEdgeTtsImpl(edgeDown);
  const azureCalls = [];
  configureAzure(async ({ text, voice }) => {
    azureCalls.push({ text, voice });
    return { audio: Buffer.from([0xff, 0xf3, 0x44, 0xc4]), boundaries: [] };
  });
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/auto").send({ text: "Hello there.", voiceId: "en-GB-RyanNeural" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.provider, "azure");
  assert.equal(res.body.fallbackProvider, "azure");
  assert.equal(res.body.primaryProvider, "edge");
  assert.match(res.body.primaryError, /403/);
  assert.ok(res.body.file);
  assert.deepEqual(azureCalls, [{ text: "Hello there.", voice: "en-GB-RyanNeural" }]);
  assert.equal(ttsUsed(ctx), 1);
});

test("free auto: Edge working never touches Azure", async () => {
  _setEdgeTtsImpl(edgeOk);
  let azureCalled = false;
  configureAzure(async () => { azureCalled = true; return { audio: Buffer.from([1]), boundaries: [] }; });
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/auto").send({ text: "Hello there." });
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, "edge");
  assert.equal(res.body.fallbackProvider, undefined);
  assert.equal(azureCalled, false);
});

test("free auto: both Edge and Azure failing is a 502 naming both, and spends no tts", async () => {
  _setEdgeTtsImpl(edgeDown);
  configureAzure(async () => { throw new Error("Azure 401 Unauthorized"); });
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/auto").send({ text: "Hello there." });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /Edge-TTS.*403/);
  assert.match(res.body.error, /Azure.*401/);
  assert.equal(ttsUsed(ctx), 0);
});

test("free auto: bad input is not retried on Azure", async () => {
  _setEdgeTtsImpl(async () => { throw new Error("text required (min 3 chars)"); });
  let azureCalled = false;
  configureAzure(async () => { azureCalled = true; return { audio: Buffer.from([1]), boundaries: [] }; });
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/auto").send({ text: "Hi" });
  assert.equal(res.status, 400);
  assert.equal(azureCalled, false);
  assert.equal(ttsUsed(ctx), 0);
});
