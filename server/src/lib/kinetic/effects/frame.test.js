import { test } from "node:test";
import assert from "node:assert/strict";
import { render as frame } from "./frame.js";
import { ctx, planned, posOf, visible } from "./testkit.js";
import { widthAt } from "../text.js";
import { buildAss } from "../ass.js";

const bandsOf = (lines) => lines.filter((l) => l.includes("\\clip("));
const moveOf = (l) => l.match(/\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/).slice(1).map(Number);
const clipOf = (l) => l.match(/\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/).slice(1).map(Number);
const shownOf = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const fsOf = (l) => Number(l.match(/\\fs(\d+)/)[1]);

test("frame runs the phrase round all four edges, top and bottom scrolling opposite ways", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true })));
  const bands = bandsOf(lines);
  assert.equal(bands.length, 4);
  const [top, bottom, left, right] = bands.map(moveOf);
  assert.ok(top[2] < top[0] && top[1] === top[3], "top scrolls left");
  assert.ok(bottom[2] > bottom[0] && bottom[1] === bottom[3], "bottom scrolls right");
  assert.ok(left[3] < left[1] && left[0] === left[2], "left scrolls up");
  assert.ok(right[3] > right[1] && right[0] === right[2], "right scrolls down");
  assert.match(bands[2], /\\frz90/);
  assert.match(bands[3], /\\frz-90/);
  for (const b of bands) assert.ok(shownOf(b).split("I STILL DEY").length - 1 >= 2, "the phrase repeats along the band");
});

test("each band covers its whole edge from the first frame to the last", () => {
  const c = ctx(planned("I still dey", "frame", { hook: true }));
  const bands = bandsOf(frame(c));
  const file = c.look.body.file;
  const [top, , left] = [bands[0], bands[1], bands[2]];
  const [L, , R] = clipOf(top);
  const topLen = widthAt(file, shownOf(top), fsOf(top));
  for (const x of [moveOf(top)[0], moveOf(top)[2]]) {
    assert.ok(x - topLen / 2 <= L + 1 && x + topLen / 2 >= R - 1, `top band at ${x} spans ${L}..${R}`);
  }
  const [, T, , B] = clipOf(left);
  const sideLen = widthAt(file, shownOf(left), fsOf(left));
  for (const y of [moveOf(left)[1], moveOf(left)[3]]) {
    assert.ok(y - sideLen / 2 <= T + 1 && y + sideLen / 2 >= B - 1, `left band at ${y} spans ${T}..${B}`);
  }
});

test("the side bands own the corners: top and bottom are clipped short of them", () => {
  const c = ctx(planned("I still dey", "frame", { hook: true }));
  const [top, bottom, left, right] = bandsOf(frame(c)).map(clipOf);
  const cut = Math.round(1.4 * Math.round(720 * 0.055));
  assert.deepEqual(left, right);
  for (const edge of [top, bottom]) {
    assert.ok(Math.abs(edge[0] - (left[0] + cut)) <= 1 && Math.abs(edge[2] - (left[2] - cut)) <= 1, `clip ${edge} vs ${left}`);
    assert.equal(edge[1], left[1]);
    assert.equal(edge[3], left[3]);
  }
});

test("a long overridden phrase keeps every centre line between the top and bottom bands", () => {
  const text = "When the storm is raging and the night is long Lord";
  const ass = buildAss({ lines: [{ text, start: 1, end: 5 }], w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, overrides: { 0: "frame" } });
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  const [top, bottom] = bandsOf(events);
  const bandFs = fsOf(top);
  const upper = moveOf(top)[1] + bandFs;
  const lower = moveOf(bottom)[1] - bandFs;
  const centre = events.filter((l) => !l.includes("\\clip("));
  assert.deepEqual(visible(centre), text.toLocaleUpperCase().split(" "));
  for (const l of centre) {
    const y = posOf(l)[1];
    const fs = fsOf(l);
    assert.ok(y - fs / 2 >= upper && y + fs / 2 <= lower, `line at ${y} size ${fs} vs ${upper}..${lower}`);
  }
});

test("the centre shows every word big in the hit colour", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true })));
  const centre = lines.filter((l) => !l.includes("\\clip("));
  assert.deepEqual(visible(centre), ["I", "STILL", "DEY"]);
  assert.ok(centre.every((l) => l.includes("&H003AD3F5&")));
  assert.ok(centre.every((l) => l.startsWith("Dialogue: 2,")), "above the bands");
});

test("on a tall frame the bands keep clear of the bottom 18% and the right 12%", () => {
  const lines = frame(ctx(planned("I still dey", "frame", { hook: true }), { w: 720, h: 1280, aspect: "tall" }));
  for (const b of bandsOf(lines)) {
    const [l, t, r, btm] = clipOf(b);
    assert.ok(l >= 0.06 * 720 - 1 && r <= 0.88 * 720 + 1, `clip x ${l}..${r}`);
    assert.ok(t >= 0 && btm <= 0.82 * 1280 + 1, `clip y ${t}..${btm}`);
  }
});
