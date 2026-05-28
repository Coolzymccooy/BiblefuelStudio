import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { wordsToCharAlignment, transcribeAudio } from "../../src/lib/voice/alignment.js";

test("wordsToCharAlignment: empty input → empty arrays", () => {
  const a = wordsToCharAlignment([]);
  assert.deepEqual(a.characters, []);
  assert.deepEqual(a.starts, []);
  assert.deepEqual(a.ends, []);
});

test("wordsToCharAlignment: single word expands per-character", () => {
  const a = wordsToCharAlignment([{ word: "Hi", start: 0, end: 0.4 }]);
  assert.deepEqual(a.characters, ["H", "i"]);
  assert.deepEqual(a.starts, [0, 0.2]);
  assert.deepEqual(a.ends, [0.2, 0.4]);
});

test("wordsToCharAlignment: inserts zero-duration space between words", () => {
  const a = wordsToCharAlignment([
    { word: "Fear", start: 1.0, end: 1.4 },
    { word: "not", start: 1.5, end: 1.8 },
  ]);
  // Characters: F, e, a, r, <space>, n, o, t
  assert.deepEqual(a.characters, ["F", "e", "a", "r", " ", "n", "o", "t"]);
  // First word ends at 1.4 → space's start AND end are 1.4
  assert.equal(a.starts[4], 1.4);
  assert.equal(a.ends[4], 1.4);
  // Second word starts at 1.5
  assert.equal(a.starts[5], 1.5);
  assert.equal(a.ends[7], 1.8);
});

test("wordsToCharAlignment: handles zero-duration word without dividing by zero", () => {
  const a = wordsToCharAlignment([{ word: "x", start: 0.5, end: 0.5 }]);
  assert.deepEqual(a.characters, ["x"]);
  assert.equal(a.starts[0], 0.5);
  assert.equal(a.ends[0], 0.5);
});

test("wordsToCharAlignment: skips empty word strings but still inserts separator", () => {
  const a = wordsToCharAlignment([
    { word: "a", start: 0, end: 0.1 },
    { word: "", start: 0.2, end: 0.3 },
    { word: "b", start: 0.4, end: 0.5 },
  ]);
  // a, <space after a>, <space after empty>, b
  assert.deepEqual(a.characters, ["a", " ", " ", "b"]);
});

describe("transcribeAudio", () => {
  test("returns null when OPENAI_API_KEY is absent", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await transcribeAudio("/nonexistent.mp3");
      assert.equal(result, null);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  test("maps Whisper words to { text, startMs, endMs } when fetch is stubbed", async (t) => {
    process.env.OPENAI_API_KEY = "sk-test";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(dir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.from("not-real-mp3-bytes"));
    t.after(() => {
      delete process.env.OPENAI_API_KEY;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        words: [
          { word: "Grace", start: 0.0, end: 0.42 },
          { word: "abounds", start: 0.42, end: 1.10 },
        ],
      }),
    });

    const result = await transcribeAudio(audioPath, { _fetchImpl: fakeFetch });
    assert.deepEqual(result, {
      words: [
        { text: "Grace", startMs: 0, endMs: 420 },
        { text: "abounds", startMs: 420, endMs: 1100 },
      ],
    });
  });
});
