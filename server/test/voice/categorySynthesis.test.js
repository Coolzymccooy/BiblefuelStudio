import { test } from "node:test";
import assert from "node:assert/strict";

import { _reset, register } from "../../src/lib/voice/registry.js";
import { synthesizeForCategory } from "../../src/lib/voice/categorySynthesis.js";

const baseCaps = {
  wordTimestamps: false,
  charTimestamps: false,
  emotionControls: false,
  ssml: false,
  streaming: false,
};

function spy(id, opts = {}) {
  const calls = [];
  return {
    provider: {
      id,
      isAvailable: () => opts.available ?? true,
      capabilities: () => ({ ...baseCaps, ...(opts.caps || {}) }),
      synthesize: async (req) => {
        calls.push(req);
        return {
          ok: true,
          file: `/tmp/${id}.mp3`,
          provider: id,
          voice: req.voiceIds?.[id] ?? req.voiceId ?? "default",
        };
      },
    },
    calls,
  };
}

test("synthesizeForCategory applies profile voiceIds + voiceSettings + prosody", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  const edge = spy("edge");
  register(eleven.provider);
  register(edge.provider);

  const result = await synthesizeForCategory({
    text: "Be still and know.",
    category: "prayer",
  });

  assert.equal(result.category, "prayer");
  assert.equal(result.profileLabel, "Gentle Prayer");
  assert.equal(result.recommendedTypographyPreset, "intimate-fade");
  // elevenlabs is the first preferred provider in the prayer profile
  assert.equal(result.provider, "elevenlabs");
  assert.equal(eleven.calls.length, 1);

  const call = eleven.calls[0];
  // Profile-driven Edge prosody is forwarded as well (even though Edge wasn't picked)
  assert.equal(call.prosody?.rate, "-15%");
  assert.equal(call.voiceSettings?.stability, 0.7);
  // The profile has no explicit ElevenLabs voiceId — voiceIds should not contain elevenlabs key
  assert.equal(call.voiceIds?.edge, "en-US-AriaNeural");
});

test("synthesizeForCategory: caller overrides win over profile values", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  register(eleven.provider);

  await synthesizeForCategory({
    text: "Hello there",
    category: "prayer",
    overrides: {
      voiceSettings: { stability: 0.1 },
      prosody: { rate: "+10%" },
      modelId: "custom-model",
    },
  });

  const call = eleven.calls[0];
  assert.equal(call.voiceSettings.stability, 0.1, "override stability wins");
  // similarity_boost from the profile should still be there
  assert.equal(call.voiceSettings.similarity_boost, 0.75);
  assert.equal(call.prosody.rate, "+10%", "override rate wins");
  assert.equal(call.modelId, "custom-model");
});

test("synthesizeForCategory: unknown category falls back to default", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  register(eleven.provider);

  const result = await synthesizeForCategory({
    text: "Fallback test",
    category: "nonexistent-mood",
  });

  assert.equal(result.category, "devotional");
});

test("synthesizeForCategory: preferredProvider hint overrides profile preference", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  const edge = spy("edge");
  register(eleven.provider);
  register(edge.provider);

  const result = await synthesizeForCategory({
    text: "Routing test",
    category: "prayer",          // prayer's first preference is elevenlabs
    preferredProvider: "edge",   // explicit override
  });

  assert.equal(result.provider, "edge");
  assert.equal(eleven.calls.length, 0);
});

test("synthesizeForCategory expands scripture references when scriptureMode is set", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  register(eleven.provider);

  await synthesizeForCategory({ text: "Psalm 91:1", category: "scripture", scriptureMode: true });

  assert.equal(eleven.calls[0].text, "Psalm chapter ninety-one, verse one.");
});

test("synthesizeForCategory expands scripture refs by default (orchestrator pass)", async () => {
  // Behavior changed: the orchestrator now expands Bible refs by default so
  // TTS doesn't speak "Mark 10:10" as "ten thousand ten". Callers can opt
  // out with scriptureMode:false if their text genuinely contains
  // colon-separated numerics (e.g. timestamps, ratios).
  _reset();
  const eleven = spy("elevenlabs");
  register(eleven.provider);

  await synthesizeForCategory({ text: "Psalm 91:1", category: "scripture" });

  assert.equal(eleven.calls[0].text, "Psalm chapter ninety-one, verse one.");
});

test("synthesizeForCategory leaves text raw when scriptureMode is false", async () => {
  _reset();
  const eleven = spy("elevenlabs");
  register(eleven.provider);

  await synthesizeForCategory({ text: "Psalm 91:1", category: "scripture", scriptureMode: false });

  assert.equal(eleven.calls[0].text, "Psalm 91:1");
});

test("synthesizeForCategory: result enriched with category + typography preset", async () => {
  _reset();
  register(spy("elevenlabs").provider);

  const result = await synthesizeForCategory({
    text: "Hello there",
    category: "kids",
  });

  assert.equal(result.category, "kids");
  assert.equal(result.profileLabel, "Youth Devotional");
  assert.equal(result.recommendedTypographyPreset, "playful-pop");
  assert.equal(result.ok, true);
  assert.ok(result.file);
});
