import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { referenceOfLine, wordsToNumber } from "./reference.js";

describe("wordsToNumber", () => {
  test("reads digits and number words", () => {
    assert.equal(wordsToNumber("15"), 15);
    assert.equal(wordsToNumber("fifteen"), 15);
    assert.equal(wordsToNumber("twenty-three"), 23);
    assert.equal(wordsToNumber("one hundred and nineteen"), 119);
  });

  test("refuses words that are not numbers", () => {
    assert.equal(wordsToNumber("grace"), null);
    assert.equal(wordsToNumber(""), null);
  });
});

describe("referenceOfLine", () => {
  test("reads a spoken reference", () => {
    const ref = referenceOfLine("**First Corinthians, chapter fifteen, verse ten.**");
    assert.equal(ref.canonical, "1 Corinthians 15:10");
  });

  test("reads a printed reference", () => {
    assert.equal(referenceOfLine("1 Corinthians 15:10").canonical, "1 Corinthians 15:10");
    assert.equal(referenceOfLine("John 3:16-17.").canonical, "John 3:16-17");
  });

  test("reads a verse range and a whole chapter", () => {
    assert.equal(referenceOfLine("Romans, chapter eight, verses twenty-eight to thirty").canonical, "Romans 8:28-30");
    assert.equal(referenceOfLine("Psalm, chapter twenty-three").canonical, "Psalms 23");
  });

  test("leaves narration alone", () => {
    assert.equal(referenceOfLine("The Apostle Paul declared:"), null);
    assert.equal(referenceOfLine("At 0:12 the music rises"), null);
    assert.equal(referenceOfLine("Paul wrote in First Corinthians chapter fifteen that grace is enough"), null);
  });
});
