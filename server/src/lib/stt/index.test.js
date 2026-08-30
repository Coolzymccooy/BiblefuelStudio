import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseSttProvider,
  normalizeSttProviderId,
  transcribeAudio,
} from "./index.js";
import { mapWhisperChunksToWords } from "./localWhisper.js";

test("normalizeSttProviderId defaults to openai and accepts local-whisper aliases", () => {
  assert.equal(normalizeSttProviderId(""), "openai");
  assert.equal(normalizeSttProviderId("whisper"), "local-whisper");
  assert.equal(normalizeSttProviderId("local"), "local-whisper");
  assert.equal(normalizeSttProviderId("local-whisper"), "local-whisper");
  assert.equal(normalizeSttProviderId("something-else"), "openai");
});

test("chooseSttProvider uses STT_PROVIDER but falls back to OpenAI when local model is not configured", () => {
  const chosen = chooseSttProvider({
    env: {
      STT_PROVIDER: "local-whisper",
      LOCAL_WHISPER_MODEL_DIR: "",
    },
  });
  assert.equal(chosen.id, "openai");
  assert.match(chosen.reason, /not configured/i);
});

test("chooseSttProvider enables local-whisper when a model directory is configured", () => {
  const chosen = chooseSttProvider({
    env: {
      STT_PROVIDER: "local-whisper",
      LOCAL_WHISPER_MODEL_DIR: "C:/models",
      LOCAL_WHISPER_MODEL_ID: "Xenova/whisper-base",
    },
  });
  assert.equal(chosen.id, "local-whisper");
  assert.equal(chosen.modelId, "Xenova/whisper-base");
});

test("mapWhisperChunksToWords maps Lumina-style word timestamps into BibleFuel word timings", () => {
  const words = mapWhisperChunksToWords([
    { text: " Grace ", timestamp: [0.12, 0.42] },
    { text: "", timestamp: [0.5, 0.8] },
    { text: "flows", timestamp: [0.43, 0.95] },
    { text: "bad", timestamp: [null, 1.2] },
  ]);

  assert.deepEqual(words, [
    { text: "Grace", startMs: 120, endMs: 420 },
    { text: "flows", startMs: 430, endMs: 950 },
  ]);
});

test("transcribeAudio returns provider metadata from the selected provider", async () => {
  const result = await transcribeAudio("sample.wav", {
    env: { STT_PROVIDER: "openai" },
    providers: {
      openai: {
        transcribe: async (audioPath) => ({ words: [{ text: "Amen", startMs: 0, endMs: 400 }], audioPath }),
      },
    },
  });

  assert.deepEqual(result, {
    provider: "openai",
    words: [{ text: "Amen", startMs: 0, endMs: 400 }],
    audioPath: "sample.wav",
  });
});

test("transcribeAudio falls back to OpenAI when selected local-whisper fails", async () => {
  const result = await transcribeAudio("sample.wav", {
    env: { STT_PROVIDER: "local-whisper", LOCAL_WHISPER_MODEL_DIR: "C:/models" },
    providers: {
      'local-whisper': {
        transcribe: async () => { throw new Error('local model missing'); },
      },
      openai: {
        transcribe: async (audioPath) => ({ words: [{ text: "Fallback", startMs: 0, endMs: 500 }], audioPath }),
      },
    },
  });

  assert.deepEqual(result, {
    provider: "openai",
    fallbackFrom: "local-whisper",
    fallbackError: "local model missing",
    words: [{ text: "Fallback", startMs: 0, endMs: 500 }],
    audioPath: "sample.wav",
  });
});
