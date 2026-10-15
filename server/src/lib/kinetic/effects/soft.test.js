import { test } from "node:test";
import assert from "node:assert/strict";
import { fontsFor } from "./common.js";
import { SOFT_FONT, resolveLook, FALLBACK_FONT } from "../looks.js";
import { covers } from "../text.js";
import { buildAss } from "../ass.js";

const look = resolveLook("studio-lagos-night");
const yoruba = "Ẹ ṣeun Jésù fún ìfẹ́ rẹ";

test("Caveat covers Yoruba tone-marked text", () => {
  assert.ok(covers(SOFT_FONT.file, yoruba));
});

test("without the soft flag nothing changes: look fonts, or DejaVu when they lack the letters", () => {
  assert.equal(fontsFor(look, "MY TIME NO LATE").body.file, look.body.file);
  assert.equal(fontsFor(look, yoruba).body.file, FALLBACK_FONT.file);
});

test("a soft phrase uses Caveat at 1.35 in the body colour", () => {
  const f = fontsFor(look, "In the quiet of the night", { soft: true });
  assert.equal(f.body.file, SOFT_FONT.file);
  assert.equal(f.body.scale, 1.35);
  assert.equal(f.body.colour, look.body.colour);
  assert.equal(f.hit.file, look.hit.file); // Knewave covers plain Latin
});

test("a soft Yoruba phrase falls back to Caveat for the key word too", () => {
  const f = fontsFor(look, yoruba, { soft: true });
  assert.equal(f.body.file, SOFT_FONT.file);
  assert.equal(f.hit.file, SOFT_FONT.file);
  assert.equal(f.hit.colour, look.hit.colour);
});

test("a soft line drawn by buildAss names Caveat", () => {
  const lines = [{ text: yoruba, start: 2, end: 5, soft: true }];
  const out = buildAss({ lines, w: 720, h: 1280, look: "studio-lagos-night", energy: "lively", layout: "shorts", overrides: { 0: "stack" } });
  assert.match(out, new RegExp(`\\\\fn${SOFT_FONT.family}`));
});

test("the same line without the soft flag never names Caveat", () => {
  const lines = [{ text: yoruba, start: 2, end: 5 }];
  const out = buildAss({ lines, w: 720, h: 1280, look: "studio-lagos-night", energy: "lively", layout: "shorts", overrides: { 0: "stack" } });
  assert.doesNotMatch(out, new RegExp(`\\\\fn${SOFT_FONT.family}`));
});
