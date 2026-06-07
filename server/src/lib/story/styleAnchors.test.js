import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STYLE_ANCHORS, anchorFor, listStyles } from "./styleAnchors.js";

describe("styleAnchors", () => {
  test("has the 4 v1 styles", () => {
    assert.deepEqual(
      listStyles().sort(),
      ["ancient-scripture", "cinematic-bible", "heavenly-atmosphere", "modern-devotional"],
    );
  });

  test("anchorFor returns the style's suffix", () => {
    assert.ok(anchorFor("cinematic-bible").includes("cinematic"));
  });

  test("anchorFor falls back to cinematic-bible for an unknown style", () => {
    assert.equal(anchorFor("nonsense"), STYLE_ANCHORS["cinematic-bible"]);
  });
});
