/**
 * Unit tests for extractSpeakableVerseText.
 * Run with: node --test server/src/lib/series/speakable.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractSpeakableVerseText } from "./speakable.js";

const v = (n, text) => ({ verse: n, text });

describe("extractSpeakableVerseText", () => {
  test("returns empty string for empty/null input", () => {
    assert.equal(extractSpeakableVerseText([], 280), "");
    assert.equal(extractSpeakableVerseText(null, 280), "");
    assert.equal(extractSpeakableVerseText(undefined, 280), "");
  });

  test("returns the only verse when it fits", () => {
    const result = extractSpeakableVerseText([v(16, "For God so loved the world.")], 280);
    assert.equal(result, "For God so loved the world.");
  });

  test("concatenates whole verses while fitting", () => {
    const verses = [
      v(1, "There was a man of the Pharisees, named Nicodemus."),
      v(2, "The same came to Jesus by night."),
    ];
    const result = extractSpeakableVerseText(verses, 280);
    assert.equal(
      result,
      "There was a man of the Pharisees, named Nicodemus. The same came to Jesus by night.",
    );
  });

  test("stops before the verse that would overflow", () => {
    const verses = [
      v(1, "Short verse one."),
      v(2, "x".repeat(300)), // would overflow
    ];
    const result = extractSpeakableVerseText(verses, 50);
    // Keeps verse 1 only; verse 2 is dropped without an ellipsis (we have whole verses).
    assert.equal(result, "Short verse one.");
  });

  test("trims a single overlong verse at a word boundary with ellipsis", () => {
    const long = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
    const result = extractSpeakableVerseText([v(1, long)], 60);
    assert.ok(result.endsWith("…"), `expected ellipsis: ${result}`);
    assert.ok(result.length <= 61, `expected <= 61 chars, got ${result.length}`);
    assert.ok(!result.slice(0, -1).endsWith(" "), `unexpected trailing space before ellipsis: ${result}`);
    // No truncation mid-word.
    const beforeEllipsis = result.slice(0, -1).trim();
    assert.ok(long.startsWith(beforeEllipsis), `should be a prefix of the source: ${beforeEllipsis}`);
  });

  test("collapses internal whitespace", () => {
    const result = extractSpeakableVerseText([v(1, "Multiple   spaces\n\nand\tlines.")], 280);
    assert.equal(result, "Multiple spaces and lines.");
  });

  test("ignores empty verses in the middle", () => {
    const result = extractSpeakableVerseText(
      [v(1, "First."), v(2, ""), v(3, "Third.")],
      280,
    );
    assert.equal(result, "First. Third.");
  });

  test("clamps a too-small maxChars to a sane floor", () => {
    // maxChars=10 is below the floor (40); should still produce useful output.
    const result = extractSpeakableVerseText([v(1, "For God so loved the world.")], 10);
    assert.ok(result.length > 0);
  });
});
