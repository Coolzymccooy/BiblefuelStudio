/**
 * Imagen adapter — model self-discovery on 404, and the Cloudflare token
 * alias fix that put the free chain back in front of it.
 *
 * Run: node --test server/src/lib/imageGen/providers/imagen.test.js
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImageImagen, _resetImagenDiscovery } from "./imagen.js";
import { isCloudflareConfigured } from "./cloudflare.js";

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

describe("Imagen model self-discovery", () => {
  test("a retired default model 404s, ListModels finds the live one, retry succeeds", async () => {
    process.env.GEMINI_API_KEY = "key";
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes(":predict") && u.includes("imagen-4.0-fast-generate-001")) return GONE_404.clone();
      if (!u.includes(":predict")) {
        return json({ models: [
          { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/imagen-5.0-generate-001", supportedGenerationMethods: ["predict"] },
          { name: "models/imagen-5.0-fast-generate-001", supportedGenerationMethods: ["predict"] },
        ] });
      }
      // Retry against the discovered fast model.
      assert.ok(u.includes("imagen-5.0-fast-generate-001"), `unexpected predict url: ${u}`);
      return json({ predictions: [{ bytesBase64Encoded: TINY_PNG_B64, mimeType: "image/png" }] });
    };

    const result = await generateImageImagen({ prompt: "a calm sunrise" });
    assert.equal(result.ok, true);
    assert.equal(result.model, "imagen-5.0-fast-generate-001");
    assert.equal(calls.filter((u) => u.includes(":predict")).length, 2);
  });

  test("the discovered model is remembered for the NEXT call (no re-discovery)", async () => {
    process.env.GEMINI_API_KEY = "key";
    let listCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes(":predict") && u.includes("imagen-4.0-fast-generate-001")) return GONE_404.clone();
      if (!u.includes(":predict")) {
        listCalls += 1;
        return json({ models: [{ name: "models/imagen-5.0-fast-generate-001", supportedGenerationMethods: ["predict"] }] });
      }
      return json({ predictions: [{ bytesBase64Encoded: TINY_PNG_B64, mimeType: "image/png" }] });
    };

    await generateImageImagen({ prompt: "one" });
    const second = await generateImageImagen({ prompt: "two" });
    assert.equal(second.ok, true);
    assert.equal(second.model, "imagen-5.0-fast-generate-001");
    assert.equal(listCalls, 1);
  });

  test("an EXPLICIT IMAGEN_MODEL pin is never silently replaced", async () => {
    process.env.GEMINI_API_KEY = "key";
    process.env.IMAGEN_MODEL = "imagen-4.0-fast-generate-001";
    let listCalled = false;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (!u.includes(":predict")) { listCalled = true; return json({ models: [] }); }
      return GONE_404.clone();
    };

    const result = await generateImageImagen({ prompt: "pinned" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Imagen 404/);
    assert.equal(listCalled, false);
  });
});
