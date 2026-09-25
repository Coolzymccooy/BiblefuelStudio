import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImageCloudflare, _resetCloudflareSchemaMemo } from "./cloudflare.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
let originalFetch, originalEnv, requests;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalEnv = { ...process.env };
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
  process.env.CLOUDFLARE_WORKERS_AI_TOKEN = "tok";
  delete process.env.CLOUDFLARE_IMAGE_MODEL;
  requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, result: { image: PNG } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  _resetCloudflareSchemaMemo();
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = originalEnv; });

describe("generateImageCloudflare", () => {
  test("defaults to Leonardo Lucid Origin and asks for the aspect natively (no square-then-crop)", async () => {
    const r = await generateImageCloudflare({ prompt: "moonlit lake", aspect: "landscape" });
    assert.equal(r.ok, true);
    assert.match(requests[0].url, /\/ai\/run\/@cf\/leonardo\/lucid-origin$/);
    assert.equal(requests[0].body.width, 1344);
    assert.equal(requests[0].body.height, 768);
    // Portrait (the Shorts default) is native too.
    await generateImageCloudflare({ prompt: "moonlit lake" });
    assert.equal(requests[1].body.width, 768);
    assert.equal(requests[1].body.height, 1344);
  });
  test("flux-1-schnell only takes prompt/steps/seed — no width/height are sent to it", async () => {
    process.env.CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
    await generateImageCloudflare({ prompt: "moonlit lake", aspect: "landscape", seed: 7, steps: 6 });
    assert.match(requests[0].url, /flux-1-schnell$/);
    assert.equal(requests[0].body.width, undefined);
    assert.equal(requests[0].body.height, undefined);
    assert.equal(requests[0].body.steps, 6);
    assert.equal(requests[0].body.seed, 7);
  });
  test("steps are flux-only: the default model is not sent a steps property", async () => {
    await generateImageCloudflare({ prompt: "moonlit lake", steps: 6, seed: 7 });
    assert.equal(requests[0].body.steps, undefined);
    assert.equal(requests[0].body.seed, 7);
  });
});
