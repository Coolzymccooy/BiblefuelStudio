/**
 * Google backup (Gemini image model, or a pinned Imagen model), and the Cloudflare token
 * alias fix that put the free chain back in front of it.
 *
 * Run: node --test server/src/lib/imageGen/providers/imagen.test.js
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImageImagen, _resetImagenDiscovery } from "./imagen.js";
import { isCloudflareConfigured, generateImageCloudflare, _resetCloudflareSchemaMemo } from "./cloudflare.js";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const ENV_KEYS = [
  "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "IMAGEN_API_KEY", "IMAGEN_MODEL",
  "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_WORKERS_AI_TOKEN",
  "CLOUDFLARE_AI_API_TOKEN", "CLOUDFLARE_API_TOKEN",
];
const saved = {};
let originalFetch;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const GONE_404 = json({
  error: { code: 404, message: "models/imagen-4.0-fast-generate-001 is not found for API version v1beta, or is not supported for predict." },
}, 404);

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  originalFetch = globalThis.fetch;
  _resetImagenDiscovery();
  _resetCloudflareSchemaMemo();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Cloudflare token aliases", () => {
  test("CLOUDFLARE_AI_API_TOKEN counts as configured", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_AI_API_TOKEN = "tok";
    assert.equal(isCloudflareConfigured(), true);
  });

  test("CLOUDFLARE_API_TOKEN counts as configured", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    assert.equal(isCloudflareConfigured(), true);
  });

  test("account id alone is NOT configured", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    assert.equal(isCloudflareConfigured(), false);
  });
});

describe("Cloudflare schema retry", () => {
  test("a '/seed not allowed' 400 strips seed and retries; the memo skips it next call", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_AI_API_TOKEN = "tok";
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if ("seed" in body) {
        return json({ errors: [{ message: "AiError: Bad input: Error: Additional or unevaluated properties '/seed' at '/' not allowed", code: 5006 }] }, 400);
      }
      return json({ success: true, result: { image: TINY_PNG_B64 } });
    };

    const first = await generateImageCloudflare({ prompt: "sunrise", seed: 42 });
    assert.equal(first.ok, true, first.error);
    assert.equal(bodies.length, 2);
    assert.ok(!("seed" in bodies[1]));

    // Second scene: the memo means seed is never sent - one call, no 400.
    const second = await generateImageCloudflare({ prompt: "dove", seed: 43 });
    assert.equal(second.ok, true, second.error);
    assert.equal(bodies.length, 3);
    assert.ok(!("seed" in bodies[2]));
  });

  test("a 400 that names no property still fails honestly", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_AI_API_TOKEN = "tok";
    globalThis.fetch = async () => json({ errors: [{ message: "AiError: something else entirely" }] }, 400);
    const result = await generateImageCloudflare({ prompt: "x", seed: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error, /Cloudflare 400/);
  });
});

const geminiImage = (b64 = TINY_PNG_B64) => json({
  candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] } }],
});

describe("Google backup: Gemini image model by default", () => {
  test("asks gemini-2.5-flash-image for one picture in the frame shape, key in a header", async () => {
    process.env.GEMINI_API_KEY = "secret-key";
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return geminiImage();
    };

    const result = await generateImageImagen({ prompt: "a calm sunrise", aspect: "landscape" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.model, "gemini-2.5-flash-image");
    assert.equal(result.contentType, "image/png");
    assert.ok(Buffer.isBuffer(result.imageBuffer) && result.imageBuffer.length > 0);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /models\/gemini-2\.5-flash-image:generateContent$/);
    assert.doesNotMatch(calls[0].url, /secret-key/, "the key never goes in the URL");
    assert.equal(calls[0].init.headers["x-goog-api-key"], "secret-key");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.contents[0].parts[0].text, "a calm sunrise");
    assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
  });

  test("portrait is 9:16 and square is 1:1", async () => {
    process.env.GEMINI_API_KEY = "k";
    const ratios = [];
    globalThis.fetch = async (_url, init) => {
      ratios.push(JSON.parse(init.body).generationConfig.imageConfig.aspectRatio);
      return geminiImage();
    };
    await generateImageImagen({ prompt: "a", aspect: "portrait" });
    await generateImageImagen({ prompt: "b", aspect: "square" });
    await generateImageImagen({ prompt: "c" });
    assert.deepEqual(ratios, ["9:16", "1:1", "9:16"]);
  });

  test("a refused picture fails with Google's reason", async () => {
    process.env.GEMINI_API_KEY = "k";
    globalThis.fetch = async () => json({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] });
    const result = await generateImageImagen({ prompt: "x" });
    assert.equal(result.ok, false);
    assert.match(result.error, /IMAGE_SAFETY/);
  });

  test("a blocked prompt fails with the block reason", async () => {
    process.env.GEMINI_API_KEY = "k";
    globalThis.fetch = async () => json({ promptFeedback: { blockReason: "SAFETY" } });
    const result = await generateImageImagen({ prompt: "x" });
    assert.equal(result.ok, false);
    assert.match(result.error, /SAFETY/);
  });

  test("a key without billing (429) fails honestly with the status", async () => {
    process.env.GEMINI_API_KEY = "k";
    globalThis.fetch = async () => json({ error: { code: 429, message: "You exceeded your current quota" } }, 429);
    const result = await generateImageImagen({ prompt: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
    assert.match(result.error, /429/);
  });

  test("a retired default asks ListModels for a live Gemini image model and retries once", async () => {
    process.env.GEMINI_API_KEY = "k";
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("gemini-2.5-flash-image:generateContent")) {
        return json({ error: { code: 404, message: "models/gemini-2.5-flash-image is not found for API version v1beta, or is not supported for generateContent." } }, 404);
      }
      if (!/:(generateContent|predict)/.test(u)) {
        return json({ models: [
          { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-image-preview", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-lite-image", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
          { name: "models/imagen-5.0-fast-generate-001", supportedGenerationMethods: ["predict"] },
        ] });
      }
      assert.match(u, /gemini-3\.1-flash-image:generateContent$/);
      return geminiImage();
    };

    const result = await generateImageImagen({ prompt: "a calm sunrise" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.model, "gemini-3.1-flash-image");

    // Remembered: the next picture goes straight to the live model.
    calls.length = 0;
    const second = await generateImageImagen({ prompt: "two" });
    assert.equal(second.model, "gemini-3.1-flash-image");
    assert.equal(calls.length, 1);
  });
});

describe("Google backup: an Imagen model pinned with IMAGEN_MODEL", () => {
  test("uses the Imagen predict call", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.IMAGEN_MODEL = "imagen-5.0-fast-generate-001";
    let seen = "";
    globalThis.fetch = async (url) => {
      seen = String(url);
      return json({ predictions: [{ bytesBase64Encoded: TINY_PNG_B64, mimeType: "image/png" }] });
    };
    const result = await generateImageImagen({ prompt: "pinned" });
    assert.equal(result.ok, true, result.error);
    assert.match(seen, /imagen-5\.0-fast-generate-001:predict/);
  });

  test("an EXPLICIT pin is never silently replaced", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.IMAGEN_MODEL = "imagen-4.0-fast-generate-001";
    let listCalled = false;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (!/:(generateContent|predict)/.test(u)) { listCalled = true; return json({ models: [] }); }
      return GONE_404.clone();
    };

    const result = await generateImageImagen({ prompt: "pinned" });
    assert.equal(result.ok, false);
    assert.match(result.error, /404/);
    assert.equal(listCalled, false);
  });
});
