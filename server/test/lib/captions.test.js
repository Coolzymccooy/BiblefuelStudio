import { test } from "node:test";
import assert from "node:assert/strict";

import { captionWordsFromNativeWords, charsToWords } from "../../src/lib/captions.js";

/**
 * captionWordsFromNativeWords bridges the unified word-alignment contract
 * ({ text, startMs, endMs } in milliseconds — e.g. Azure WordBoundary) into the
 * caption pipeline's word shape ({ text, start, end } in seconds) consumed by
 * annotateEmphasis / groupWordsByBeat and the ffmpeg drawtext builders.
 */

test("captionWordsFromNativeWords converts ms→seconds preserving order", () => {
  const words = [
    { text: "For", startMs: 0, endMs: 180 },
    { text: "God", startMs: 180, endMs: 420 },
  ];
  assert.deepEqual(captionWordsFromNativeWords(words), [
    { text: "For", start: 0, end: 0.18 },
    { text: "God", start: 0.18, end: 0.42 },
  ]);
});

test("captionWordsFromNativeWords enforces a minimum 50ms word duration", () => {
  // Zero/negative spans would make drawtext enable windows collapse.
  const words = [{ text: "Amen", startMs: 1000, endMs: 1000 }];
  const out = captionWordsFromNativeWords(words);
  assert.equal(out[0].start, 1);
  assert.ok(out[0].end >= out[0].start + 0.05);
});

test("captionWordsFromNativeWords drops empty/whitespace tokens", () => {
  const words = [
    { text: "Be", startMs: 0, endMs: 100 },
    { text: "  ", startMs: 100, endMs: 120 },
    { text: "still", startMs: 120, endMs: 300 },
  ];
  assert.deepEqual(captionWordsFromNativeWords(words), [
    { text: "Be", start: 0, end: 0.1 },
    { text: "still", start: 0.12, end: 0.3 },
  ]);
});

test("captionWordsFromNativeWords returns [] for empty/invalid input", () => {
  assert.deepEqual(captionWordsFromNativeWords([]), []);
  assert.deepEqual(captionWordsFromNativeWords(null), []);
  assert.deepEqual(captionWordsFromNativeWords(undefined), []);
});

// Guard: the native-words output shape matches what charsToWords produces, so
// downstream annotateEmphasis/groupWordsByBeat treat both identically.
test("captionWordsFromNativeWords output shape matches charsToWords", () => {
  const native = captionWordsFromNativeWords([{ text: "Hi", startMs: 0, endMs: 200 }]);
  const fromChars = charsToWords({
    characters: ["H", "i"],
    starts: [0.0, 0.1],
    ends: [0.1, 0.2],
  });
  assert.deepEqual(Object.keys(native[0]).sort(), Object.keys(fromChars[0]).sort());
});
