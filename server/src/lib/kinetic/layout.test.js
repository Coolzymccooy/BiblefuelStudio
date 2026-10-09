import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectOf, slotsFor, maxWidthFor, clampBlockY } from "./layout.js";

test("aspect follows the frame", () => {
  assert.equal(aspectOf(1280, 720), "wide");
  assert.equal(aspectOf(720, 1280), "tall");
});

test("tall slots keep clear of the TikTok/Reels controls", () => {
  for (const s of slotsFor("tall")) {
    assert.ok(s.y <= 0.70, `slot y ${s.y}`);
    const half = maxWidthFor(s, 720, "tall") / 2;
    assert.ok(s.x * 720 + half <= 720 * 0.88 + 1, "clear of the right 12%");
    assert.ok(s.x * 720 - half >= 720 * 0.06 - 1, "inside the left margin");
  }
});

test("a block never runs into the bottom strip or off the top", () => {
  assert.ok(clampBlockY(1200, 300, 1280, "tall") + 150 <= 1280 * 0.82);
  assert.ok(clampBlockY(10, 300, 1280, "tall") - 150 >= 1280 * 0.06);
  assert.equal(clampBlockY(360, 100, 720, "wide"), 360);
});
