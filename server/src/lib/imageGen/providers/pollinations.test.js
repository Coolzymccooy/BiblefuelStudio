import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImagePollinations } from "./pollinations.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.POLLINATIONS_TOKEN;
  delete process.env.POLLINATIONS_ENABLED;
});

function capture() {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), headers: init?.headers || {} });
    return {
      ok: true, status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  return sent;
}

describe("pollinations provider", () => {
  // Measured 2026-10-16: image.pollinations.ai stamps "pollinations.ai" on the
  // picture even with a valid token and nologo=true; gen.pollinations.ai with
  // the same token as a Bearer returns it clean.
  test("with a token it uses the gen endpoint, which leaves no watermark", async () => {
    process.env.POLLINATIONS_TOKEN = "tok";
    const sent = capture();
    const r = await generateImagePollinations({ prompt: "an open Bible by a window", aspect: "portrait", seed: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.watermarkFree, true);
    assert.match(sent[0].url, /^https:\/\/gen\.pollinations\.ai\/image\//);
    assert.equal(sent[0].headers.Authorization, "Bearer tok");
    assert.doesNotMatch(sent[0].url, /token=/, "the token travels in the header, not the URL");
  });

  test("without a token it keeps the keyless endpoint, and says the picture may be watermarked", async () => {
    process.env.POLLINATIONS_ENABLED = "true";
    const sent = capture();
    const r = await generateImagePollinations({ prompt: "still waters", aspect: "portrait" });
    assert.equal(r.ok, true);
    assert.equal(r.watermarkFree, false);
    assert.match(sent[0].url, /^https:\/\/image\.pollinations\.ai\/prompt\//);
  });
});
