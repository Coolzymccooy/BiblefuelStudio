import { test } from "node:test";
import assert from "node:assert/strict";

import {
  charAlignmentToWords,
  toAlignmentContract,
} from "../../src/lib/voice/alignmentContract.js";

/**
 * The unified word-alignment contract is:
 *   { audioPath, words: [{ text, startMs, endMs }] }
 *
 * It normalizes two existing timing sources into one provider-agnostic shape:
 *   - Azure WordBoundary words (native, already ms) → passed through
 *   - char-level alignment ({characters,starts,ends} in seconds) → grouped to words
 */

// ─── charAlignmentToWords ────────────────────────────────────────────────

test("charAlignmentToWords groups characters into words and converts seconds→ms", () => {
  // "Be still"
  const alignment = {
    characters: ["B", "e", " ", "s", "t", "i", "l", "l"],
    starts: [0.0, 0.1, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6],
    ends: [0.1, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  };

  const words = charAlignmentToWords(alignment);

  assert.deepEqual(words, [
    { text: "Be", startMs: 0, endMs: 200 },
    { text: "still", startMs: 200, endMs: 700 },
  ]);
});

test("charAlignmentToWords returns [] for empty/missing input", () => {
  assert.deepEqual(charAlignmentToWords({ characters: [], starts: [], ends: [] }), []);
  assert.deepEqual(charAlignmentToWords(null), []);
  assert.deepEqual(charAlignmentToWords(undefined), []);
});

test("charAlignmentToWords collapses runs of multiple spaces", () => {
  const alignment = {
    characters: ["a", " ", " ", "b"],
    starts: [0.0, 0.1, 0.1, 0.2],
    ends: [0.1, 0.1, 0.2, 0.3],
  };
  const words = charAlignmentToWords(alignment);
  assert.deepEqual(words, [
    { text: "a", startMs: 0, endMs: 100 },
    { text: "b", startMs: 200, endMs: 300 },
  ]);
});

// ─── toAlignmentContract ─────────────────────────────────────────────────

test("toAlignmentContract uses native words[] when present", () => {
  const result = {
    ok: true,
    file: "/out/tts-azure-x.mp3",
    provider: "azure",
    voice: "en-US-GuyNeural",
    words: [
      { text: "For", startMs: 0, endMs: 180 },
      { text: "God", startMs: 180, endMs: 420 },
    ],
  };

  const contract = toAlignmentContract(result);

  assert.equal(contract.audioPath, "/out/tts-azure-x.mp3");
  assert.deepEqual(contract.words, result.words);
});

test("toAlignmentContract derives words from char alignment when words absent", () => {
  const result = {
    ok: true,
    file: "/out/tts-elevenlabs-y.mp3",
    provider: "elevenlabs",
    voice: "v",
    alignment: {
      characters: ["H", "i", " ", "t", "h", "e", "r", "e"],
      starts: [0.0, 0.1, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6],
      ends: [0.1, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    },
  };

  const contract = toAlignmentContract(result);

  assert.equal(contract.audioPath, "/out/tts-elevenlabs-y.mp3");
  assert.deepEqual(contract.words, [
    { text: "Hi", startMs: 0, endMs: 200 },
    { text: "there", startMs: 200, endMs: 700 },
  ]);
});

test("toAlignmentContract returns empty words when neither words nor alignment present", () => {
  const result = { ok: true, file: "/out/tts-edge-z.mp3", provider: "edge", voice: "v" };
  const contract = toAlignmentContract(result);
  assert.equal(contract.audioPath, "/out/tts-edge-z.mp3");
  assert.deepEqual(contract.words, []);
});

const usableChars = { characters: ["H", "i"], starts: [0, 0.1], ends: [0.1, 0.2] };

test("empty or invalid native sources recover from usable character timing", () => {
  for (const words of [[], null, {}, [null], [{ text: "Hi", startMs: 0, endMs: 0 }]]) {
    assert.deepEqual(toAlignmentContract({ words, alignment: usableChars }).words,
      [{ text: "Hi", startMs: 0, endMs: 200 }]);
  }
});

test("valid native Unicode/punctuation and fractional milliseconds retain priority and identity", () => {
  const words = [{ text: "  Ẹ káàrọ̀—世界! 🙏  ", startMs: 0.125, endMs: 20.875 }];
  assert.equal(toAlignmentContract({ words, alignment: usableChars }).words, words);
});

test("character Unicode, punctuation, surrogate units and fractional ms are preserved", () => {
  const characters = ["Ẹ", "́", "—", "世", "界", "!", "\t", ..."🙏".split("")];
  const alignment = {
    characters,
    starts: characters.map((_, i) => 0.000125 + i * 0.01),
    ends: characters.map((_, i) => 0.000125 + (i + 1) * 0.01),
  };
  assert.deepEqual(charAlignmentToWords(alignment), [
    { text: "Ẹ́—世界!", startMs: alignment.starts[0] * 1000, endMs: alignment.ends[5] * 1000 },
    { text: "🙏", startMs: alignment.starts[7] * 1000, endMs: alignment.ends.at(-1) * 1000 },
  ]);
  assert.equal(charAlignmentToWords(alignment)[0].startMs, 0.125);
});

test("malformed native timing rejects the entire source, never a valid prefix", () => {
  const first = { text: "Hi", startMs: 100, endMs: 200 };
  const bad = [
    null, { text: undefined }, { text: "" }, { text: " \t" }, { text: 42 },
    { startMs: NaN }, { startMs: Infinity }, { startMs: -1 },
    { startMs: "200" }, { startMs: null }, { startMs: undefined },
    { endMs: Infinity }, { endMs: NaN }, { endMs: "400" }, { endMs: null },
    { startMs: 300, endMs: 300 }, { startMs: 400, endMs: 300 },
    { startMs: 50, endMs: 400 }, { startMs: 150, endMs: 175 },
  ];
  for (const invalid of bad) {
    const second = invalid === null ? null : { text: "there", startMs: 200, endMs: 400, ...invalid };
    assert.deepEqual(toAlignmentContract({ words: [first, second] }).words, [], JSON.stringify(invalid));
  }
});

test("malformed character timing is rejected without defaults or partial words", () => {
  const invalid = [
    {}, { characters: ["a"], starts: [], ends: [] },
    { ...usableChars, starts: [0] }, { ...usableChars, ends: [0.1, 0.2, 0.3] },
    { ...usableChars, characters: ["H", null] },
    { ...usableChars, characters: ["H", ""] },
    { ...usableChars, characters: ["H", 4] },
    { ...usableChars, characters: ["H", "i there"] },
    { characters: [" "], starts: [0], ends: [0.1] },
    { characters: ["a"], starts: [0], ends: [0] },
    { ...usableChars, starts: [0.1, 0.05] },
    { ...usableChars, ends: [0.2, 0.15] },
    { characters: ["a"], starts: [1e308], ends: [1.1e308] },
  ];
  for (const value of [undefined, null, "0.1", NaN, Infinity, -0.1]) {
    invalid.push({ ...usableChars, starts: [0, value] });
    invalid.push({ ...usableChars, ends: [0.1, value] });
  }
  for (const alignment of invalid) assert.deepEqual(charAlignmentToWords(alignment), []);
});

test("zero-duration punctuation can finish a positive word without fabricated padding", () => {
  assert.deepEqual(charAlignmentToWords({ characters: ["a", "!"], starts: [0, 0.1], ends: [0.1, 0.1] }),
    [{ text: "a!", startMs: 0, endMs: 100 }]);
});
