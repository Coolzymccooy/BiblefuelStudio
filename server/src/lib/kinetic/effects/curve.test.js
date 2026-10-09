import { test } from "node:test";
import assert from "node:assert/strict";
import { render as curve } from "./curve.js";
import { render as stack } from "./stack.js";
import { ctx, planned, posOf } from "./testkit.js";

const letterOf = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const frzOf = (l) => Number(l.match(/\\frz(-?[\d.]+)/)[1]);

test("curve sets every letter of the phrase in order along an arc", () => {
  const lines = curve(ctx(planned("Hold my hand", "curve")));
  assert.equal(lines.map(letterOf).join(""), "HOLDMYHAND");
  const xs = lines.map((l) => posOf(l)[0]);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "left to right");
  const ys = lines.map((l) => posOf(l)[1]);
  const mid = Math.floor(lines.length / 2);
  assert.ok(ys[0] > ys[mid] && ys[ys.length - 1] > ys[mid], "the ends sit lower than the middle");
  assert.ok(frzOf(lines[0]) > 0 && frzOf(lines[lines.length - 1]) < 0, "letters turn to the curve");
  assert.ok(ys.every((y) => y < 720 / 2), "upper half");
});

test("the letters of a word land together on that word's beat", () => {
  const lines = curve(ctx(planned("Hold my hand", "curve")));
  assert.ok(lines.slice(0, 4).every((l) => l.startsWith("Dialogue: 0,0:00:02.00,")), "HOLD");
  assert.ok(lines.slice(4, 6).every((l) => l.startsWith("Dialogue: 0,0:00:02.25,")), "MY");
  assert.ok(lines.slice(6).every((l) => l.startsWith("Dialogue: 0,0:00:02.50,")), "HAND");
});

test("the key word is in the hit colour when lively, and nothing is when calm", () => {
  const lively = curve(ctx(planned("Hold my hand", "curve")));
  assert.ok(lively.slice(6).every((l) => l.includes("\\1c&H003AD3F5&")), "HAND is the key word");
  assert.ok(lively.slice(0, 4).every((l) => !l.includes("&H003AD3F5&")));
  const calm = curve(ctx(planned("Hold my hand", "curve"), { energy: "calm" }));
  assert.ok(calm.every((l) => !l.includes("&H003AD3F5&")));
});

test("on a tall frame the arc stays inside the safe sides", () => {
  const lines = curve(ctx(planned("By his grace alone", "curve"), { w: 720, h: 1280, aspect: "tall" }));
  assert.ok(lines.length > 10, "drawn as a curve, not stacked");
  for (const l of lines) {
    const [x] = posOf(l);
    assert.ok(x >= 0.06 * 720 && x <= 0.88 * 720, `x ${x}`);
  }
});

test("a Yoruba tone mark stays on its letter", () => {
  // "Ọlọ́run mi" in NFC: the acute on the second ọ is a separate combining code point.
  const text = "Ọlọ́run mi";
  const lines = curve(ctx(planned(text, "curve")));
  const letters = lines.map(letterOf);
  assert.ok(letters.every((l) => !/^\p{M}+$/u.test(l)), `a mark floats alone: ${JSON.stringify(letters)}`);
  assert.equal(letters.join(""), text.toLocaleUpperCase().replace(/\s+/g, ""));
});

test("on a tall frame every letter sits in the top half, even near the shrink cutoff", () => {
  const tall = { w: 720, h: 1280, aspect: "tall" };
  const lines = curve(ctx(planned("By his grace alone", "curve"), tall));
  for (const l of lines) assert.ok(posOf(l)[1] <= 0.5 * 1280, `y ${posOf(l)[1]}`);
  // Shrinks to about 60% of its preferred size: still a curve, not a stack.
  const near = curve(ctx(planned("Amazing grace how sweet the", "curve"), tall));
  assert.ok(near.length > 10, `${near.length} events`);
  assert.ok(near.every((l) => l.includes("\\pos(") && !l.includes("\\move(")), "not stacked");
  for (const l of near) assert.ok(posOf(l)[1] <= 0.5 * 1280, `y ${posOf(l)[1]}`);
});

test("a phrase too long for the arc is stacked instead", () => {
  const c = ctx(planned("Reconciliation transformation righteousness everywhere", "curve"), { w: 720, h: 1280, aspect: "tall" });
  assert.deepEqual(curve(c), stack(c));
});
