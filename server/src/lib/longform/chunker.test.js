import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitForProvider } from "./chunker.js";

describe("splitForProvider", () => {
  test("returns one chunk when the text fits", () => {
    assert.deepEqual(splitForProvider("Rest now. You are held.", 100), ["Rest now. You are held."]);
  });
  test("splits at sentence boundaries under the limit", () => {
    const out = splitForProvider("One two three. Four five six. Seven eight nine.", 30);
    assert.deepEqual(out, ["One two three. Four five six.", "Seven eight nine."]);
    for (const c of out) assert.ok(c.length <= 30);
  });
  test("splits a single over-long sentence at a space, never mid-word", () => {
    const out = splitForProvider("alpha beta gamma delta epsilon", 12);
    assert.deepEqual(out, ["alpha beta", "gamma delta", "epsilon"]);
  });
  test("collapses whitespace and drops empty pieces", () => {
    assert.deepEqual(splitForProvider("  A.   \n\n  B.  ", 100), ["A. B."]);
    assert.deepEqual(splitForProvider("   ", 100), []);
  });
  test("round-trips: joined chunks equal the normalised input", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = splitForProvider(text, 90);
    assert.equal(out.join(" "), text);
  });
  test("negative maxChars falls back to default limit and completes promptly", () => {
    const out = splitForProvider("a b c", -5);
    assert.deepEqual(out, ["a b c"]);
  });
  test("NaN maxChars falls back to default limit and completes promptly", () => {
    const out = splitForProvider("a b c", NaN);
    assert.deepEqual(out, ["a b c"]);
  });
});
