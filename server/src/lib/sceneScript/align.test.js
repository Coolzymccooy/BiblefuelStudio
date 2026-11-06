import { test } from "node:test";
import assert from "node:assert/strict";
import { alignCaption, alignWords, spreadWords } from "./align.js";
import { speakableText } from "./speech.js";

const h = (text, start, end) => ({ text, start, end });
const provenance = (r) => r.timing.tokens.map((t) => t.provenance);
const warning = (r, code) => r.timing.warnings.some((w) => w.code === code);
function bounded(result, duration) {
  let end = 0;
  for (const word of result.words) {
    assert.ok(Number.isFinite(word.start) && Number.isFinite(word.end));
    assert.ok(word.start >= end && word.end >= word.start && word.end <= duration);
    end = word.end;
    assert.deepEqual(Object.keys(word), ["text", "start", "end"]);
  }
}

test("Grace saves us: sparse missing word never moves Grace at 1 or us at 4", () => {
  const text = "Grace saves us";
  const r = alignCaption(text, [h("Grace", 1, 1.4), h("us", 4, 4.3)], 5);
  assert.deepEqual(r.words, [h("Grace", 1, 1.4), h("saves", 1.4, 1.4), h("us", 4, 4.3)]);
  assert.deepEqual(provenance(r), ["native", "unresolved", "native"]);
  assert.equal(r.timing.text, text);
  assert.equal(r.timing.quality, "unresolved");
  bounded(r, 5);
});

test("one short bracketed omission is explicitly estimated, not measured", () => {
  const r = alignCaption("Grace saves us", [h("Grace", 1, 1.4), h("us", 2, 2.3)], 3);
  assert.deepEqual(r.words, [h("Grace", 1, 1.4), h("saves", 1.4, 2), h("us", 2, 2.3)]);
  assert.deepEqual(provenance(r), ["native", "estimated", "native"]);
  assert.equal(r.timing.quality, "estimated");
  assert.ok(warning(r, "estimated"));
  assert.equal(r.timing.tokens[1].sourceIndices, undefined);
});

test("Psalm 23 maps known spoken number without replacing authoritative text", () => {
  const r = alignCaption("Psalm 23", [h("Psalm", 0.1, 0.5), h("twenty", 0.8, 1), h("three", 1, 1.3)], 1.3, { kind: "reference" });
  assert.deepEqual(r.words, [h("Psalm", 0.1, 0.5), h("23", 0.8, 1.3)]);
  assert.deepEqual(provenance(r), ["native", "reference-native"]);
  assert.ok(warning(r, "reference-boundary-variant"));
  assert.equal(r.timing.quality, "unresolved");
  assert.deepEqual(r.timing.tokens[1].sourceIndices, [1, 2]);
});

test("actual SSML reference expansions map chapter, ordinal, verse and range", () => {
  for (const text of ["Psalm 23", "1 Corinthians 15:10", "John 3:16-18", "Song of Solomon 2:1"]) {
    const spoken = speakableText({ text, kind: "reference" }).split(/\s+/);
    const heard = spoken.map((text, i) => h(text, i, i + 0.5));
    const r = alignCaption(text, heard, spoken.length, { kind: "reference" });
    assert.equal(r.timing.quality, "native", `${text}: ${JSON.stringify(r.timing)}`);
    assert.deepEqual(r.words.map((w) => w.text), text.split(/\s+/));
    assert.equal(r.words.at(-1).end, heard.at(-1).end);
    bounded(r, spoken.length);
  }
});

test("no unsupported numeric narration or alias expansion is invented", () => {
  for (const [text, kind] of [["Psalm 23", "narration"], ["Ps 23", "reference"], ["Read Psalm 23", "reference"]]) {
    const r = alignCaption(text, [h("Psalm", 0, 0.3), h("twenty", 0.4, 0.6), h("three", 0.7, 1)], 1, { kind });
    assert.equal(r.timing.quality, "unresolved");
    assert.equal(r.timing.tokens.at(-1).provenance, "unresolved");
  }
});

test("missing reference number parts stay unresolved, book anchor survives", () => {
  const r = alignCaption("Psalm 23", [h("Psalm", 0.1, 0.4), h("twenty", 0.5, 0.8)], 1, { kind: "reference" });
  assert.deepEqual(r.words[0], h("Psalm", 0.1, 0.4));
  assert.equal(r.timing.tokens[1].provenance, "unresolved");
  assert.ok(warning(r, "unmatched-boundary"));
});

test("complete repeated words remain in order; ambiguous missing repeat is not guessed", () => {
  const heard = [h("Grace", 0.1, 0.3), h("grace", 0.4, 0.6), h("saves", 0.8, 1)];
  assert.deepEqual(alignWords("Grace grace saves", heard, 1), heard);
  const r = alignCaption("Grace grace saves", [heard[0], heard[2]], 1);
  assert.deepEqual(provenance(r), ["unresolved", "unresolved", "native"]);
  assert.deepEqual(r.words[2], heard[2]);
  assert.equal(r.timing.tokens[0].reason, "ambiguous-match");
  bounded(r, 1);
});

test("Unicode, combining accents, curly punctuation and split words preserve author tokens", () => {
  const text = "Élan — don’t self-made 世界 мир!";
  const heard = [h("E\u0301lan", 0, 0.2), h("don't", 0.3, 0.5), h("self", 0.6, 0.7), h("made", 0.8, 0.9), h("世界", 1, 1.2), h("мир", 1.3, 1.5)];
  const r = alignCaption(text, heard, 1.5);
  assert.equal(r.timing.quality, "native");
  assert.deepEqual(r.words.map((w) => w.text), text.split(/\s+/));
  assert.equal(r.timing.tokens[1].provenance, "nonspoken");
  assert.deepEqual(r.words[3], h("self-made", 0.6, 0.9));
  bounded(r, 1.5);
});

test("punctuation next to an estimate does not reorder timings", () => {
  const r = alignCaption("Grace saves — us", [h("Grace", 0.1, 0.3), h("us", 0.8, 1)], 1);
  assert.equal(r.timing.tokens[1].provenance, "estimated");
  bounded(r, 1);
});

test("no boundaries and whole missing content report zero-width unresolved words", () => {
  for (const heard of [[], undefined, {}, [h("unrelated", 0, 1)]]) {
    const r = alignCaption("  Grace\n saves us!  ", heard, 2);
    assert.equal(r.timing.quality, "unresolved");
    assert.ok(r.words.every((w) => w.start === 0 && w.end === 0));
    assert.equal(r.timing.text, "  Grace\n saves us!  ");
    assert.ok(provenance(r).every((p) => p === "unresolved"));
  }
});

test("leading/trailing omissions and multi-word gaps do not acquire invented spans", () => {
  for (const [text, heard] of [
    ["Grace saves us", [h("saves", 1, 1.3)]],
    ["Grace truly always saves us", [h("Grace", 0.1, 0.3), h("us", 1, 1.2)]],
  ]) {
    const r = alignCaption(text, heard, 2);
    assert.ok(!provenance(r).includes("estimated"));
    assert.ok(r.timing.tokens.filter((t) => t.provenance === "unresolved").every((t) => t.start === t.end));
    bounded(r, 2);
  }
});

test("extra/substituted provider content is reported, not used as an estimate", () => {
  const r = alignCaption("Grace saves us", [h("Grace", 0.1, 0.3), h("rejects", 0.4, 0.6), h("us", 0.8, 1)], 1);
  assert.equal(r.timing.tokens[1].provenance, "unresolved");
  assert.ok(warning(r, "unmatched-boundary"));
  assert.deepEqual(r.words[2], h("us", 0.8, 1));
});

test("malformed native structure, ordering, overlaps and local bounds are rejected", () => {
  const invalid = [null, {}, h("bad", "0", 0.2), h("bad", NaN, 0.2), h("bad", 0, Infinity), h("bad", -0.1, 0.1), h("bad", 0.3, 0.3), h("bad", 1, 0.5), h("bad", 1, 2.1)];
  for (const bad of invalid) {
    const r = alignCaption("Grace us", [bad, h("Grace", 0.5, 0.8), h("us", 1, 2)], 2);
    assert.ok(warning(r, "invalid-boundary"));
    assert.deepEqual(r.words, [h("Grace", 0.5, 0.8), h("us", 1, 2)]);
    bounded(r, 2);
  }
  for (const bad of [h("saves", 0.1, 0.2), h("saves", 0.7, 1.1)]) {
    const r = alignCaption("Grace saves us", [h("Grace", 0.5, 0.8), bad, h("us", 1.2, 2)], 2);
    assert.ok(warning(r, "invalid-boundary"));
    assert.deepEqual(r.words.at(-1), h("us", 1.2, 2));
    bounded(r, 2);
  }
});

test("source-end anchor is exact, no rounding beyond duration or trailing padding", () => {
  const duration = 1.23456;
  const r = alignCaption("Grace us", [h("Grace", 0.12345, 0.5), h("us", 1, duration)], duration);
  assert.equal(r.words.at(-1).end, duration);
  bounded(r, duration);
  for (const invalidDuration of [0, -1, NaN, Infinity, "2"]) {
    const bad = alignCaption("Grace", [h("Grace", 0, 1)], invalidDuration);
    assert.equal(bad.timing.quality, "unresolved");
    assert.ok(warning(bad, "invalid-duration"));
    bounded(bad, 0);
  }
  bounded({ words: spreadWords("a b c", 0.01) }, 0.01);
});

test("bounded workload reports unresolved rather than fabricating a long transcript", () => {
  const r = alignCaption(Array(501).fill("Grace").join(" "), [], 2);
  assert.equal(r.words.length, 501);
  assert.equal(r.timing.quality, "unresolved");
  assert.ok(warning(r, "alignment-size-limit"));
});
