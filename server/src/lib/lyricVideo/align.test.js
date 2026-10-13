// server/src/lib/lyricVideo/align.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normWord, tokenize, alignTokens, placeLines, FLAG_CONFIDENCE, MAX_INTERP_GAP } from "./align.js";

const L = (id, text, kind = "lead") => ({ id, sectionId: "s1", kind, text });
const H = (word, start, end = start + 0.3) => ({ word, start, end });

/** Whole-song guarantees every placement must keep. */
function assertSong(out, { durationSec = Infinity, locked = new Map() } = {}) {
  const all = out.flatMap((l) => l.words.map((w) => ({ ...w, id: l.id })));
  all.forEach((w, i) => {
    assert.ok(w.end > w.start, `${w.id}: end ${w.end} not after start ${w.start}`);
    assert.ok(w.start >= 0 && w.end <= durationSec, `${w.id}: ${w.start}-${w.end} outside the song`);
    if (i > 0) assert.ok(w.start > all[i - 1].start, `${w.id}: start ${w.start} not after ${all[i - 1].start}`);
  });
  out.forEach((l, i) => {
    if (out[i + 1]) assert.ok(l.words[l.words.length - 1].end <= out[i + 1].words[0].start, `${l.id} runs into ${out[i + 1].id}`);
  });
  for (const [id, lock] of locked) assert.deepEqual(out.find((l) => l.id === id).words, lock.words, `${id} moved`);
}
const lock = (...pairs) => ({ words: pairs.map(([text, start, end]) => ({ text, start, end })) });

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
  test("a repeated phrase is matched to its first occurrence", () => {
    assert.deepEqual(alignTokens(["a", "a", "b"], ["a", "b"]), [0, -1, 1]);
  });
  test("sheet words after the last heard word cost nothing", () => {
    assert.deepEqual(alignTokens(["x", "y", "x", "y"], ["x", "y"]), [0, 1, -1, -1]);
  });
  test("the last heard word keeps its match across a few missing words", () => {
    assert.deepEqual(alignTokens(["one", "two", "three", "four", "five", "six"], ["one", "six"]), [0, -1, -1, -1, -1, 1]);
  });
});

describe("placeLines", () => {
  test("heard words give their times; line spans first to last word", () => {
    const out = placeLines([L("l1", "My time no late")], [H("My", 1), H("time", 1.4), H("no", 1.8), H("late", 2.1, 2.6)]);
    const [l] = out;
    assert.deepEqual(l.words.map((w) => w.start), [1, 1.4, 1.8, 2.1]);
    assert.equal(l.start, 1);
    assert.equal(l.end, 2.6);
    assert.equal(l.confidence, 1);
    assert.equal(l.flag, null);
    assertSong(out);
  });
  test("unheard words are spread between heard neighbours and the line is flagged", () => {
    const out = placeLines([L("l1", "one two three four five")], [H("one", 10), H("five", 14)]);
    const [l] = out;
    assert.deepEqual(l.words.map((w) => w.start), [10, 11, 12, 13, 14]);
    assert.equal(l.confidence, 0.4);
    assert.equal(l.flag, "check");
    assertSong(out);
  });
  test("an interpolation gap over 3 s flags even a well-heard line", () => {
    const lines = [L("l1", "alpha beta"), L("l2", "gamma delta"), L("l3", "epsilon zeta")];
    const out = placeLines(lines, [H("alpha", 0), H("beta", 0.5), H("epsilon", 9), H("zeta", 9.5)]);
    assert.equal(out[1].flag, "check");
    assert.equal(out[0].flag, null);
    assertSong(out);
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
    assertSong(out);
  });
  test("a locked line keeps its times and anchors its neighbours", () => {
    const lines = [L("l1", "aa bb"), L("l2", "cc dd"), L("l3", "ee ff")];
    const locked = new Map([["l2", lock(["cc", 5, 5.5], ["dd", 5.5, 6])]]);
    const out = placeLines(lines, [H("aa", 1), H("bb", 1.5), H("ee", 9), H("ff", 9.5)], { locked });
    assert.deepEqual(out[1].words.map((w) => w.start), [5, 5.5]);
    assert.equal(out[1].flag, null);
    assertSong(out, { locked });
  });
  test("starts are strictly increasing even when heard times collide", () => {
    const out = placeLines([L("l1", "a b c")], [H("a", 2), H("b", 2), H("c", 2)]);
    const s = out[0].words.map((w) => w.start);
    assert.ok(s[1] > s[0] && s[2] > s[1]);
    assert.equal(out[0].flag, "check", "heard words were pushed, so the line is flagged");
    assertSong(out);
  });
  test("Yoruba typed in NFD matches NFC heard words", () => {
    const out = placeLines([L("l1", "Ọmọ mi".normalize("NFD"))], [H("Omo", 33.08), H("mi", 33.1)]);
    assert.equal(out[0].confidence, 1);
    assertSong(out);
  });
  test("a hyphenated sheet word aligns when Whisper split it in two", () => {
    const out = placeLines([L("l1", "Eh-yeah, my time")], [H("Eh", 5), H("yeah", 5.3), H("my", 5.8), H("time", 6.1)]);
    const [l] = out;
    assert.equal(l.confidence, 1);
    assert.equal(l.flag, null);
    assert.deepEqual(l.words.map((w) => w.text), ["Eh-yeah,", "my", "time"]);
    assert.deepEqual(l.words.map((w) => w.start), [5, 5.8, 6.1]);
    assertSong(out);
  });
  test("a hyphenated sheet word merged by Whisper is interpolated, not mis-timed", () => {
    const out = placeLines([L("l1", "Eh-yeah, my time")], [H("Ehyeah", 5, 5.6), H("my", 5.8), H("time", 6.1)]);
    assert.deepEqual(out[0].words.map((w) => w.text), ["Eh-yeah,", "my", "time"]);
    assert.ok(out[0].words[0].start < out[0].words[1].start);
    assertSong(out);
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
    assertSong(out, { durationSec: 250 });
  });
});

describe("placeLines: locked lines are fixed anchors", () => {
  const lines = [L("l1", "aa bb"), L("l2", "cc dd"), L("l3", "ee ff")];
  const locked = new Map([["l2", lock(["cc", 5, 5.5], ["dd", 5.5, 6])]]);

  test("A: a heard word that lands inside the lock cannot move it", () => {
    const out = placeLines(lines, [H("aa", 1), H("bb", 6), H("ee", 9), H("ff", 9.5)], { locked });
    assertSong(out, { locked });
    assert.ok(out[0].words[1].start < 5, "the stray word is placed before the lock");
    assert.equal(out[0].flag, "check");
  });
  test("B: words heard before the lock cannot be given to a line after it", () => {
    const out = placeLines(lines, [H("aa", 1), H("bb", 1.5), H("ee", 3), H("ff", 3.5)], { locked });
    assertSong(out, { locked });
    assert.ok(out[2].start >= 6, "l3 follows the lock");
    assert.equal(out[2].confidence, 0);
    assert.equal(out[2].flag, "check");
  });
  test("unheard words next to a lock are spread from the lock's end", () => {
    const l = [L("l1", "aa bb cc"), L("l2", "dd ee"), L("l3", "ff gg")];
    const lk = new Map([["l2", lock(["dd", 5, 5.5], ["ee", 5.5, 6])]]);
    const out = placeLines(l, [H("aa", 1), H("gg", 9.5)], { locked: lk });
    assertSong(out, { locked: lk });
    assert.ok(out[2].words[0].start > 6);
  });
  test("a lock whose words differ from the sheet is still reproduced exactly", () => {
    const lk = new Map([["l2", lock(["c-c!", 5.123, 5.5], ["DD", 5.5, 6.789])]]);
    assertSong(placeLines(lines, [], { locked: lk, durationSec: 60 }), { durationSec: 60, locked: lk });
  });
});

describe("placeLines: repeated phrases", () => {
  test("C: a chorus heard once goes to its first occurrence", () => {
    const v1 = "walking down the road today";
    const c = "who talk say i no go shine";
    const lines = [L("v1", v1), L("c1", c), L("v2", "morning comes and evening goes"), L("c2", c), L("c3", c)];
    const heard = [];
    let t = 10;
    for (const w of `${v1} ${c}`.split(" ")) { heard.push(H(w, t)); t += 0.4; }
    const out = placeLines(lines, heard, { durationSec: 120 });
    assert.equal(out[1].confidence, 1);
    assert.equal(out[3].confidence, 0);
    assert.equal(out[4].confidence, 0);
    assertSong(out, { durationSec: 120 });
  });
  test("D: a word sung once belongs to the lead, not its echo response", () => {
    const lines = [L("l1", "hallelujah"), L("r", "(hallelujah)", "response"), L("l3", "praise him")];
    const out = placeLines(lines, [H("hallelujah", 1, 1.8), H("praise", 2.5), H("him", 2.9)]);
    assert.equal(out[0].confidence, 1);
    assert.equal(out[0].flag, null);
    assert.equal(out[1].confidence, 0);
    assert.equal(out[1].flag, "check");
    assert.ok(out[1].start > out[0].end);
    assertSong(out);
  });
});

describe("placeLines: order, flags and the song's edges", () => {
  test("E: squeezed lines are flagged; a heard word is not silently moved", () => {
    const out = placeLines([L("l1", "a b c d e f g h i j k")], [H("a", 0), H("k", 0.3)]);
    assertSong(out);
    assert.equal(out[0].flag, "check");
  });
  test("a heard word pushed more than 0.1 s flags its line", () => {
    const out = placeLines([L("l1", "a b c d")], [H("a", 1), H("b", 1.01), H("c", 1.02), H("d", 1.03)]);
    assertSong(out);
    assert.equal(out[0].flag, "check");
  });
  test("a heard last word that runs into the next line flags the line", () => {
    const out = placeLines([L("l1", "one two"), L("l2", "three four")], [H("one", 1), H("two", 1.5, 3.4), H("three", 3, 3.3), H("four", 3.5)]);
    assertSong(out);
    assert.equal(out[0].flag, "check");
  });
  test("F: an unheard response is squeezed into a tight gap and stays in order", () => {
    const lines = [L("l1", "shine bright"), L("r", "(oh oh oh)", "response"), L("l3", "joy no mine")];
    const out = placeLines(lines, [H("shine", 1), H("bright", 1.5, 1.9), H("joy", 2.2), H("no", 2.5), H("mine", 2.8)]);
    assertSong(out);
    assert.ok(out[1].start >= 1.9 && out[1].end <= 2.2);
    assert.equal(out[1].flag, "check");
  });
  test("a roomy gap keeps the full response timing (0.2 s after, 0.25 s per word, min 0.7 s)", () => {
    const lines = [L("l1", "shine bright"), L("r", "(oh oh oh oh oh)", "response"), L("r2", "(yeah)", "response"), L("l3", "joy")];
    const out = placeLines(lines, [H("shine", 1), H("bright", 1.5, 1.9), H("joy", 9)]);
    assertSong(out);
    assert.equal(out[1].start, 2.1);
    assert.equal(out[1].end, 3.35);
    assert.equal(out[2].start, 3.55);
    assert.equal(out[2].end, 4.25);
  });
  test("a response at the very start or end of the song stays inside it", () => {
    const first = placeLines([L("r", "(oh)", "response"), L("l1", "joy")], [H("joy", 0.5)], { durationSec: 5 });
    assertSong(first, { durationSec: 5 });
    const last = placeLines([L("l1", "shine bright today"), L("r", "(oh oh)", "response")], [H("shine", 1), H("bright", 1.5)], { durationSec: 2.2 });
    assertSong(last, { durationSec: 2.2 });
  });
  test("nothing is placed after the song's end", () => {
    const out = placeLines([L("l1", "a b c d e f g h")], [H("a", 9.9)], { durationSec: 10 });
    assertSong(out, { durationSec: 10 });
  });
  test("with nothing heard, lines are still ordered inside the song", () => {
    const out = placeLines([L("a", "one two"), L("b", "three four"), L("c", "five six")], [], { durationSec: 60 });
    assertSong(out, { durationSec: 60 });
    out.forEach((l) => assert.equal(l.flag, "check"));
  });
  test("heard words that end before they start, or run out of order, still place cleanly", () => {
    assertSong(placeLines([L("l1", "x y z w")], [H("x", 1, 0.9), H("y", 1.2, 1.2), H("z", 1.5, 1.4), H("w", 2, 1.9)]));
    assertSong(placeLines([L("l1", "one two three"), L("l2", "four five six")], [H("four", 1), H("five", 1.3), H("six", 1.6), H("one", 3), H("two", 3.3), H("three", 3.6)]));
  });
});


describe("placeLines: the audible end bounds placement", () => {
  // Heard up to about 10 s; the music stops at 12 s; the file runs to 30 s.
  const outro = ["going home today", "the driver knows the way", "no more crying there", "we shall rest at last", "going home going home"];
  const lines = [L("l1", "i know the driver"), L("l2", "he will carry me"), ...outro.map((t, i) => L(`o${i + 1}`, t))];
  const heard = [H("i", 6), H("know", 6.4), H("the", 6.8), H("driver", 7.2), H("he", 8.4), H("will", 8.8), H("carry", 9.2), H("me", 9.6)];

  test("unheard tail lines end by the audible end and are flagged", () => {
    const out = placeLines(lines, heard, { durationSec: 30, audibleEnd: 12 });
    assertSong(out, { durationSec: 12 });
    for (const l of out.slice(2)) {
      assert.equal(l.confidence, 0);
      assert.equal(l.flag, "check");
    }
    assert.equal(out[0].start, 6, "heard lines keep their times");
    assert.equal(out[1].start, 8.4);
  });
  test("without an audible end, the song's length is the bound (as before)", () => {
    const out = placeLines(lines, heard, { durationSec: 30 });
    assertSong(out, { durationSec: 30 });
    assert.ok(out[out.length - 1].end > 12, "the tail ran past 12 s before the fix");
  });
  test("an audible end past the song's length is held to the song", () => {
    assertSong(placeLines(lines, heard, { durationSec: 11, audibleEnd: 40 }), { durationSec: 11 });
  });
  test("a heard word in the silence is pulled inside and its line flagged", () => {
    const out = placeLines([L("l1", "aa bb"), L("l2", "cc dd")], [H("aa", 1), H("bb", 1.5), H("cc", 13), H("dd", 13.5)], { durationSec: 30, audibleEnd: 12 });
    assertSong(out, { durationSec: 12 });
    assert.equal(out[1].flag, "check");
  });
  test("an unheard response at the tail stays inside the audible end", () => {
    const out = placeLines([L("l1", "shine bright today"), L("r", "(oh oh)", "response")], [H("shine", 1), H("bright", 1.5)], { durationSec: 30, audibleEnd: 2.2 });
    assertSong(out, { durationSec: 2.2 });
  });
  test("a tail response after a call squeezed up to the audible end still ends in time", () => {
    const out = placeLines([L("l1", "a b c d e f g h i j k l m n o p"), L("r", "(oh oh oh)", "response")], [H("a", 9.5)], { durationSec: 30, audibleEnd: 10 });
    assertSong(out, { durationSec: 10 });
    assert.equal(out[1].flag, "check");
  });
  test("a lock after the audible end is kept exactly; the lines around it stay in order", () => {
    const lk = new Map([["o3", lock(["no", 20, 20.4], ["more", 20.4, 20.8], ["crying", 20.8, 21.3], ["there", 21.3, 22])]]);
    const out = placeLines(lines, heard, { locked: lk, durationSec: 30, audibleEnd: 12 });
    assertSong(out, { durationSec: 30, locked: lk });
    assert.ok(out[3].end <= 12, `the lines before the lock end by the audible end (${out[3].end})`);
    assert.ok(out[5].start >= 22, "the lines after the lock follow it");
    assert.equal(out[4].confidence, 1);
    assert.equal(out[4].flag, null);
  });
  test("a lock at the very end of the song does not reorder the lines after it", () => {
    const lk = new Map([["o4", lock(["we", 29.5, 29.6], ["shall", 29.6, 29.7], ["rest", 29.7, 29.8], ["at", 29.8, 29.9], ["last", 29.9, 30])]]);
    const out = placeLines(lines, heard, { locked: lk, durationSec: 30, audibleEnd: 12 });
    const starts = out.flatMap((l) => l.words.map((w) => w.start));
    starts.forEach((s, i) => { if (i > 0) assert.ok(s > starts[i - 1], `start ${s} not after ${starts[i - 1]}`); });
    assert.deepEqual(out[5].words, lk.get("o4").words);
    assert.ok(out[6].start > 29.9, "the line after the lock follows it");
  });
});
