import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

import { fishAudioProvider } from "../../src/lib/voice/providers/fishAudioProvider.js";

/**
 * These tests spin up a real HTTP listener on 127.0.0.1:<random> and point
 * FISH_API_BASE_URL at it. The provider therefore exercises its real network
 * code path (fetch → POST /v1/tts) while we keep the test hermetic.
 *
 * Fish Audio's /v1/tts contract (verified against docs.fish.audio):
 *   headers: Authorization: Bearer <key>, model: s1|s2-pro, Content-Type: application/json
 *   body:    { text, reference_id?, format, mp3_bitrate, prosody?: { speed } }
 *   200:     audio stream
 *   401:     auth failure   402: payment required   422: validation error
 */

let server;
let baseUrl;
let lastRequest;

async function startServer(handler) {
  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try { parsed = JSON.parse(rawBody); } catch { /* not json */ }
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body: parsed, rawBody };

      try {
        const response = await handler(req);
        const status = response?.status ?? 200;
        const ct = response?.contentType ?? "audio/mpeg";
        res.writeHead(status, { "Content-Type": ct });
        if (Buffer.isBuffer(response.body)) {
          res.end(response.body);
        } else if (typeof response.body === "string") {
          res.end(response.body);
        } else {
          res.end(JSON.stringify(response.body));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(err?.message || err));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

beforeEach(() => {
  lastRequest = null;
});

afterEach(() => {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = null;
    } else {
      resolve();
    }
    delete process.env.FISH_API_KEY;
    delete process.env.FISH_API_BASE_URL;
    delete process.env.FISH_DEFAULT_MODEL;
    delete process.env.FISH_DEFAULT_REFERENCE_ID;
    delete process.env.FISH_TIMEOUT_MS;
  });
});

// ─── availability ──────────────────────────────────────────────────────

test("isAvailable() false when FISH_API_KEY is unset", () => {
  delete process.env.FISH_API_KEY;
  assert.equal(fishAudioProvider.isAvailable(), false);
});

test("isAvailable() true once FISH_API_KEY is set", () => {
  process.env.FISH_API_KEY = "fk_live_abc123";
  assert.equal(fishAudioProvider.isAvailable(), true);
});

test("isAvailable() false for a placeholder key", () => {
  process.env.FISH_API_KEY = "your-fish-api-key";
  assert.equal(fishAudioProvider.isAvailable(), false);
});

// ─── capabilities ──────────────────────────────────────────────────────

test("capabilities() declares cloud-premium flags", () => {
  const caps = fishAudioProvider.capabilities();
  assert.equal(caps.emotionControls, true);
  assert.equal(caps.streaming, true);
  assert.equal(caps.multilingual, true);
  assert.equal(caps.voiceClone, true);
  assert.equal(caps.wordTimestamps, false);
  assert.equal(caps.charTimestamps, false);
  assert.equal(caps.ssml, false);
});

// ─── synthesize: happy path ──────────────────────────────────────────────

test("synthesize() POSTs to /v1/tts with Bearer auth, model header, JSON body, and writes audio", async () => {
  await startServer(async () => ({
    contentType: "audio/mpeg",
    body: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
  }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  const result = await fishAudioProvider.synthesize({ text: "Be still and know that I am God" });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "fish");
  assert.equal(typeof result.file, "string");
  assert.ok(fs.existsSync(result.file));
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.method, "POST");
  assert.equal(lastRequest.url, "/v1/tts");
  assert.equal(lastRequest.headers.authorization, "Bearer fk_live_abc123");
  assert.equal(lastRequest.headers.model, "s1");
  assert.ok(lastRequest.headers["content-type"].includes("application/json"));
  assert.equal(lastRequest.body.text, "Be still and know that I am God");
  assert.equal(lastRequest.body.format, "mp3");
});

test("synthesize() sends reference_id from voiceIds.fish and reports it as voice", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  const result = await fishAudioProvider.synthesize({
    text: "Test scripture text",
    voiceIds: { fish: "voice_model_xyz" },
  });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.body.reference_id, "voice_model_xyz");
  assert.equal(result.voice, "voice_model_xyz");
});

test("synthesize() falls back to FISH_DEFAULT_REFERENCE_ID when no voice given", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;
  process.env.FISH_DEFAULT_REFERENCE_ID = "default_voice_001";

  const result = await fishAudioProvider.synthesize({ text: "Test scripture text" });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.body.reference_id, "default_voice_001");
});

test("synthesize() uses FISH_DEFAULT_MODEL for the model header when set", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;
  process.env.FISH_DEFAULT_MODEL = "s2-pro";

  const result = await fishAudioProvider.synthesize({ text: "Test scripture text" });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.headers.model, "s2-pro");
});

test("synthesize() forwards voiceSettings.speed as prosody.speed", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  const result = await fishAudioProvider.synthesize({
    text: "Test scripture text",
    voiceSettings: { speed: 0.85 },
  });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.body.prosody.speed, 0.85);
});

// ─── synthesize: validation + errors ─────────────────────────────────────

test("synthesize() rejects too-short text", async () => {
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = "http://127.0.0.1:1";
  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "hi" }),
    /min 3 chars/,
  );
});

test("synthesize() throws when FISH_API_KEY is not configured", async () => {
  delete process.env.FISH_API_KEY;
  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "Hello world" }),
    /FISH_API_KEY not configured/,
  );
});

test("synthesize() throws a clear auth error on 401", async () => {
  await startServer(async () => ({ status: 401, contentType: "application/json", body: { error: "unauthorized" } }));
  process.env.FISH_API_KEY = "fk_live_bad";
  process.env.FISH_API_BASE_URL = baseUrl;

  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "Hello world" }),
    /401/,
  );
});

test("synthesize() throws a clear credits error on 402", async () => {
  await startServer(async () => ({ status: 402, contentType: "application/json", body: { error: "payment required" } }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "Hello world" }),
    /402|credit/i,
  );
});

test("synthesize() throws on 422 validation (invalid voice/model)", async () => {
  await startServer(async () => ({ status: 422, contentType: "application/json", body: { detail: [{ msg: "bad reference_id" }] } }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "Hello world", voiceIds: { fish: "nope" } }),
    /422/,
  );
});

test("synthesize() throws on empty audio", async () => {
  await startServer(async () => ({ body: Buffer.alloc(0) }));
  process.env.FISH_API_KEY = "fk_live_abc123";
  process.env.FISH_API_BASE_URL = baseUrl;

  await assert.rejects(
    () => fishAudioProvider.synthesize({ text: "Hello world" }),
    /empty audio/,
  );
});
