// server/src/lib/lyricVideo/align.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normWord, tokenize, alignTokens, placeLines, FLAG_CONFIDENCE, MAX_INTERP_GAP } from "./align.js";

const L = (id, text, kind = "lead") => ({ id, sectionId: "s1", kind, text });
const H = (word, start, end = start + 0.3) => ({ word, start, end });

describe("constants", () => {
  test("flag thresholds match the spec", () => {
    assert.equal(FLAG_CONFIDENCE, 0.6);
    assert.equal(MAX_INTERP_GAP, 3);
  });
});

describe("normWord", () => {
  test("strips accents, case and punctuation", () => {
    assert.equal(normWord("Ọmọ,"), "omo");
    assert.equal(normWord("dúpẹ́"), "dupe");
    assert.equal(normWord("man's"), "man's");
    assert.equal(normWord("?!"), "");
  });
});

describe("tokenize", () => {
  test("hyphenated words become parts of one word", () => {
    const t = tokenize([L("l1", "Eh-yeah, eh-yeah!")]);
    assert.deepEqual(t.map((x) => [x.word, x.norm]), [[0, "eh"], [0, "yeah"], [1, "eh"], [1, "yeah"]]);
  });
});

describe("alignTokens", () => {
  test("matches equal words and skips insertions", () => {
    assert.deepEqual(alignTokens(["who", "talk", "say"], ["um", "who", "talk", "say"]), [1, 2, 3]);
  });
  test("a mishearing between matches keeps its slot", () => {
    assert.deepEqual(alignTokens(["i", "dey", "wonder"], ["i", "de", "wonder"]), [0, 1, 2]);
  });
  test("a mismatch at the edge is not trusted", () => {
    assert.deepEqual(alignTokens(["pocket", "nearly"], ["rocket", "nearly"]), [-1, 1]);
  });
  test("handles empty inputs", () => {
    assert.deepEqual(alignTokens([], ["a"]), []);
    assert.deepEqual(alignTokens(["a", "b"], []), [-1, -1]);
  });
  test("a ~500 x ~700 token song aligns in well under a second", () => {
    const vocab = Array.from({ length: 60 }, (_, i) => `w${i}`);
    const a = Array.from({ length: 500 }, (_, i) => vocab[(i * 7) % 60]);
    const b = [];
    for (let i = 0; i < 700; i += 1) b.push(i % 7 === 0 ? `junk${i}` : a[Math.floor((i * 500) / 700)]);
    const t0 = Date.now();
    const map = alignTokens(a, b);
    const ms = Date.now() - t0;
    assert.equal(map.length, 500);
    assert.ok(ms < 1000, `took ${ms} ms`);
  });
});

describe("placeLines", () => {
  test("heard words give their times; line spans first to last word", () => {
    const [l] = placeLines([L("l1", "My time no late")], [H("My", 1), H("time", 1.4), H("no", 1.8), H("late", 2.1, 2.6)]);
    assert.deepEqual(l.words.map((w) => w.start), [1, 1.4, 1.8, 2.1]);
    assert.equal(l.start, 1);
    assert.equal(l.end, 2.6);
    assert.equal(l.confidence, 1);
    assert.equal(l.flag, null);
  });
  test("unheard words are spread between heard neighbours and the line is flagged", () => {
    const [l] = placeLines([L("l1", "one two three four five")], [H("one", 10), H("five", 14)]);
    assert.deepEqual(l.words.map((w) => w.start), [10, 11, 12, 13, 14]);
    assert.equal(l.confidence, 0.4);
    assert.equal(l.flag, "check");
  });
  test("an interpolation gap over 3 s flags even a well-heard line", () => {
    const lines = [L("l1", "alpha beta"), L("l2", "gamma delta"), L("l3", "epsilon zeta")];
    const out = placeLines(lines, [H("alpha", 0), H("beta", 0.5), H("epsilon", 9), H("zeta", 9.5)]);
    assert.equal(out[1].flag, "check");
    assert.equal(out[0].flag, null);
  });
  test("an unheard response sits just after its call, flagged", () => {
    const lines = [L("l1", "Who talk say I no go shine?"), L("l2", "(WHO TALK SAY?!)", "response"), L("l3", "Who talk say the joy no mine?")];
    const heard = [H("Who", 71.18), H("talk", 71.66), H("say", 72.14), H("I", 72.28), H("no", 72.7), H("go", 73.02), H("shine", 73.24, 73.6),
      H("Who", 76.0), H("talk", 76.3), H("say", 76.5), H("the", 76.8), H("joy", 77.1), H("no", 77.3), H("mine", 77.6)];
    const out = placeLines(lines, heard);
    assert.equal(out[1].start, 73.8);
    assert.ok(out[1].end <= out[2].start);
    assert.ok(out[1].end - out[1].start >= 0.7);
    assert.equal(out[1].confidence, 0);
    assert.equal(out[1].flag, "check");
  });
  test("a locked line keeps its times and anchors its neighbours", () => {
    const lines = [L("l1", "aa bb"), L("l2", "cc dd"), L("l3", "ee ff")];
    const locked = new Map([["l2", { words: [{ text: "cc", start: 5, end: 5.5 }, { text: "dd", start: 5.5, end: 6 }] }]]);
    const out = placeLines(lines, [H("aa", 1), H("bb", 1.5), H("ee", 9), H("ff", 9.5)], { locked });
    assert.deepEqual(out[1].words.map((w) => w.start), [5, 5.5]);
    assert.equal(out[1].flag, null);
  });
  test("starts are strictly increasing even when heard times collide", () => {
    const out = placeLines([L("l1", "a b c")], [H("a", 2), H("b", 2), H("c", 2)]);
    const s = out[0].words.map((w) => w.start);
    assert.ok(s[1] > s[0] && s[2] > s[1]);
  });
  test("Yoruba typed in NFD matches NFC heard words", () => {
    const [l] = placeLines([L("l1", "Ọmọ mi".normalize("NFD"))], [H("Omo", 33.08), H("mi", 33.1)]);
    assert.equal(l.confidence, 1);
  });
  test("a hyphenated sheet word aligns when Whisper split it in two", () => {
    const [l] = placeLines([L("l1", "Eh-yeah, my time")], [H("Eh", 5), H("yeah", 5.3), H("my", 5.8), H("time", 6.1)]);
    assert.equal(l.confidence, 1);
    assert.equal(l.flag, null);
    assert.deepEqual(l.words.map((w) => w.text), ["Eh-yeah,", "my", "time"]);
    assert.deepEqual(l.words.map((w) => w.start), [5, 5.8, 6.1]);
  });
  test("a hyphenated sheet word aligns when Whisper merged it into one", () => {
    const [l] = placeLines([L("l1", "Eh-yeah, my time")], [H("Ehyeah", 5, 5.6), H("my", 5.8), H("time", 6.1)]);
    // merged form cannot match the parts; the word is interpolated, not mis-timed
    assert.deepEqual(l.words.map((w) => w.text), ["Eh-yeah,", "my", "time"]);
    assert.ok(l.words[0].start < l.words[1].start);
  });
  test("a full-size song places in well under a second", () => {
    const lines = Array.from({ length: 80 }, (_, i) => L(`l${i + 1}`, Array.from({ length: 5 }, (_, k) => `word${(i * 5 + k) % 90}`).join(" ")));
    const heard = [];
    lines.forEach((ln, i) => ln.text.split(" ").forEach((w, k) => { heard.push(H(w, i * 2.5 + k * 0.4)); if (k % 2 === 0) heard.push(H(`extra${i}${k}`, i * 2.5 + k * 0.4 + 0.1)); }));
    const t0 = Date.now();
    const out = placeLines(lines, heard, { durationSec: 250 });
    const ms = Date.now() - t0;
    assert.equal(out.length, 80);
    assert.ok(ms < 1000, `took ${ms} ms`);
  });
});
