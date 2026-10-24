/**
 * #120: a TTS call that produces no audio spends no plan tts quota (the /api/tts
 * mount refunds any error response). Every provider is stubbed: no network.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tts-quota-refund-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const ttsModule = await import("../../src/routes/tts.js");
const { default: ttsRouter, _setEdgeTtsImpl, _setCompareSynthImpl } = ttsModule;
const { quota, QUOTAS } = await import("../../src/middleware/quota.js");
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

function unconfigureAzure() {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  azure._resetSynthImpl();
}

before(() => unconfigureAzure());
beforeEach(() => { _setEdgeTtsImpl(null); _setCompareSynthImpl(null); unconfigureAzure(); });
after(() => {
  _setEdgeTtsImpl(null);
  _setCompareSynthImpl(null);
  azure._resetSynthImpl();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

test("a successful Edge synthesis spends one tts", async () => {
  _setEdgeTtsImpl(edgeOk);
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/edge").send({ text: "Hello there." });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(ttsUsed(ctx), 1);
});

test("a failed Edge synthesis spends no tts", async () => {
  _setEdgeTtsImpl(edgeDown);
  const ctx = freeUser(3);
  const res = await request(appFor(ctx)).post("/api/tts/edge").send({ text: "Hello there." });
  assert.equal(res.status, 502);
  assert.equal(ttsUsed(ctx), 3);
});

test("a refused request (bad input) spends no tts", async () => {
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/edge").send({ text: "" });
  assert.equal(res.status, 400);
  assert.equal(ttsUsed(ctx), 0);
});

test("a premium-only provider refused on a free plan spends no tts", async () => {
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/elevenlabs").send({ text: "Hello there." });
  assert.equal(res.status, 403);
  assert.equal(ttsUsed(ctx), 0);
});

test("at the limit the call is still refused with QUOTA_EXCEEDED and nothing is given back", async () => {
  _setEdgeTtsImpl(edgeOk);
  const ctx = freeUser(QUOTAS.free.tts);
  const res = await request(appFor(ctx)).post("/api/tts/edge").send({ text: "Hello there." });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "QUOTA_EXCEEDED");
  assert.equal(ttsUsed(ctx), QUOTAS.free.tts);
});

test("free auto: Edge failing with Azure unconfigured is a 502 that spends no tts", async () => {
  _setEdgeTtsImpl(edgeDown);
  const ctx = freeUser();
  const res = await request(appFor(ctx)).post("/api/tts/auto").send({ text: "Hello there." });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /403/);
  assert.equal(ttsUsed(ctx), 0);
});

test("compare with every candidate failing spends no tts; one success spends one", async () => {
  const ctx = freeUser();
  _setCompareSynthImpl(async () => { throw new Error("provider down"); });
  const failed = await request(appFor(ctx)).post("/api/tts/compare")
    .send({ text: "Hello there.", candidates: [{ provider: "edge" }, { provider: "azure" }] });
  assert.equal(failed.status, 200);
  assert.ok(failed.body.results.every((r) => r.status === "error"));
  assert.equal(ttsUsed(ctx), 0);

  _setCompareSynthImpl(async ({ preferredProvider }) => {
    if (preferredProvider === "azure") throw new Error("provider down");
    return { ok: true, file: "/outputs/x.mp3", provider: preferredProvider, voice: "v" };
  });
  const partial = await request(appFor(ctx)).post("/api/tts/compare")
    .send({ text: "Hello there.", candidates: [{ provider: "edge" }, { provider: "azure" }] });
  assert.equal(partial.status, 200);
  assert.equal(ttsUsed(ctx), 1);
});
