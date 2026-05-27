import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SpeechRequestSchema,
  SpeechResultSchema,
  ProviderCapabilitiesSchema,
} from "../../src/lib/voice/schemas.js";

test("SpeechRequest accepts minimal input", () => {
  const parsed = SpeechRequestSchema.parse({ text: "hello there" });
  assert.equal(parsed.text, "hello there");
});

test("SpeechRequest rejects empty text", () => {
  assert.throws(() => SpeechRequestSchema.parse({ text: "" }));
  assert.throws(() => SpeechRequestSchema.parse({ text: "hi" })); // < 3 chars
});

test("SpeechRequest passes through unknown fields", () => {
  const parsed = SpeechRequestSchema.parse({
    text: "hello there",
    someFutureField: 42,
  });
  assert.equal(parsed.someFutureField, 42);
});

test("SpeechRequest accepts voiceIds map", () => {
  const parsed = SpeechRequestSchema.parse({
    text: "hello there",
    voiceIds: { elevenlabs: "abc", edge: "en-US-AriaNeural" },
  });
  assert.deepEqual(parsed.voiceIds, { elevenlabs: "abc", edge: "en-US-AriaNeural" });
});

test("SpeechResult requires file, provider, voice", () => {
  assert.throws(() => SpeechResultSchema.parse({ ok: true }));
  assert.throws(() => SpeechResultSchema.parse({ ok: true, file: "" }));
  const parsed = SpeechResultSchema.parse({
    ok: true,
    file: "/tmp/x.mp3",
    provider: "edge",
    voice: "en-US-AriaNeural",
  });
  assert.equal(parsed.provider, "edge");
});

test("SpeechResult accepts optional alignment", () => {
  const parsed = SpeechResultSchema.parse({
    ok: true,
    file: "/tmp/x.mp3",
    provider: "elevenlabs",
    voice: "v",
    alignment: { characters: ["a"], starts: [0], ends: [0.1] },
  });
  assert.equal(parsed.alignment.characters[0], "a");
});

test("ProviderCapabilities requires all five flags", () => {
  assert.throws(() => ProviderCapabilitiesSchema.parse({ wordTimestamps: true }));
  const parsed = ProviderCapabilitiesSchema.parse({
    wordTimestamps: false,
    charTimestamps: true,
    emotionControls: true,
    ssml: false,
    streaming: false,
  });
  assert.equal(parsed.charTimestamps, true);
});

test("ProviderCapabilities preserves optional voiceClone/multilingual flags", () => {
  const parsed = ProviderCapabilitiesSchema.parse({
    wordTimestamps: false,
    charTimestamps: false,
    emotionControls: true,
    ssml: false,
    streaming: true,
    voiceClone: true,
    multilingual: true,
  });
  assert.equal(parsed.voiceClone, true);
  assert.equal(parsed.multilingual, true);
});

test("ProviderCapabilities keeps voiceClone/multilingual optional", () => {
  // The legacy five-flag providers (edge/elevenlabs) must still validate
  // without declaring the new optional fields.
  const parsed = ProviderCapabilitiesSchema.parse({
    wordTimestamps: false,
    charTimestamps: true,
    emotionControls: true,
    ssml: false,
    streaming: false,
  });
  assert.equal(parsed.voiceClone, undefined);
  assert.equal(parsed.multilingual, undefined);
});
