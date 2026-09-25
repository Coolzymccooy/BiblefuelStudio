import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImageTogether, isTogetherConfigured } from "./together.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.TOGETHER_API_KEY; });

describe("together provider", () => {
  test("is unconfigured without a key, and says so instead of throwing", async () => {
    assert.equal(isTogetherConfigured(), false);
    const r = await generateImageTogether({ prompt: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /TOGETHER_API_KEY/);
  });

  test("posts the free schnell model with landscape dimensions and returns the decoded image", async () => {
    process.env.TOGETHER_API_KEY = "k";
    let sent;
    globalThis.fetch = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }) };
    };
    const r = await generateImageTogether({ prompt: "still waters", aspect: "landscape", seed: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.provider, "together");
    assert.deepEqual([...r.imageBuffer], [1, 2, 3]);
    assert.match(sent.body.model, /FLUX\.1-schnell-Free/);
    assert.equal(sent.body.width, 1344);
    assert.equal(sent.body.height, 768);
    assert.equal(sent.body.seed, 7);
  });

  test("surfaces an API error as a named failure", async () => {
    process.env.TOGETHER_API_KEY = "k";
    globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
    const r = await generateImageTogether({ prompt: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /429/);
  });

  test("a response with no image data is a named failure, not a crash", async () => {
    process.env.TOGETHER_API_KEY = "k";
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
    const r = await generateImageTogether({ prompt: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no image data/i);
  });

  test("an empty prompt is rejected before any network call", async () => {
    process.env.TOGETHER_API_KEY = "k";
    globalThis.fetch = async () => { throw new Error("must not be called"); };
    const r = await generateImageTogether({ prompt: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /prompt required/);
  });
});
