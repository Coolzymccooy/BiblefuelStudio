import { test } from "node:test";
import assert from "node:assert/strict";

import { numberToWords, prepareScriptureForSpeech } from "../../src/lib/voice/scripture.js";

/**
 * prepareScriptureForSpeech makes raw devotional/scripture text read naturally
 * when spoken: Bible references are expanded ("Psalm 91:1" → "Psalm chapter
 * ninety-one, verse one"), numbers become words, and pacing punctuation is
 * normalized. Pure function — no provider/network.
 */

// ─── numberToWords ───────────────────────────────────────────────────────

test("numberToWords handles ones, teens, tens, hundreds", () => {
  assert.equal(numberToWords(1), "one");
  assert.equal(numberToWords(16), "sixteen");
  assert.equal(numberToWords(91), "ninety-one");
  assert.equal(numberToWords(105), "one hundred five");
  assert.equal(numberToWords(119), "one hundred nineteen");
  assert.equal(numberToWords(176), "one hundred seventy-six");
});

// ─── reference expansion ─────────────────────────────────────────────────

test("expands a simple Book chapter:verse reference", () => {
  assert.equal(
    prepareScriptureForSpeech("Psalm 91:1"),
    "Psalm chapter ninety-one, verse one.",
  );
});

test("expands references with single-digit chapter and double-digit verse", () => {
  assert.equal(
    prepareScriptureForSpeech("John 3:16"),
    "John chapter three, verse sixteen.",
  );
});

test("expands a numbered book (1 John)", () => {
  const out = prepareScriptureForSpeech("1 John 4:8");
  assert.ok(out.includes("1 John chapter four, verse eight"));
});

test("expands a multi-word book (Song of Solomon)", () => {
  const out = prepareScriptureForSpeech("Song of Solomon 2:1");
  assert.ok(out.includes("Song of Solomon chapter two, verse one"), out);
});

test("expands a verse range with 'to'", () => {
  const out = prepareScriptureForSpeech("Genesis 1:1-3");
  assert.ok(out.includes("Genesis chapter one, verses one to three"), out);
});

test("expands a reference embedded in a sentence", () => {
  const out = prepareScriptureForSpeech("As it says in Philippians 4:13, we can do all things.");
  assert.ok(out.includes("Philippians chapter four, verse thirteen"), out);
  assert.ok(out.includes("we can do all things"), out);
});

// ─── pacing / normalization ──────────────────────────────────────────────

test("collapses excess whitespace and ensures terminal punctuation", () => {
  const out = prepareScriptureForSpeech("Be still   and know");
  assert.equal(out, "Be still and know.");
});

test("leaves already-punctuated prose intact (no double period)", () => {
  const out = prepareScriptureForSpeech("The Lord is my shepherd.");
  assert.equal(out, "The Lord is my shepherd.");
});

test("returns empty string for empty/whitespace input", () => {
  assert.equal(prepareScriptureForSpeech(""), "");
  assert.equal(prepareScriptureForSpeech("   "), "");
  assert.equal(prepareScriptureForSpeech(null), "");
});
