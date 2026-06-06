import { test } from "node:test";
import assert from "node:assert/strict";

import {
  captionWordsFromNativeWords,
  charsToWords,
  annotateEmphasisTiers,
  splitPhrases,
  annotatePhrasedTiers,
} from "../../src/lib/captions.js";

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

// ─── annotateEmphasisTiers: 3-tier semantic emphasis ──────────────────────
// Tags each word level: "normal" | "key" | "hero". Lexicon hits become "key";
// the single highest-scoring word per phrase becomes "hero" (at most one).
// When no word scores, the longest-word fallback (pickKeyword) becomes the lone
// "key" with no hero. `emphasize: true` is set for key+hero for back-compat.

const wseq = (...texts) =>
  texts.map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }));

const levels = (annotated) => annotated.map((w) => w.level);

test("annotateEmphasisTiers: highest lexicon word is hero, other hits are key", () => {
  const words = wseq("The", "Lord", "is", "my", "shepherd");
  const out = annotateEmphasisTiers(words);
  assert.deepEqual(levels(out), ["normal", "hero", "normal", "normal", "key"]);
  assert.equal(out[1].emphasize, true); // hero
  assert.equal(out[4].emphasize, true); // key
  assert.equal(out[0].emphasize, false);
});

test("annotateEmphasisTiers: multiple emphasis words allowed in one phrase", () => {
  const words = wseq("I", "will", "fear", "no", "evil");
  const out = annotateEmphasisTiers(words);
  // fear(3) and evil(3) both score; first max → hero, the other → key.
  assert.deepEqual(levels(out), ["normal", "normal", "hero", "normal", "key"]);
});

test("annotateEmphasisTiers: exactly one hero per phrase", () => {
  const words = wseq("Lord", "God", "of", "glory");
  const out = annotateEmphasisTiers(words);
  assert.equal(out.filter((w) => w.level === "hero").length, 1);
});

test("annotateEmphasisTiers: falls back to longest word when no lexicon hit", () => {
  const words = wseq("Walking", "down", "the", "road");
  const out = annotateEmphasisTiers(words);
  // No lexicon words → pickKeyword longest non-stopword ("walking") becomes the
  // single key, and there is NO hero (hero requires a lexicon score).
  assert.deepEqual(levels(out), ["key", "normal", "normal", "normal"]);
  assert.equal(out.filter((w) => w.level === "hero").length, 0);
});

test("annotateEmphasisTiers: assigns a hero per line when lines are provided", () => {
  const words = wseq("The", "Lord", "is", "my", "shepherd", "I", "shall", "not", "want");
  const out = annotateEmphasisTiers(words, ["The Lord is my shepherd", "I shall not want"]);
  // Line 1: Lord is hero, shepherd key. Line 2: no lexicon → "want" fallback key.
  assert.equal(out[1].level, "hero"); // Lord
  assert.equal(out[4].level, "key"); // shepherd
  assert.equal(out.filter((w) => w.level === "hero").length, 1);
  assert.equal(out[8].level, "key"); // want (fallback in line 2)
});

test("annotateEmphasisTiers: empty input returns []", () => {
  assert.deepEqual(annotateEmphasisTiers([]), []);
  assert.deepEqual(annotateEmphasisTiers(null), []);
});

test("annotateEmphasisTiers: returns new objects (no mutation)", () => {
  const words = wseq("Lord");
  const out = annotateEmphasisTiers(words);
  assert.notEqual(out[0], words[0]);
  assert.equal(words[0].level, undefined);
});

// ─── splitPhrases: micro-phrase chunking ──────────────────────────────────
// Groups timed words into short emotional fragments. Breaks on terminal
// punctuation first, then on word/char limits. Each phrase carries start/end
// from its member words.

test("splitPhrases: chunks by word limit (default 3)", () => {
  const words = wseq("The", "Lord", "is", "my", "shepherd");
  const phrases = splitPhrases(words);
  assert.deepEqual(phrases.map((p) => p.text), ["The Lord is", "my shepherd"]);
  assert.equal(phrases[0].start, words[0].start);
  assert.equal(phrases[0].end, words[2].end);
  assert.equal(phrases[1].end, words[4].end);
});

test("splitPhrases: breaks on terminal punctuation before the word limit", () => {
  const words = wseq("Be", "still,", "and", "know");
  const phrases = splitPhrases(words);
  // Comma ends the first phrase even though 3 words would fit.
  assert.deepEqual(phrases.map((p) => p.text), ["Be still,", "and know"]);
});

test("splitPhrases: respects the char limit for long words", () => {
  const words = wseq("Everlasting", "righteousness", "now");
  const phrases = splitPhrases(words, { maxWords: 3, maxChars: 22 });
  // "Everlasting righteousness" = 25 chars > 22 → split after the first word.
  assert.deepEqual(phrases.map((p) => p.text), ["Everlasting", "righteousness now"]);
});

test("splitPhrases: each phrase exposes its member words", () => {
  const words = wseq("Lord", "of", "hosts");
  const [phrase] = splitPhrases(words, { maxWords: 5, maxChars: 40 });
  assert.equal(phrase.words.length, 3);
  assert.equal(phrase.words[0].text, "Lord");
});

test("splitPhrases: empty/invalid input returns []", () => {
  assert.deepEqual(splitPhrases([]), []);
  assert.deepEqual(splitPhrases(null), []);
});

test("splitPhrases output feeds annotateEmphasisTiers (one hero per phrase)", () => {
  const words = wseq("The", "Lord", "is", "my", "shepherd");
  const phrases = splitPhrases(words); // ["The Lord is", "my shepherd"]
  const out = annotateEmphasisTiers(words, phrases.map((p) => p.text));
  // Each phrase containing a lexicon word gets its own hero (one per phrase).
  // Both phrases here hold a deity word, so 2 heroes total — never >1 per phrase.
  assert.equal(out.filter((w) => w.level === "hero").length, phrases.length);
});

// ─── annotatePhrasedTiers: the wired render-path helper ───────────────────
// Composes splitPhrases + annotateEmphasisTiers so the renderer gets one hero
// per short on-screen phrase (not per long beat-line). This is what the kinetic
// caption path calls.

test("annotatePhrasedTiers: tiers every word and gives one hero per micro-phrase", () => {
  const words = wseq("The", "Lord", "is", "my", "shepherd");
  const out = annotatePhrasedTiers(words); // chunks → ["The Lord is", "my shepherd"]
  assert.equal(out.length, words.length);
  // Each micro-phrase with a lexicon word gets a hero; both phrases here do.
  assert.equal(out.filter((w) => w.level === "hero").length, 2);
  assert.ok(out.every((w) => ["normal", "key", "hero"].includes(w.level)));
});

test("annotatePhrasedTiers: preserves timing and back-compat emphasize flag", () => {
  const words = wseq("Lord", "of", "mercy");
  const out = annotatePhrasedTiers(words);
  assert.equal(out[0].start, words[0].start);
  assert.equal(out[0].end, words[0].end);
  // hero/key words still carry emphasize:true for older consumers.
  assert.ok(out.filter((w) => w.emphasize).length >= 1);
});

test("annotatePhrasedTiers: empty input returns []", () => {
  assert.deepEqual(annotatePhrasedTiers([]), []);
  assert.deepEqual(annotatePhrasedTiers(null), []);
});
