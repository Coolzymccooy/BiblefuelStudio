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
