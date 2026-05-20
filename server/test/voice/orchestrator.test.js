import { test } from "node:test";
import assert from "node:assert/strict";

import { _reset, register } from "../../src/lib/voice/registry.js";
import { synthesize, describeProviders } from "../../src/lib/voice/orchestrator.js";

const baseCaps = {
  wordTimestamps: false,
  charTimestamps: false,
  emotionControls: false,
  ssml: false,
  streaming: false,
};

function fake(id, opts = {}) {
  const calls = [];
  return {
    provider: {
      id,
      isAvailable: () => opts.available ?? true,
      capabilities: () => ({ ...baseCaps, ...(opts.caps || {}) }),
      synthesize: async (req) => {
        calls.push(req);
        if (opts.fail) throw new Error(opts.fail);
        return {
          ok: true,
          file: `/tmp/${id}.mp3`,
          provider: id,
          voice: req.voiceIds?.[id] ?? req.voiceId ?? `${id}-default`,
        };
      },
    },
    calls,
  };
}

test("uses first available provider when both succeed", async () => {
  _reset();
  const a = fake("a");
  const b = fake("b");
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world" });
  assert.equal(result.provider, "a");
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 0);
});

test("falls back when first provider throws", async () => {
  _reset();
  const a = fake("a", { fail: "billing failed" });
  const b = fake("b");
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world" });
  assert.equal(result.provider, "b");
});

test("throws aggregated error when all providers fail", async () => {
  _reset();
  register(fake("a", { fail: "AAA" }).provider);
  register(fake("b", { fail: "BBB" }).provider);

  await assert.rejects(
    () => synthesize({ text: "hello world" }),
    /First failure \(a\): AAA/,
  );
});

test("withTimestamps prefers timestamp-capable provider over registration order", async () => {
  _reset();
  const a = fake("a", { caps: { charTimestamps: false } }); // registered first, no timestamps
  const b = fake("b", { caps: { charTimestamps: true } });  // registered second, has timestamps
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world", withTimestamps: true });
  assert.equal(result.provider, "b");
  assert.equal(a.calls.length, 0);
});

test("withTimestamps falls back to non-capable provider if timestamp-capable one fails", async () => {
  _reset();
  const a = fake("a", { caps: { charTimestamps: false } });
  const b = fake("b", { caps: { charTimestamps: true }, fail: "rate limited" });
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world", withTimestamps: true });
  assert.equal(result.provider, "a");
});

test("skips unavailable providers entirely", async () => {
  _reset();
  const a = fake("a", { available: false });
  const b = fake("b");
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world" });
  assert.equal(result.provider, "b");
  assert.equal(a.calls.length, 0);
});

test("throws when no providers available", async () => {
  _reset();
  register(fake("a", { available: false }).provider);

  await assert.rejects(
    () => synthesize({ text: "hello world" }),
    /No TTS provider available/,
  );
});

test("rejects empty text", async () => {
  _reset();
  register(fake("a").provider);

  await assert.rejects(
    () => synthesize({ text: "" }),
    /text required/,
  );
});

test("preferredProvider hint overrides default ordering", async () => {
  _reset();
  const a = fake("a");
  const b = fake("b");
  register(a.provider);
  register(b.provider);

  const result = await synthesize({ text: "hello world", preferredProvider: "b" });
  assert.equal(result.provider, "b");
  assert.equal(a.calls.length, 0);
});

test("preferredProvider falls back when preferred is unavailable", async () => {
  _reset();
  const a = fake("a");
  register(a.provider);

  const result = await synthesize({ text: "hello world", preferredProvider: "ghost" });
  assert.equal(result.provider, "a");
});

test("voiceIds map routes per-provider voice ids", async () => {
  _reset();
  const a = fake("a", { fail: "skip" });
  const b = fake("b");
  register(a.provider);
  register(b.provider);

  const result = await synthesize({
    text: "hello world",
    voiceIds: { a: "voice-A", b: "voice-B" },
  });
  assert.equal(result.provider, "b");
  assert.equal(result.voice, "voice-B");
});

test("describeProviders reports registration order as priority", () => {
  _reset();
  register(fake("a", { available: true }).provider);
  register(fake("b", { available: false }).provider);

  const desc = describeProviders();
  assert.deepEqual(desc, {
    a: { available: true, priority: 1 },
    b: { available: false, priority: 2 },
  });
});
