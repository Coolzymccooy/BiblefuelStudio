import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GRADES, normaliseRefine, refineLook, shotPlayback } from "./refine.js";

describe("normaliseRefine", () => {
  test("keeps a full refine within its limits", () => {
    assert.deepEqual(
      normaliseRefine({ in: 1.234, out: 6, rate: 1.5, flip: true, zoom: 1.4, x: 0.5, y: -0.25, grade: "warm" }, 8),
      { in: 1.23, out: 6, rate: 1.5, flip: true, zoom: 1.4, x: 0.5, y: -0.25, grade: "warm" },
    );
  });

  test("clamps every number to its range", () => {
    const r = normaliseRefine({ in: -2, out: 99, rate: 9, zoom: 7, x: 4, y: -4 }, 8);
    assert.deepEqual(r, { in: 0, out: null, rate: 2, flip: false, zoom: 2, x: 1, y: -1, grade: "none" });
  });

  test("an out point at the clip's end is no out point", () => {
    assert.equal(normaliseRefine({ in: 1, out: 8 }, 8).out, null);
  });

  test("keeps at least half a second between in and out", () => {
    const r = normaliseRefine({ in: 5, out: 5.1 }, 8);
    assert.equal(r.in, 5);
    assert.equal(r.out, 5.5);
  });

  test("an in point near the end leaves half a second to play", () => {
    assert.equal(normaliseRefine({ in: 7.9 }, 8).in, 7.5);
  });

  test("rate null means fit the shot automatically", () => {
    assert.equal(normaliseRefine({ rate: null, flip: true }, 8).rate, null);
  });

  test("an unknown grade is no grade", () => {
    assert.equal(normaliseRefine({ grade: "neon", flip: true }, 8).grade, "none");
  });

  test("nothing changed from the clip as made is no refine at all", () => {
    assert.equal(normaliseRefine({ in: 0, out: null, rate: null, flip: false, zoom: 1, x: 0, y: 0, grade: "none" }, 8), null);
    assert.equal(normaliseRefine({}, 8), null);
    assert.equal(normaliseRefine("warm", 8), null);
    assert.equal(normaliseRefine(null, 8), null);
  });

  test("an out point a moment before the clip's end is the end", () => {
    assert.equal(normaliseRefine({ in: 1, out: 7.95 }, 8).out, null);
  });

  test("framing needs a zoom: at zoom 1 the frame cannot move", () => {
    assert.equal(normaliseRefine({ zoom: 1, x: 1, y: -1 }, 8), null);
    assert.deepEqual([normaliseRefine({ zoom: 1, x: 1, flip: true }, 8).x, normaliseRefine({ zoom: 1.2, x: 1 }, 8).x], [0, 1]);
  });

  test("values of the wrong type are ignored, not coerced", () => {
    assert.equal(normaliseRefine({ grade: ["warm"], flip: true }, 8).grade, "none");
    assert.equal(normaliseRefine({ rate: "2", flip: true }, 8).rate, null);
    assert.equal(normaliseRefine({ rate: true, flip: true }, 8).rate, null);
    assert.equal(normaliseRefine({ in: "2", flip: true }, 8).in, 0);
  });

  test("without a known clip length, times are still bounded", () => {
    const r = normaliseRefine({ in: 3, out: 500 }, null);
    assert.equal(r.in, 3);
    assert.equal(r.out, 60);
  });
});

describe("shotPlayback", () => {
  test("no refine: a long enough clip plays at normal speed from the start", () => {
    assert.deepEqual(shotPlayback({ refine: null, clipDur: 8, len: 6 }), { rate: 1, from: 0, to: 8, hold: 0 });
  });

  test("no refine: a short clip is slowed to fill its place, never sped up", () => {
    const p = shotPlayback({ refine: null, clipDur: 5, len: 8 });
    assert.ok(Math.abs(p.rate - (5 - 0.08) / 8) < 1e-9);
    assert.equal(p.hold, 0);
  });

  test("trimmed in and out points set the part of the clip that plays", () => {
    const p = shotPlayback({ refine: { in: 1, out: 6, rate: null }, clipDur: 8, len: 4 });
    assert.equal(p.from, 1);
    assert.equal(p.to, 6);
    assert.equal(p.rate, 1);
  });

  test("a chosen speed is kept when the clip is long enough", () => {
    assert.equal(shotPlayback({ refine: { rate: 1.5 }, clipDur: 12, len: 6 }).rate, 1.5);
  });

  test("a chosen speed that would run out of clip is slowed just enough", () => {
    const p = shotPlayback({ refine: { rate: 2 }, clipDur: 8, len: 6 });
    assert.ok(Math.abs(p.rate - (8 - 0.08) / 6) < 1e-9);
    assert.equal(p.hold, 0);
  });

  test("a chosen slow motion is kept, and never goes below half speed", () => {
    assert.equal(shotPlayback({ refine: { rate: 0.5 }, clipDur: 8, len: 6 }).rate, 0.5);
  });

  test("a clip too short even at half speed holds its last frame for the rest", () => {
    const p = shotPlayback({ refine: { in: 2, out: 4 }, clipDur: 8, len: 6 });
    assert.equal(p.rate, 0.5);
    const plays = (2 - 0.08) / 0.5;
    assert.ok(Math.abs(p.hold - (6 - plays)) < 1e-9);
  });

  test("an unknown clip length is treated as filling the place", () => {
    const p = shotPlayback({ refine: null, clipDur: 0, len: 6 });
    assert.equal(p.rate, 1);
    assert.equal(p.hold, 0);
  });
});

describe("refineLook", () => {
  test("no refine looks like the clip as made", () => {
    assert.deepEqual(refineLook(null), { filter: "", flip: false, zoom: 1, x: 0, y: 0 });
  });

  test("passes flip, zoom and framing through, and the grade as a CSS filter", () => {
    assert.deepEqual(
      refineLook({ flip: true, zoom: 1.5, x: -0.5, y: 1, grade: "mono" }),
      { filter: GRADES.mono, flip: true, zoom: 1.5, x: -0.5, y: 1 },
    );
  });

  test("every grade but none is a CSS filter", () => {
    for (const [name, css] of Object.entries(GRADES)) {
      if (name === "none") assert.equal(css, "");
      else assert.match(css, /\w+\([^)]+\)/);
    }
  });
});
