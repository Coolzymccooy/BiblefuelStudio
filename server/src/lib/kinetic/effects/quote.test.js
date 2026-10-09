import { test } from "node:test";
import assert from "node:assert/strict";
import { render as quote, underlineShape } from "./quote.js";
import { ctx, planned, posOf, visible } from "./testkit.js";
import { widthAt } from "../text.js";

const textOf = (lines) => lines.filter((l) => !l.includes("\\p1"));
const underOf = (lines) => lines.find((l) => l.includes("\\p1"));

test("quote wraps the phrase in quotation marks and keeps every word", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const shown = visible(textOf(lines)).join(" ");
  assert.match(shown, /^[“"]BY HIS GRACE ALONE[”"]$/);
});

test("the underline draws itself left to right as the last word lands", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const under = underOf(lines);
  assert.ok(under, "an underline drawing");
  // "alone" is the 4th word: 2 + 3 * 0.25 = 2.75 s
  assert.match(under, /^Dialogue: 1,0:00:02\.75,/);
  const m = under.match(/\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\\t\(0,350,\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\)/);
  assert.ok(m, "an animated clip");
  const [l1, , r1, , l2, , r2] = m.slice(1).map(Number);
  assert.equal(l1, r1, "starts empty");
  assert.equal(l2, l1);
  assert.ok(r2 > l2 + 100, "ends wide");
});

test("the underline sits below the last line of text", () => {
  const lines = quote(ctx(planned("By his grace alone", "quote")));
  const lastY = Math.max(...textOf(lines).map((l) => posOf(l)[1]));
  const underY = Number(underOf(lines).match(/\\pos\(-?\d+,(-?\d+)\)/)[1]);
  assert.ok(underY > lastY, `underline ${underY} below text ${lastY}`);
});

test("the underline is 0.9 of the last line's width, not the widest line's", () => {
  const c = ctx(planned("Even the darkest night ends", "quote"));
  const lines = quote(c);
  const text = textOf(lines);
  assert.equal(text.length, 2, "wraps to two lines");
  const shown = text.map((l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, ""));
  const fs = Number(text[0].match(/\\fs(\d+)/)[1]);
  const [first, last] = shown.map((s) => widthAt(c.look.body.file, s, fs));
  assert.ok(last < first * 0.8, `the last line (${last}) is clearly narrower than the first (${first})`);
  const m = underOf(lines).match(/\\t\(0,350,\\clip\((-?\d+),-?\d+,(-?\d+),-?\d+\)\)/).slice(1).map(Number);
  assert.ok(Math.abs(m[1] - m[0] - 0.9 * last) <= 1, `underline ${m[1] - m[0]} vs 0.9 × ${last}`);
});

test("on a tall frame quote stays inside the safe band", () => {
  const lines = quote(ctx(planned("Even the darkest night ends", "quote", { slot: 2 }), { w: 720, h: 1280, aspect: "tall" }));
  for (const l of textOf(lines)) assert.ok(posOf(l)[1] <= 1280 * 0.82, "text above the bottom strip");
  const m = underOf(lines).match(/\\t\(0,350,\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)\)/).slice(1).map(Number);
  assert.ok(m[0] >= 0.06 * 720 - 1 && m[2] <= 0.88 * 720 + 1, `underline x ${m[0]}..${m[2]}`);
  assert.ok(m[3] <= 1280 * 0.82 + 1, `underline bottom ${m[3]}`);
});

test("underlineShape is a closed drawing as wide as asked", () => {
  const s = underlineShape(300, 6);
  assert.match(s, /^m 0 \d+ b /);
  const xs = s.match(/-?\d+/g).map(Number).filter((_, i) => i % 2 === 0);
  assert.equal(Math.max(...xs), 300);
});
