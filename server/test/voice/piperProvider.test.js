/**
 * Piper TTS provider — free local fallback (slot 4 in the priority chain).
 *
 * Piper itself is a CLI/ONNX library; the provider speaks to any local
 * HTTP wrapper around it (see docs/PIPER_SETUP.md). The synth call is
 * fronted by an injectable seam (_setSynthImpl) so the provider's
 * format-detection / file-write / SpeechResult mapping can be unit-tested
 * without a running Piper service.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Per-suite tmp OUTPUT_DIR so file-write tests don't pollute the repo.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "piper-provider-"));
process.env.OUTPUT_DIR = TMP;

const { piperProvider, _setSynthImpl, _resetSynthImpl } = await import(
  "../../src/lib/voice/providers/piperProvider.js"
);

const ORIG_URL = process.env.PIPER_URL;
const ORIG_VOICE = process.env.PIPER_VOICE;

beforeEach(() => {
  process.env.PIPER_URL = "http://127.0.0.1:5050/tts";
  delete process.env.PIPER_VOICE;
});

afterEach(() => {
  if (ORIG_URL === undefined) delete process.env.PIPER_URL;
  else process.env.PIPER_URL = ORIG_URL;
  if (ORIG_VOICE === undefined) delete process.env.PIPER_VOICE;
  else process.env.PIPER_VOICE = ORIG_VOICE;
  _resetSynthImpl();
});

test("id is 'piper'", () => {
  assert.equal(piperProvider.id, "piper");
});

test("capabilities: bare TTS, no timestamps/ssml/clone, multilingual yes", () => {
  const c = piperProvider.capabilities();
  assert.equal(c.wordTimestamps, false);
  assert.equal(c.charTimestamps, false);
  assert.equal(c.ssml, false);
  assert.equal(c.voiceClone, false);
  assert.equal(c.multilingual, true);
});

test("isAvailable: true when PIPER_URL set, false when unset/blank", () => {
  process.env.PIPER_URL = "http://localhost:5050/tts";
  assert.equal(piperProvider.isAvailable(), true);

  process.env.PIPER_URL = "";
  assert.equal(piperProvider.isAvailable(), false);

  delete process.env.PIPER_URL;
  assert.equal(piperProvider.isAvailable(), false);
});

test("synthesize: rejects empty / short text", async () => {
  _setSynthImpl(async () => ({ audio: Buffer.from([1, 2, 3]), contentType: "audio/wav" }));
  await assert.rejects(piperProvider.synthesize({ text: "" }), /text required/i);
  await assert.rejects(piperProvider.synthesize({ text: "hi" }), /text required/i);
});

test("synthesize: rejects when PIPER_URL not configured", async () => {
  delete process.env.PIPER_URL;
  _setSynthImpl(async () => ({ audio: Buffer.from("x"), contentType: "audio/wav" }));
  await assert.rejects(piperProvider.synthesize({ text: "hello world" }), /PIPER_URL/);
});

test("synthesize: writes audio to OUTPUT_DIR, returns SpeechResult shape", async () => {
  const fakeAudio = Buffer.from("RIFF....WAVEfake");
  _setSynthImpl(async ({ text, voice }) => {
    assert.equal(text, "Hello world");
    assert.equal(voice, undefined); // no voiceId, no env default
    return { audio: fakeAudio, contentType: "audio/wav" };
  });

  const r = await piperProvider.synthesize({ text: "Hello world" });
  assert.equal(r.ok, true);
  assert.equal(r.provider, "piper");
  assert.equal(r.voice, "default");
  assert.match(r.file, /tts-piper-[0-9a-f-]+\.wav$/i);

  // File actually persisted, bytes match.
  const onDisk = fs.readFileSync(r.file);
  assert.deepEqual(onDisk, fakeAudio);
});

test("synthesize: uses voiceIds.piper > voiceId > env PIPER_VOICE", async () => {
  const calls = [];
  _setSynthImpl(async ({ voice }) => {
    calls.push(voice);
    return { audio: Buffer.from("x"), contentType: "audio/wav" };
  });

  process.env.PIPER_VOICE = "en_US-amy-low";

  await piperProvider.synthesize({ text: "hello world" });
  assert.equal(calls.at(-1), "en_US-amy-low"); // env default

  await piperProvider.synthesize({ text: "hello world", voiceId: "en_GB-alan-low" });
  assert.equal(calls.at(-1), "en_GB-alan-low"); // top-level voiceId wins over env

  await piperProvider.synthesize({
    text: "hello world",
    voiceId: "ignored",
    voiceIds: { piper: "en_US-ryan-high" },
  });
  assert.equal(calls.at(-1), "en_US-ryan-high"); // per-provider map wins over voiceId
});

test("synthesize: picks file extension from Content-Type (wav/mp3/ogg)", async () => {
  const cases = [
    { ct: "audio/wav", ext: ".wav" },
    { ct: "audio/x-wav; charset=binary", ext: ".wav" },
    { ct: "audio/mpeg", ext: ".mp3" },
    { ct: "audio/mp3", ext: ".mp3" },
    { ct: "audio/ogg", ext: ".ogg" },
    { ct: "application/octet-stream", ext: ".wav" }, // unknown → wav default
  ];
  for (const { ct, ext } of cases) {
    _setSynthImpl(async () => ({ audio: Buffer.from("x"), contentType: ct }));
    const r = await piperProvider.synthesize({ text: "hello world" });
    assert.ok(r.file.endsWith(ext), `${ct} should yield ${ext}, got ${r.file}`);
  }
});

test("synthesize: rejects when the wrapper returns empty audio", async () => {
  _setSynthImpl(async () => ({ audio: Buffer.alloc(0), contentType: "audio/wav" }));
  await assert.rejects(piperProvider.synthesize({ text: "hello world" }), /empty audio/i);
});

test("synthesize: propagates wrapper errors with context", async () => {
  _setSynthImpl(async () => {
    throw new Error("Piper error: 502 upstream gateway");
  });
  await assert.rejects(piperProvider.synthesize({ text: "hello world" }), /Piper error: 502/);
});
