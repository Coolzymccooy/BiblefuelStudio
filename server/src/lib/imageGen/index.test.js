/**
 * Unit tests for the imageGen orchestrator.
 *
 * Network calls to Cloudflare / Imagen are stubbed via globalThis.fetch.
 * Env vars are mutated per-test; the orchestrator and providers read env at
 * call time, so a single module import is sufficient.
 *
 * Run: node --test server/src/lib/imageGen/index.test.js
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { OUTPUT_DIR } from "../paths.js";
import {
  generateBibleImage,
  isImageGenEnabled,
  listProviderChain,
} from "./index.js";

const TINY_PNG_BUFFER = Buffer.from(
  // 1x1 transparent PNG
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

let originalFetch;
const ORIGINAL_ENV_KEYS = [
  "IMAGE_GEN_ENABLED",
  "IMAGE_GEN_PROVIDER",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_WORKERS_AI_TOKEN",
  "CLOUDFLARE_IMAGE_MODEL",
  "GOOGLE_GEMINI_API_KEY",
  "GEMINI_API_KEY",
  "IMAGEN_API_KEY",
  "IMAGEN_MODEL",
];
const savedEnv = {};

function snapshotEnv() {
  for (const k of ORIGINAL_ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ORIGINAL_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}
function clearImageGenEnv() {
  for (const k of ORIGINAL_ENV_KEYS) delete process.env[k];
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init || {});
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cleanupTestImages(seriesId) {
  const dir = path.join(OUTPUT_DIR, "genImg", seriesId);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
    try { fs.rmdirSync(dir); } catch {}
  }
}

describe("imageGen orchestrator — config & provider chain", () => {
  beforeEach(() => {
    snapshotEnv();
    clearImageGenEnv();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  test("isImageGenEnabled defaults false when no provider is configured", () => {
    assert.equal(isImageGenEnabled(), false);
  });

  test("isImageGenEnabled flips true once Cloudflare creds are set", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    assert.equal(isImageGenEnabled(), true);
  });

  test("IMAGE_GEN_ENABLED=false force-disables even with creds", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.IMAGE_GEN_ENABLED = "false";
    assert.equal(isImageGenEnabled(), false);
  });

  test("listProviderChain auto puts Cloudflare first, Imagen second", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.GEMINI_API_KEY = "key";
    assert.deepEqual(listProviderChain(), ["cloudflare", "imagen"]);
  });

  test("listProviderChain honors IMAGE_GEN_PROVIDER=imagen", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.GEMINI_API_KEY = "key";
    process.env.IMAGE_GEN_PROVIDER = "imagen";
    assert.deepEqual(listProviderChain(), ["imagen"]);
  });

  test("listProviderChain returns [] when IMAGE_GEN_PROVIDER=none", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.IMAGE_GEN_PROVIDER = "none";
    assert.deepEqual(listProviderChain(), []);
  });
});

describe("imageGen orchestrator — generateBibleImage", () => {
  beforeEach(() => {
    snapshotEnv();
    clearImageGenEnv();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  test("returns skipped:true when no provider is configured", async () => {
    const result = await generateBibleImage({ seriesId: "test_skip", partNumber: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
  });

  test("writes PNG and returns publicUrl on Cloudflare success", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";

    const seriesId = `test_cf_ok_${Date.now()}`;
    cleanupTestImages(seriesId);

    let observedUrl = "";
    stubFetch(async (url) => {
      observedUrl = url;
      return jsonResponse({ success: true, result: { image: TINY_PNG_BUFFER.toString("base64") } });
    });

    const result = await generateBibleImage({
      seriesId,
      partNumber: 1,
      verseText: "For God so loved the world",
      aspect: "portrait",
    });

    assert.match(observedUrl, /api\.cloudflare\.com.*flux-1-schnell/);
    assert.equal(result.ok, true);
    assert.equal(result.provider, "cloudflare");
    assert.ok(result.path && fs.existsSync(result.path), `file not written: ${result.path}`);
    assert.match(result.publicUrl, /^\/outputs\/genImg\/test_cf_ok_.+\/part-1\.png$/);

    cleanupTestImages(seriesId);
  });

  test("Cloudflare failure falls back to Imagen", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.GEMINI_API_KEY = "key";

    const seriesId = `test_fail_${Date.now()}`;
    cleanupTestImages(seriesId);

    let cloudflareCalled = false;
    let imagenCalled = false;
    stubFetch(async (url) => {
      if (/api\.cloudflare\.com/.test(url)) {
        cloudflareCalled = true;
        return new Response("rate limit", { status: 429 });
      }
      if (/generativelanguage\.googleapis\.com/.test(url)) {
        imagenCalled = true;
        return jsonResponse({
          predictions: [{ bytesBase64Encoded: TINY_PNG_BUFFER.toString("base64"), mimeType: "image/png" }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await generateBibleImage({ seriesId, partNumber: 1 });

    assert.ok(cloudflareCalled, "Cloudflare should have been tried first");
    assert.ok(imagenCalled, "Imagen should have been called after Cloudflare failed");
    assert.equal(result.ok, true);
    assert.equal(result.provider, "imagen");

    cleanupTestImages(seriesId);
  });

  test("all providers fail → ok:false with last provider's error", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
    process.env.GEMINI_API_KEY = "key";

    stubFetch(async () => new Response("nope", { status: 500 }));

    const result = await generateBibleImage({ seriesId: `test_allfail_${Date.now()}`, partNumber: 1 });
    assert.equal(result.ok, false);
    assert.ok(/imagen|cloudflare/i.test(result.error || ""), `unexpected error: ${result.error}`);
  });

  test("cache hit: second call with same seriesId+part doesn't refetch", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";

    const seriesId = `test_cache_${Date.now()}`;
    cleanupTestImages(seriesId);

    let fetchCount = 0;
    stubFetch(async () => {
      fetchCount += 1;
      return jsonResponse({ success: true, result: { image: TINY_PNG_BUFFER.toString("base64") } });
    });

    const first = await generateBibleImage({ seriesId, partNumber: 1 });
    const second = await generateBibleImage({ seriesId, partNumber: 1 });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(fetchCount, 1, "should only have called the network once");

    cleanupTestImages(seriesId);
  });

  test("imagen safety filter rejection surfaces as error", async () => {
    process.env.GEMINI_API_KEY = "key";

    stubFetch(async (url) => {
      if (/generativelanguage\.googleapis\.com/.test(url)) {
        return jsonResponse({
          predictions: [{ raiFilteredReason: "Person/Face" }],
        });
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await generateBibleImage({ seriesId: `test_safety_${Date.now()}`, partNumber: 1 });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /safety/i);
  });

  test("rawPrompt is used verbatim, bypassing buildBiblePrompt", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";

    const seriesId = `test_rawprompt_${Date.now()}`;
    cleanupTestImages(seriesId);

    const VERBATIM_PROMPT = "MY_VERBATIM_PROMPT_XYZ_UNIQUE_TEST";
    let capturedPrompt = "";

    stubFetch(async (url, init) => {
      if (/api\.cloudflare\.com/.test(url)) {
        // Cloudflare expects JSON body with "prompt" field
        try {
          const body = JSON.parse(init.body || "{}");
          capturedPrompt = body.prompt || "";
        } catch {
          capturedPrompt = "";
        }
        return jsonResponse({ success: true, result: { image: TINY_PNG_BUFFER.toString("base64") } });
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await generateBibleImage({
      seriesId,
      partNumber: 1,
      rawPrompt: VERBATIM_PROMPT,
    });

    assert.equal(result.ok, true, "generation should succeed");
    assert.equal(result.prompt, VERBATIM_PROMPT, "returned prompt should equal the verbatim input");
    assert.ok(
      capturedPrompt.includes(VERBATIM_PROMPT),
      `provider should receive the verbatim prompt; got: ${capturedPrompt}`,
    );
    assert.ok(
      !capturedPrompt.includes("buildBiblePrompt") && !capturedPrompt.includes("beatType"),
      "should not include buildBiblePrompt-generated content",
    );

    cleanupTestImages(seriesId);
  });
});
