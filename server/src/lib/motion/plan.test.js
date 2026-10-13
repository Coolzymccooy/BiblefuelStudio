import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, OUTPUT } from "./plan.js";

const shot = (start, end, over = {}) => ({
  start, end, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 }, ...over,
});
const good = () => ({
  version: 1, ...OUTPUT, durationSec: 4, seed: 7, style: "glow", energy: 0.2,
  shots: [shot(0, 2, { role: "open" }), shot(2, 4, { role: "end", photo: 1, overlays: [{ id: "sparkles" }] })],
  captions: [{ text: "HAPPY 40TH", start: 0.15, end: 1.95, reveal: 0.6, holdUntil: 1.95, effect: "title" }],
});

test("a good plan passes", () => {
  const r = validatePlan(good(), { photoCount: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("OUTPUT is 1080x1920 at 30 fps", () => {
  assert.deepEqual(OUTPUT, { w: 1080, h: 1920, fps: 30 });
});

const bad = [
  ["a gap between shots", (p) => { p.shots[1].start = 2.5; }, /contiguous/],
  ["shots not reaching the end", (p) => { p.shots[1].end = 3.5; }, /durationSec/],
  ["an unknown move", (p) => { p.shots[0].move.id = "spin"; }, /move "spin"/],
  ["an entrance used as a move", (p) => { p.shots[0].move.id = "flash"; }, /move "flash"/],
  ["a missing photo", (p) => { p.shots[1].photo = 5; }, /photo 5/],
  ["a caption past the end", (p) => { p.captions[0].end = 9; }, /caption 0/],
  ["overlapping captions", (p) => { p.captions.push({ text: "B", start: 1, end: 3, reveal: 0.2, holdUntil: 3 }); }, /overlap/],
  ["a too-long statement", (p) => { p.captions[0].text = "x".repeat(61); }, /text/],
  ["a bad style", (p) => { p.style = "disco"; }, /style/],
  ["energy above 1", (p) => { p.energy = 1.5; }, /energy/],
  ["a shot ending before it starts", (p) => { p.shots[0].end = 0; }, /ends before it starts/],
  ["a missing anchor", (p) => { delete p.shots[0].anchor; }, /anchor/],
  ["an energy that is NaN", (p) => { p.energy = NaN; }, /energy/],
  ["a caption reveal that is Infinity", (p) => { p.captions[0].reveal = Infinity; }, /reveal/],
  ["a caption holdUntil that is Infinity", (p) => { p.captions[0].holdUntil = Infinity; }, /holdUntil/],
  ["a caption holdUntil past durationSec", (p) => { p.captions[0].holdUntil = 9; }, /hold/],
  ["a caption holdUntil before its start", (p) => { p.captions[0].holdUntil = 0.1; }, /hold/],
];
test("requires photoCount to be a positive integer", () => {
  for (const photoCount of [undefined, 0, -1, 1.5, NaN]) {
    const r = validatePlan(good(), { photoCount });
    assert.equal(r.ok, false, `photoCount ${photoCount}`);
    assert.deepEqual(r.errors, ["photoCount must be a positive integer"]);
  }
});

for (const [name, mutate, re] of bad) {
  test(`rejects ${name}`, () => {
    const p = good();
    mutate(p);
    const r = validatePlan(p, { photoCount: 2 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => re.test(e)), JSON.stringify(r.errors));
  });
}

test("with photo shapes, a move that doesn't suit its photo is rejected", () => {
  const p = good();
  p.shots[0].move.id = "pan"; // pan takes wide photos only
  const wideFirst = validatePlan(p, { photoCount: 2, shapes: ["wide", "tall"] });
  assert.equal(wideFirst.ok, true, JSON.stringify(wideFirst.errors));
  const tallFirst = validatePlan(p, { photoCount: 2, shapes: ["tall", "wide"] });
  assert.equal(tallFirst.ok, false);
  assert.deepEqual(tallFirst.errors, ['shot 0: move "pan" doesn\'t suit a tall photo', 'shot 1: move "push" doesn\'t suit a wide photo']);
  // A wide photo can't take a zoom move either (push is tall-only).
  const squashed = validatePlan(good(), { photoCount: 2, shapes: ["wide", "tall"] });
  assert.deepEqual(squashed.errors, ['shot 0: move "push" doesn\'t suit a wide photo']);
});

test("shapes are optional, but when given there is one per photo", () => {
  assert.equal(validatePlan(good(), { photoCount: 2 }).ok, true);
  assert.equal(validatePlan(good(), { photoCount: 2, shapes: ["tall", "tall"] }).ok, true);
  const short = validatePlan(good(), { photoCount: 2, shapes: ["tall"] });
  assert.equal(short.ok, false);
  assert.match(short.errors[0], /shapes/);
  const odd = validatePlan(good(), { photoCount: 2, shapes: ["tall", "round"] });
  assert.equal(odd.ok, false);
  assert.match(odd.errors[0], /shapes/);
});
