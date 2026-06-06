import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreWord, categoryOf } from "../../src/lib/emphasisLexicon.js";

/**
 * The emphasis lexicon replaces the purely length-based keyword heuristic with
 * a deterministic, categorized scoring function. Scripture/emotion words score
 * higher so the annotation layer can pick a "hero" word per phrase. Unknown
 * words score 0, which preserves the existing longest-word fallback downstream.
 */

test("deity words score highest", () => {
  assert.equal(scoreWord("Lord"), 5);
  assert.equal(scoreWord("God"), 5);
  assert.equal(scoreWord("shepherd"), 5);
});

test("hope words score above action/fear", () => {
  assert.equal(scoreWord("mercy"), 4);
  assert.equal(scoreWord("grace"), 4);
  assert.ok(scoreWord("mercy") > scoreWord("fight"));
});

test("action and fear words score in the dramatic mid band", () => {
  assert.equal(scoreWord("conquer"), 3);
  assert.equal(scoreWord("fear"), 3);
  assert.equal(scoreWord("evil"), 3);
});

test("scoring is case-insensitive", () => {
  assert.equal(scoreWord("LORD"), scoreWord("lord"));
  assert.equal(scoreWord("MeRcY"), 4);
});

test("scoring strips surrounding punctuation", () => {
  assert.equal(scoreWord("Lord,"), 5);
  assert.equal(scoreWord("\"peace\""), 4);
  assert.equal(scoreWord("evil!"), 3);
});

test("apostrophes inside a token are preserved", () => {
  // Tokenizer mirrors captions.js which keeps ' as a word char.
  assert.equal(scoreWord("God's"), 0); // "god's" is not a lexicon entry; deity match is exact
  assert.equal(scoreWord("lord's"), 0);
});

test("unknown / common words score 0", () => {
  assert.equal(scoreWord("the"), 0);
  assert.equal(scoreWord("shepherd's"), 0);
  assert.equal(scoreWord("table"), 0);
  assert.equal(scoreWord(""), 0);
  assert.equal(scoreWord(null), 0);
  assert.equal(scoreWord(undefined), 0);
});

test("categoryOf returns the matching bucket or null", () => {
  assert.equal(categoryOf("Jesus"), "deity");
  assert.equal(categoryOf("victory"), "hope");
  assert.equal(categoryOf("overcome"), "action");
  assert.equal(categoryOf("darkness"), "fear");
  assert.equal(categoryOf("table"), null);
  assert.equal(categoryOf(""), null);
});
