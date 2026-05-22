import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

import { chatterboxProvider } from "../../src/lib/voice/providers/chatterboxProvider.js";

/**
 * These tests spin up a real HTTP listener on 127.0.0.1:<random> and point
 * CHATTERBOX_URL at it. The provider therefore exercises its real network
 * code path while we keep the test hermetic.
 */

let server;
let baseUrl;
let lastRequest;

/**
 * @param {(req: http.IncomingMessage) => Promise<{ status?: number, contentType?: string, body: Buffer | string | object }>} handler
 */
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

afterEach(() => {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = null;
    } else {
      resolve();
    }
    delete process.env.CHATTERBOX_URL;
    delete process.env.CHATTERBOX_AUDIO_PROMPT;
    delete process.env.CHATTERBOX_TIMEOUT_MS;
  });
});

beforeEach(() => {
  lastRequest = null;
});

test("isAvailable() false when CHATTERBOX_URL is unset", () => {
  delete process.env.CHATTERBOX_URL;
  assert.equal(chatterboxProvider.isAvailable(), false);
});

test("isAvailable() true once CHATTERBOX_URL is set", () => {
  process.env.CHATTERBOX_URL = "http://localhost:1234";
  assert.equal(chatterboxProvider.isAvailable(), true);
});

test("capabilities() declares emotionControls true, timestamps false", () => {
  const caps = chatterboxProvider.capabilities();
  assert.equal(caps.emotionControls, true);
  assert.equal(caps.wordTimestamps, false);
  assert.equal(caps.charTimestamps, false);
  assert.equal(caps.ssml, false);
  assert.equal(caps.streaming, false);
});

test("synthesize() POSTs to /tts with text and writes the returned audio to disk", async () => {
  await startServer(async () => ({
    contentType: "audio/mpeg",
    body: Buffer.from([0xff, 0xfb, 0x90, 0x00]), // tiny but non-empty
  }));
  process.env.CHATTERBOX_URL = baseUrl;

  const result = await chatterboxProvider.synthesize({ text: "Be still and know" });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "chatterbox");
  assert.equal(typeof result.file, "string");
  assert.ok(fs.existsSync(result.file));
  const written = fs.readFileSync(result.file);
  assert.equal(written.length, 4);
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.method, "POST");
  assert.equal(lastRequest.url, "/tts");
  assert.equal(lastRequest.body.text, "Be still and know");
  assert.equal(lastRequest.body.output_format, "mp3");
});

test("synthesize() forwards voiceSettings.style as exaggeration and cfg_weight", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.CHATTERBOX_URL = baseUrl;

  const result = await chatterboxProvider.synthesize({
    text: "Test text",
    voiceSettings: { style: 0.7, cfg_weight: 0.4 },
  });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.body.exaggeration, 0.7);
  assert.equal(lastRequest.body.cfg_weight, 0.4);
});

test("synthesize() uses voiceIds.chatterbox as audio_prompt_path when present", async () => {
  await startServer(async () => ({ body: Buffer.from([0x01]) }));
  process.env.CHATTERBOX_URL = baseUrl;

  const result = await chatterboxProvider.synthesize({
    text: "Test text",
    voiceIds: { chatterbox: "/voices/cinematic-pastor.wav" },
  });
  fs.unlinkSync(result.file);

  assert.equal(lastRequest.body.audio_prompt_path, "/voices/cinematic-pastor.wav");
});

test("synthesize() accepts JSON response with audio_base64", async () => {
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22]);
  await startServer(async () => ({
    contentType: "application/json",
    body: { audio_base64: audio.toString("base64") },
  }));
  process.env.CHATTERBOX_URL = baseUrl;

  const result = await chatterboxProvider.synthesize({ text: "Hello world" });
  const written = fs.readFileSync(result.file);
  assert.equal(written.length, audio.length);
  fs.unlinkSync(result.file);
});

test("synthesize() throws on empty audio", async () => {
  await startServer(async () => ({ body: Buffer.alloc(0) }));
  process.env.CHATTERBOX_URL = baseUrl;

  await assert.rejects(
    () => chatterboxProvider.synthesize({ text: "Hello world" }),
    /empty audio/,
  );
});

test("synthesize() throws on non-2xx response", async () => {
  await startServer(async () => ({ status: 500, contentType: "text/plain", body: "model crashed" }));
  process.env.CHATTERBOX_URL = baseUrl;

  await assert.rejects(
    () => chatterboxProvider.synthesize({ text: "Hello world" }),
    /Chatterbox error: 500/,
  );
});

test("synthesize() rejects too-short text", async () => {
  process.env.CHATTERBOX_URL = "http://127.0.0.1:1";
  await assert.rejects(
    () => chatterboxProvider.synthesize({ text: "hi" }),
    /min 3 chars/,
  );
});

test("isReachable() returns false when CHATTERBOX_URL is unset", async () => {
  delete process.env.CHATTERBOX_URL;
  const reachable = await chatterboxProvider.isReachable();
  assert.equal(reachable, false);
});

test("isReachable() returns true when /health responds 200", async () => {
  await startServer(async (req) => {
    if (req.url === "/health") {
      return { contentType: "application/json", body: { ok: true } };
    }
    return { status: 404, contentType: "text/plain", body: "not found" };
  });
  process.env.CHATTERBOX_URL = baseUrl;
  const reachable = await chatterboxProvider.isReachable();
  assert.equal(reachable, true);
  assert.equal(lastRequest.url, "/health");
  assert.equal(lastRequest.method, "GET");
});

test("isReachable() returns false when /health responds 500", async () => {
  await startServer(async () => ({ status: 500, contentType: "text/plain", body: "boom" }));
  process.env.CHATTERBOX_URL = baseUrl;
  const reachable = await chatterboxProvider.isReachable();
  assert.equal(reachable, false);
});

test("isReachable() caches the probe — subsequent calls do not re-hit the bridge", async () => {
  let healthHits = 0;
  await startServer(async (req) => {
    if (req.url === "/health") {
      healthHits += 1;
      return { contentType: "application/json", body: { ok: true } };
    }
    return { status: 404, body: "" };
  });
  process.env.CHATTERBOX_URL = baseUrl;

  assert.equal(await chatterboxProvider.isReachable(), true);
  assert.equal(await chatterboxProvider.isReachable(), true);
  assert.equal(await chatterboxProvider.isReachable(), true);
  assert.equal(healthHits, 1);
});

test("isReachable() invalidates cache when CHATTERBOX_URL changes", async () => {
  // First server: /health 200
  await startServer(async (req) => {
    if (req.url === "/health") return { contentType: "application/json", body: { ok: true } };
    return { status: 404, body: "" };
  });
  process.env.CHATTERBOX_URL = baseUrl;
  assert.equal(await chatterboxProvider.isReachable(), true);
  await new Promise((r) => server.close(() => { server = null; r(); }));

  // Second server (different port): /health 500
  await startServer(async () => ({ status: 500, body: "" }));
  process.env.CHATTERBOX_URL = baseUrl;
  // URL changed → cache must miss and re-probe.
  assert.equal(await chatterboxProvider.isReachable(), false);
});
