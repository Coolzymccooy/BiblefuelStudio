import { test } from "node:test";
import assert from "node:assert/strict";
import { validateShowcasePlan } from "./plan.js";
import { directShowcase } from "./director.js";

const grid = { kind: "beats", marks: Array.from({ length: 300 }, (_, i) => ({ t: Math.round((i + 1) * 0.6 * 1000) / 1000, downbeat: i % 4 === 3, strong: false })), period: 0.6 };
const make = (over = {}) => directShowcase({
  photos: Array.from({ length: 12 }, () => ({ shape: "tall" })), heroIndex: 0, grid, title: "Hi", statements: ["a", "b", "c"],
  styleId: "fellowship", energy: 0.5, lengthSec: 60, seed: 3, shape: "tall", details: {}, ...over,
}).plan;
const copy = (p) => JSON.parse(JSON.stringify(p));
const errorsOf = (plan, photoCount = 12) => {
  const r = validateShowcasePlan(plan, { photoCount });
  assert.equal(r.ok, false);
  return r.errors.join(" | ");
};

test("a plan the director makes is valid, in both shapes and at every length", () => {
  for (const lengthSec of [30, 60, 90, 120, 180]) {
    for (const shape of ["tall", "wide"]) {
      const r = validateShowcasePlan(make({ lengthSec, shape }), { photoCount: 12 });
      assert.equal(r.ok, true, `${lengthSec} ${shape}: ${r.errors?.join("; ")}`);
    }
  }
});

test("gaps, overlaps and a wrong end are named", () => {
  const gap = copy(make());
  gap.scenes[2].start += 0.3;
  assert.match(errorsOf(gap), /scene 2 is not contiguous/);
  const overlap = copy(make());
  overlap.scenes[3].start -= 0.3;
  assert.match(errorsOf(overlap), /scene 3 is not contiguous/);
  const short = copy(make());
  short.scenes.at(-1).end -= 1;
  assert.match(errorsOf(short), /must end at durationSec/);
});

test("photo counts and indices are checked", () => {
  const wrongCount = copy(make());
  const i = wrongCount.scenes.findIndex((s) => s.template !== "single" && s.photos.length > 1);
  wrongCount.scenes[i].photos.pop();
  assert.match(errorsOf(wrongCount), new RegExp(`scene ${i}: ${wrongCount.scenes[i].template} shows`));
  const outOfRange = copy(make());
  outOfRange.scenes[1].photos[0] = 12;
  assert.match(errorsOf(outOfRange), /scene 1 uses photo 12, but there are 12/);
});

test("classic styles, unknown templates, over-long Moments and a wrong frame are refused", () => {
  assert.match(errorsOf({ ...make(), style: "hype" }), /style/);
  const unknown = copy(make());
  unknown.scenes[1].template = "kaleidoscope";
  assert.match(errorsOf(unknown), /template/);
  assert.match(errorsOf({ ...make(), durationSec: 200 }), /durationSec/);
  assert.match(errorsOf({ ...make({ shape: "wide" }), w: 1080, h: 1920 }), /frame/);
});

test("photoCount is required", () => {
  assert.equal(validateShowcasePlan(make(), {}).ok, false);
});
