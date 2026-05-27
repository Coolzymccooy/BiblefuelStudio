import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  azureSpeechProvider,
  _setSynthImpl,
  _resetSynthImpl,
} from "../../src/lib/voice/providers/azureSpeechProvider.js";

/**
 * The real Azure Speech SDK talks to Azure over its own protocol, so we test
 * the provider through an injected synth implementation (dependency seam).
 * The fake returns canned audio + WordBoundary data; the assertions cover the
 * valuable logic: tick→ms conversion, word filtering, voice resolution, file
 * writing, and error handling. The thin SDK client itself is the unavoidable
 * edge and isn't unit-tested.
 *
 * Azure WordBoundary offsets/durations are in 100ns ticks (10,000 ticks = 1ms).
 */

function fakeSynth(result) {
  const calls = [];
  const impl = async (args) => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return { impl, calls };
}

beforeEach(() => {
  _resetSynthImpl();
});

afterEach(() => {
  _resetSynthImpl();
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  delete process.env.AZURE_SPEECH_VOICE;
});

// ─── availability ──────────────────────────────────────────────────────

test("isAvailable() false when key or region is missing", () => {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  assert.equal(azureSpeechProvider.isAvailable(), false);

  process.env.AZURE_SPEECH_KEY = "abc";
  assert.equal(azureSpeechProvider.isAvailable(), false); // region still missing
});

test("isAvailable() true when both key and region are set", () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";
  assert.equal(azureSpeechProvider.isAvailable(), true);
});

test("isAvailable() false for a placeholder key", () => {
  process.env.AZURE_SPEECH_KEY = "your-azure-key";
  process.env.AZURE_SPEECH_REGION = "eastus";
  assert.equal(azureSpeechProvider.isAvailable(), false);
});

// ─── capabilities ──────────────────────────────────────────────────────

test("capabilities() declares wordTimestamps + ssml, not voiceClone", () => {
  const caps = azureSpeechProvider.capabilities();
  assert.equal(caps.wordTimestamps, true);
  assert.equal(caps.charTimestamps, false);
  assert.equal(caps.ssml, true);
  assert.equal(caps.emotionControls, true);
  assert.equal(caps.multilingual, true);
  assert.equal(caps.voiceClone, false);
  assert.equal(caps.streaming, false);
});

// ─── synthesize: mapping ─────────────────────────────────────────────────

test("synthesize() maps Word boundaries to ms word timings and writes audio", async () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";

  const { impl } = fakeSynth({
    audio: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
    boundaries: [
      { text: "For", audioOffsetTicks: 0, durationTicks: 1_800_000, boundaryType: "Word" },
      { text: ",", audioOffsetTicks: 1_800_000, durationTicks: 0, boundaryType: "Punctuation" },
      { text: "God", audioOffsetTicks: 1_800_000, durationTicks: 2_400_000, boundaryType: "Word" },
    ],
  });
  _setSynthImpl(impl);

  const result = await azureSpeechProvider.synthesize({ text: "For, God so loved" });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "azure");
  assert.ok(fs.existsSync(result.file));
  fs.unlinkSync(result.file);

  // Punctuation boundary filtered out; ticks converted to ms.
  assert.deepEqual(result.words, [
    { text: "For", startMs: 0, endMs: 180 },
    { text: "God", startMs: 180, endMs: 420 },
  ]);
});

test("synthesize() resolves voice from voiceIds.azure, then AZURE_SPEECH_VOICE, then default", async () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";

  const f1 = fakeSynth({ audio: Buffer.from([0x01]), boundaries: [] });
  _setSynthImpl(f1.impl);
  const r1 = await azureSpeechProvider.synthesize({ text: "hello there", voiceIds: { azure: "en-US-JennyNeural" } });
  fs.unlinkSync(r1.file);
  assert.equal(f1.calls[0].voice, "en-US-JennyNeural");
  assert.equal(r1.voice, "en-US-JennyNeural");

  process.env.AZURE_SPEECH_VOICE = "en-GB-RyanNeural";
  const f2 = fakeSynth({ audio: Buffer.from([0x01]), boundaries: [] });
  _setSynthImpl(f2.impl);
  const r2 = await azureSpeechProvider.synthesize({ text: "hello there" });
  fs.unlinkSync(r2.file);
  assert.equal(f2.calls[0].voice, "en-GB-RyanNeural");

  delete process.env.AZURE_SPEECH_VOICE;
  const f3 = fakeSynth({ audio: Buffer.from([0x01]), boundaries: [] });
  _setSynthImpl(f3.impl);
  const r3 = await azureSpeechProvider.synthesize({ text: "hello there" });
  fs.unlinkSync(r3.file);
  assert.ok(typeof f3.calls[0].voice === "string" && f3.calls[0].voice.length > 0);
});

// ─── synthesize: validation + errors ─────────────────────────────────────

test("synthesize() rejects too-short text", async () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";
  await assert.rejects(() => azureSpeechProvider.synthesize({ text: "hi" }), /min 3 chars/);
});

test("synthesize() throws when not configured", async () => {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  await assert.rejects(
    () => azureSpeechProvider.synthesize({ text: "hello there" }),
    /AZURE_SPEECH/,
  );
});

test("synthesize() throws on empty audio", async () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";
  _setSynthImpl(fakeSynth({ audio: Buffer.alloc(0), boundaries: [] }).impl);
  await assert.rejects(
    () => azureSpeechProvider.synthesize({ text: "hello there" }),
    /empty audio/,
  );
});

test("synthesize() propagates a synth failure", async () => {
  process.env.AZURE_SPEECH_KEY = "abc123";
  process.env.AZURE_SPEECH_REGION = "eastus";
  _setSynthImpl(fakeSynth(new Error("Azure canceled: AuthenticationFailure")).impl);
  await assert.rejects(
    () => azureSpeechProvider.synthesize({ text: "hello there" }),
    /Azure/,
  );
});
