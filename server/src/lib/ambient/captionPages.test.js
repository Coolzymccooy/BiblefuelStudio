import test from "node:test";
import assert from "node:assert/strict";
import { captionPages, balanceLines, pageWindows } from "./captionPages.js";

const words = (s) => String(s).split(/\s+/).filter(Boolean).join(" ");

const PHIL_6 = "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.";
const PHIL_7 = "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.";

test("a passage shows one verse at a time when the verses are known", () => {
  const pages = captionPages({ verses: [PHIL_6, PHIL_7], text: `${PHIL_6} ${PHIL_7}` }, 134);
  assert.deepEqual(pages, [PHIL_6, PHIL_7]);
});

test("an older drop with only joined text splits at sentence ends", () => {
  const pages = captionPages({ text: `${PHIL_6} ${PHIL_7}` }, 134);
  assert.deepEqual(pages, [PHIL_6, PHIL_7]);
});

test("a verse too long for one page breaks at a clause, never mid-phrase", () => {
  const long = "Come unto me, all ye that labour and are heavy laden, and I will give you rest; "
    + "take my yoke upon you, and learn of me; for I am meek and lowly in heart.";
  const pages = captionPages({ text: long }, 90);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((p) => p.length <= 90), JSON.stringify(pages));
  assert.ok(pages.slice(0, -1).every((p) => /[;:,.?!]$/.test(p)), `each break is at punctuation: ${JSON.stringify(pages)}`);
});

test("paging never changes, drops or reorders a word of scripture", () => {
  const text = `${PHIL_6} ${PHIL_7} ${"and word ".repeat(40).trim()}`;
  for (const max of [40, 84, 134]) {
    const pages = captionPages({ text }, max);
    assert.equal(words(pages.join(" ")), words(text), `max ${max}`);
    assert.ok(pages.every((p) => p.length <= max), `max ${max}: ${JSON.stringify(pages)}`);
  }
});

test("verses beat the joined text when both are present, but must still say the same words", () => {
  // A drop whose verses don't match its text (edited elsewhere) falls back to
  // the text rather than burning words that were never spoken.
  const pages = captionPages({ verses: ["Jesus wept."], text: PHIL_6 }, 134);
  assert.deepEqual(pages, [PHIL_6]);
});

test("balanceLines keeps a page to two even lines", () => {
  assert.deepEqual(balanceLines("The LORD is my shepherd; I shall not want.", 70), ["The LORD is my shepherd; I shall not want."]);
  const lines = balanceLines(PHIL_6, 70);
  assert.equal(lines.length, 2);
  assert.equal(words(lines.join(" ")), words(PHIL_6));
  assert.ok(Math.abs(lines[0].length - lines[1].length) < 20, JSON.stringify(lines));
  assert.ok(lines.every((l) => l.length <= 70));
});

test("page windows share the span by length, back to back, covering it exactly", () => {
  const w = pageWindows(0, 300, ["short one.", "a much longer second page of scripture text here."]);
  assert.equal(w.length, 2);
  assert.equal(w[0].start, 0);
  assert.equal(w[1].end, 300);
  assert.equal(w[0].end, w[1].start);
  assert.ok(w[1].end - w[1].start > w[0].end - w[0].start, "the longer page stays up longer");
});

test("a very short page still gets a readable share", () => {
  const w = pageWindows(0, 20, ["Jesus wept.", "x ".repeat(200)]);
  assert.ok(w[0].end - w[0].start >= 4, JSON.stringify(w));
});

test("while spoken, pages follow the voice: no minimum pulls them out of step", () => {
  // Psalm 23:1-3 over 15 s: a 4 s floor held page one after its words were said.
  const pages = ["x".repeat(42), "x".repeat(82), "x".repeat(86)];
  const w = pageWindows(0, 15, pages, { minSec: 0 });
  const share = (i) => w[i].end - w[i].start;
  assert.ok(Math.abs(share(0) - 15 * (42 / 210)) < 0.01, JSON.stringify(w));
});
