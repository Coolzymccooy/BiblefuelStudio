import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { wordsFromSections, chaptersFromSections } from "./sectionTimings.js";

const sections = [
  { heading: "Welcome", text: "rest now friend", startMs: 0, endMs: 3000 },
  { heading: "Psalm 23", text: "the lord is my shepherd", startMs: 8000, endMs: 18000 },
];

describe("wordsFromSections", () => {
  test("spreads each section's words across its own window", () => {
    const words = wordsFromSections(sections);
    assert.equal(words.length, 8);
    assert.deepEqual(words[0], { text: "rest", startMs: 0, endMs: 1000 });
    assert.deepEqual(words[2], { text: "friend", startMs: 2000, endMs: 3000 });
    assert.equal(words[3].startMs, 8000);
    assert.equal(words[7].endMs, 18000);
  });
  test("is monotonic and never overlaps", () => {
    const words = wordsFromSections(sections);
    for (let i = 1; i < words.length; i++) assert.ok(words[i].startMs >= words[i - 1].endMs);
  });
  test("skips sections without text", () => {
    assert.deepEqual(wordsFromSections([{ heading: "x", text: "  ", startMs: 0, endMs: 5 }]), []);
  });
});

describe("chaptersFromSections", () => {
  test("maps heading and start", () => {
    assert.deepEqual(chaptersFromSections(sections), [{ startMs: 0, title: "Welcome" }, { startMs: 8000, title: "Psalm 23" }]);
  });
  test("a continuation section (after a [pause]) does not start a new chapter", () => {
    const withCont = [...sections, { heading: "Psalm 23", text: "again", startMs: 20000, endMs: 24000, continuation: true }];
    assert.deepEqual(chaptersFromSections(withCont), [{ startMs: 0, title: "Welcome" }, { startMs: 8000, title: "Psalm 23" }]);
  });
});
