// server/src/lib/lyricVideo/passQuality.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { trimLoops, rejectPass, promptFor, expectedFrom } from "./passQuality.js";

const W = (text, t0 = 0) => text.split(" ").map((w, i) => ({ word: w, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25 }));

describe("trimLoops", () => {
  test("cuts at a 3-word phrase repeated six times", () => {
    const words = [...W("see as the table"), ...W(Array(8).fill("who talk say").join(" "), 2)];
    const out = trimLoops(words);
    assert.deepEqual(out.map((w) => w.word), ["see", "as", "the", "table"]);
  });
  test("cuts at a single word repeated six times", () => {
    assert.equal(trimLoops(W("my love smoke smoke smoke smoke smoke smoke smoke")).length, 2);
  });
  test("keeps 'dance, dance, dance' and two repeats of a hook", () => {
    assert.equal(trimLoops(W("oya dance dance dance who talk say who talk say")).length, 10);
  });
  test("drops hallucinated sign-offs and music notes", () => {
    assert.deepEqual(trimLoops(W("eh yeah ♪ thanks for watching")).map((w) => w.word), ["eh", "yeah"]);
  });
});

describe("rejectPass", () => {
  const expected = new Set(["from", "lagos", "traffic", "to", "the", "london", "rain"]);
  test("accepts a pass that hears the expected words", () => {
    assert.equal(rejectPass(W("from lagos traffic to the london rain"), expected), null);
  });
  test("rejects empty, music-only and off-lyric passes", () => {
    assert.match(rejectPass([], expected), /nothing/);
    assert.match(rejectPass(W("♪ ♪"), expected), /nothing/);
    assert.match(rejectPass(W("subscribe now please like share"), expected), /lyrics/);
  });
  test("everyday words alone are no evidence of the lyrics", () => {
    const lyric = new Set(["dem", "say", "make", "i", "calm", "down", "no", "wahala", "you", "to", "the", "know", "what"]);
    assert.match(rejectPass(W("I don't know what to say I don't know what to do"), lyric), /lyrics/);
    assert.match(rejectPass(W("you you you know what I mean"), lyric), /lyrics/);
    assert.equal(rejectPass(W("eh yeah dem say make I calm down"), lyric), null);
  });
  test("plain-English lyrics count through the word pairs they share with the sheet", () => {
    const lines = [{ text: "You are here with me" }, { text: "In the night you are my light" }, { text: "Here I am, here I am" }];
    const exp = expectedFrom(lines);
    assert.equal(rejectPass(W("You are here with me In the night you are my light"), exp), null);
    assert.equal(rejectPass(W("Here I am here I am"), exp), null);
    assert.equal(rejectPass(W("oh yeah you are here with me oh yeah"), exp), null);
    assert.match(rejectPass(W("I don't know what to say I don't know what to do"), exp), /lyrics/);
    assert.match(rejectPass(W("Thank you so much for watching and I will see you in the next video"), exp), /lyrics/);
  });
  test("expectedFrom pairs words across a line break too", () => {
    const exp = expectedFrom([{ text: "Eh-yeah, eh-yeah!" }, { text: "Dem say" }]);
    assert.ok(exp.words.has("dem") && exp.pairs.has("eh yeah") && exp.pairs.has("yeah dem"));
  });
  test("rejects times that go backwards", () => {
    const words = W("from lagos traffic");
    words[2].start = 0;
    assert.match(rejectPass(words, expected), /order/);
  });
});

describe("promptFor", () => {
  test("joins lines and stops at a line boundary under the cap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ text: `line number ${i} goes here` }));
    const p = promptFor(lines, 100);
    assert.ok(p.length <= 100);
    assert.ok(p.endsWith("goes here"));
  });
});
