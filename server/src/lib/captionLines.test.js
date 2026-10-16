import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitCaptionLines } from "./captionLines.js";

describe("splitCaptionLines", () => {
  test("short lines pass through untouched", () => {
    assert.deepEqual(splitCaptionLines(["Part 1 of 2", "Read on YouVersion"], 140), ["Part 1 of 2", "Read on YouVersion"]);
  });

  test("a long verse becomes sentence-sized lines, none longer than the limit, nothing lost", () => {
    const verse = "My little children, these things write I unto you, that ye sin not. And if any man sin, we have an advocate with the Father, Jesus Christ the righteous: And he is the propitiation for our sins: and not for ours only, but also for the sins of the whole world.";
    const lines = splitCaptionLines([verse], 140);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 140, `"${line}" is ${line.length}`);
    assert.equal(lines.join(" "), verse);
    assert.equal(lines[0], "My little children, these things write I unto you, that ye sin not.");
  });

  test("one sentence longer than the limit breaks between words", () => {
    const sentence = `${"word ".repeat(60).trim()}.`;
    const lines = splitCaptionLines([sentence], 100);
    for (const line of lines) assert.ok(line.length <= 100);
    assert.equal(lines.join(" "), sentence);
  });

  test("drops empty lines", () => {
    assert.deepEqual(splitCaptionLines(["", "  ", "Amen."], 140), ["Amen."]);
  });
});
