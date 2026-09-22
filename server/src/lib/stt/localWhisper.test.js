import assert from "node:assert/strict";
import test from "node:test";

import { transcribeLocalWhisper, _resetTranscriberCache } from "./localWhisper.js";

const env = { LOCAL_WHISPER_MODEL_DIR: "C:/models", LOCAL_WHISPER_MODEL_ID: "Xenova/whisper-base" };
const audio = new Float32Array([0, 1, 0]);

test("a decode failure rejects instead of hanging forever", async () => {
  // decodePcmFloat32 used an async Promise executor: anything it threw before
  // wiring up ffmpeg was swallowed and the promise never settled, so the
  // transcription hung rather than failing over to OpenAI.
  await assert.rejects(
    () => transcribeLocalWhisper("sample.wav", {
      env,
      decodePcm: async () => { throw new Error("ffmpeg is missing"); },
      getTranscriber: async () => () => ({ chunks: [] }),
    }),
    /ffmpeg is missing/,
  );
});

test("the transcriber is cached per model, and a different model builds a new one", async () => {
  _resetTranscriberCache();
  const built = [];
  const getTranscriber = async (config) => {
    built.push(config.modelId);
    return () => ({ chunks: [{ text: "Amen", timestamp: [0, 0.4] }] });
  };
  const decodePcm = async () => audio;
  const base = { env, decodePcm };

  await transcribeLocalWhisper("a.wav", { ...base, getTranscriber });
  await transcribeLocalWhisper("b.wav", { ...base, getTranscriber });
  assert.deepEqual(built, ["Xenova/whisper-base"], "the same model is built once");

  await transcribeLocalWhisper("c.wav", {
    ...base,
    env: { ...env, LOCAL_WHISPER_MODEL_ID: "Xenova/whisper-small" },
    getTranscriber,
  });
  assert.deepEqual(built, ["Xenova/whisper-base", "Xenova/whisper-small"], "a new model id builds a new transcriber");
});

test("words come back mapped, and no words is null", async () => {
  _resetTranscriberCache();
  const decodePcm = async () => audio;
  const withChunks = (chunks) => ({ env, decodePcm, getTranscriber: async () => () => ({ chunks }) });

  const ok = await transcribeLocalWhisper("a.wav", withChunks([{ text: " Grace ", timestamp: [0.1, 0.5] }]));
  assert.deepEqual(ok.words, [{ text: "Grace", startMs: 100, endMs: 500 }]);

  _resetTranscriberCache();
  assert.equal(await transcribeLocalWhisper("b.wav", withChunks([])), null);
});

test("an unconfigured model directory returns null without decoding anything", async () => {
  let decoded = false;
  const out = await transcribeLocalWhisper("a.wav", {
    env: { LOCAL_WHISPER_MODEL_DIR: "" },
    decodePcm: async () => { decoded = true; return audio; },
    getTranscriber: async () => () => ({ chunks: [] }),
  });
  assert.equal(out, null);
  assert.equal(decoded, false);
});
