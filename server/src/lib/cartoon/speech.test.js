import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { speechScore, SPEECH_OK, parseSilences, speechWindows, transcribeClip } from "./speech.js";

test("exact speech scores 1, one word missing of five scores 0.8", () => {
  assert.equal(speechScore("Grandpa look the stars shine", "Grandpa look the stars shine"), 1);
  assert.equal(speechScore("Grandpa look the stars shine", "Grandpa look the shine"), 0.8);
  assert.equal(SPEECH_OK, 0.8);
});

test("curly quotes and punctuation do not lower the score", () => {
  const expected = "“Grandpa, look! The stars aren’t hiding tonight.”";
  const heard = "Grandpa look the stars aren't hiding tonight";
  assert.equal(speechScore(expected, heard), 1);
});

test("empty expected scores 1, empty heard against real words scores 0, extra heard words do not score above 1", () => {
  assert.equal(speechScore("", "anything at all"), 1);
  assert.equal(speechScore("...", ""), 1);
  assert.equal(speechScore("hello there", ""), 0);
  assert.equal(speechScore("hello there", "so hello there my friend"), 1);
  assert.equal(speechScore("hello there", "goodbye now"), 0);
});

test("word order matters: a longest common subsequence, not a bag of words", () => {
  assert.equal(speechScore("one two three four", "four three two one"), 0.25);
});

const SILENCE_STDERR = [
  "[silencedetect @ 0000] silence_start: 0",
  "[silencedetect @ 0000] silence_end: 0.42 | silence_duration: 0.42",
  "[silencedetect @ 0000] silence_start: 2.9",
  "[silencedetect @ 0000] silence_end: 3.6 | silence_duration: 0.7",
  "[silencedetect @ 0000] silence_start: 5.1",
  "[silencedetect @ 0000] silence_end: 6 | silence_duration: 0.9",
].join("\n");

test("silences become speech windows", () => {
  assert.deepEqual(parseSilences(SILENCE_STDERR, 6), [{ from: 0.42, to: 2.9 }, { from: 3.6, to: 5.1 }]);
});

test("a gap under 0.25 s between speech windows is bridged; windows under 0.2 s are dropped", () => {
  const stderr = [
    "silence_start: 1", "silence_end: 1.2 | silence_duration: 0.2",
    "silence_start: 3", "silence_end: 3.4 | silence_duration: 0.4",
    "silence_start: 3.5", "silence_end: 5 | silence_duration: 1.5",
  ].join("\n");
  // speech: [0,1], [1.2,3] (bridged with the first), [3.4,3.5] (0.1 s, dropped), [5,6]
  assert.deepEqual(parseSilences(stderr, 6), [{ from: 0, to: 3 }, { from: 5, to: 6 }]);
});

test("a silence that never ends runs to the end of the clip; no silences is one window; all silence is none", () => {
  assert.deepEqual(parseSilences("silence_start: 4.5", 6), [{ from: 0, to: 4.5 }]);
  assert.deepEqual(parseSilences("", 6), [{ from: 0, to: 6 }]);
  assert.deepEqual(parseSilences("silence_start: 0\nsilence_end: 6 | silence_duration: 6", 6), []);
});

test("the real measured clip: adjacent silences merge and the trailing one closes the speech", () => {
  const stderr = [
    "silence_start: 0", "silence_end: 0.363 | silence_duration: 0.363",
    "silence_start: 0.363", "silence_end: 0.769 | silence_duration: 0.406",
    "silence_start: 1.858", "silence_end: 2.861 | silence_duration: 1.003",
    "silence_start: 5.292", "silence_end: 6.08 | silence_duration: 0.788",
  ].join("\n");
  assert.deepEqual(parseSilences(stderr, 6.08), [{ from: 0.769, to: 1.858 }, { from: 2.861, to: 5.292 }]);
});

test("speechWindows runs silencedetect and parses its stderr; ffmpeg failure gives no windows", async () => {
  const calls = [];
  const ok = async (args) => { calls.push(args); return { ok: true, stderr: SILENCE_STDERR }; };
  const windows = await speechWindows("clip.mp4", { ffmpeg: ok, probe: async () => 6 });
  assert.deepEqual(windows, [{ from: 0.42, to: 2.9 }, { from: 3.6, to: 5.1 }]);
  assert.ok(calls[0].includes("silencedetect=noise=-32dB:d=0.35"));
  assert.ok(calls[0].includes("clip.mp4"));

  const failed = await speechWindows("clip.mp4", { ffmpeg: async () => ({ ok: false, stderr: "boom" }), probe: async () => 6 });
  assert.deepEqual(failed, []);
  const thrown = await speechWindows("clip.mp4", { ffmpeg: async () => { throw new Error("x"); }, probe: async () => 6 });
  assert.deepEqual(thrown, []);
});

function withKey(value, fn) {
  const before = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = value;
  return Promise.resolve(fn()).finally(() => {
    if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before;
  });
}

/** An ffmpeg stub that writes a fake WAV to the last argument, like the real thing. */
function wavWriter(seen) {
  return async (args) => {
    const out = args[args.length - 1];
    seen.push(out);
    fs.writeFileSync(out, Buffer.from("RIFFfake"));
    return { ok: true, stderr: "" };
  };
}

test("no key means not configured, never a throw", async () => {
  await withKey(undefined, async () => {
    const r = await transcribeClip("clip.mp4", {
      ffmpeg: async () => { throw new Error("must not run"); },
      fetchImpl: async () => { throw new Error("must not run"); },
    });
    assert.deepEqual(r, { ok: false, error: "not configured" });
  });
});

test("transcribeClip sends the WAV to gpt-4o-transcribe and removes the temp file", async () => {
  await withKey("sk-test-secret", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "speech-test-"));
    const seen = [];
    let request = null;
    const fetchImpl = async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, json: async () => ({ text: "Grandpa, look! The stars are everywhere tonight!" }) };
    };
    const r = await transcribeClip("clip.mp4", { ffmpeg: wavWriter(seen), fetchImpl, tmpDir });
    assert.deepEqual(r, { ok: true, text: "Grandpa, look! The stars are everywhere tonight!" });
    assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.headers.Authorization, "Bearer sk-test-secret");
    assert.equal(request.init.body.get("model"), "gpt-4o-transcribe");
    assert.ok(request.init.body.get("file"));
    assert.ok(seen[0].startsWith(tmpDir));
    assert.deepEqual(fs.readdirSync(tmpDir), []);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test("a thrown error becomes one fixed sentence, never its own text or a server path", async () => {
  await withKey("sk-test-secret", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "speech-test-"));
    const cases = {
      noWav: { ffmpeg: async () => ({ ok: true }), fetchImpl: async () => { throw new Error("must not run"); } },
      ffmpegThrows: { ffmpeg: async () => { throw new Error(`ENOENT: ${path.join(tmpDir, "x.wav")}`); }, fetchImpl: async () => { throw new Error("no"); } },
      networkError: { ffmpeg: wavWriter([]), fetchImpl: async () => { throw new Error(`connect ECONNRESET ${tmpDir}`); } },
    };
    for (const [name, deps] of Object.entries(cases)) {
      const r = await transcribeClip("clip.mp4", { ...deps, tmpDir });
      assert.deepEqual(r, { ok: false, error: "The speech check could not run." }, name);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test("transcribeClip never throws and never leaks the key, and always cleans up", async () => {
  await withKey("sk-test-secret", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "speech-test-"));
    const cases = {
      ffmpegFails: { ffmpeg: async () => ({ ok: false, stderr: "bad input", error: "exit 1" }), fetchImpl: async () => { throw new Error("no"); } },
      ffmpegThrows: { ffmpeg: async () => { throw new Error("spawn failed"); }, fetchImpl: async () => { throw new Error("no"); } },
      httpError: { ffmpeg: wavWriter([]), fetchImpl: async () => ({ ok: false, status: 401, text: async () => "bad key sk-test-secret", json: async () => ({}) }) },
      networkError: { ffmpeg: wavWriter([]), fetchImpl: async () => { throw new Error("connect ECONNRESET sk-test-secret"); } },
      badBody: { ffmpeg: wavWriter([]), fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }) },
    };
    for (const [name, deps] of Object.entries(cases)) {
      const r = await transcribeClip("clip.mp4", { ...deps, tmpDir });
      assert.equal(r.ok, false, name);
      assert.ok(typeof r.error === "string" && r.error.length > 0, name);
      assert.ok(!r.error.includes("sk-test-secret"), `${name} leaked the key`);
      assert.deepEqual(fs.readdirSync(tmpDir), [], `${name} left a temp file`);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
