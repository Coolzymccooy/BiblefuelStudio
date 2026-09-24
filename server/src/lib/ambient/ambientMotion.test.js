import test from "node:test";
import assert from "node:assert/strict";
import { driftFilter, DRIFT_ZOOM, DRIFT_PERIOD_SEC } from "./ambientMotion.js";

// Evaluate one of the filter's corner expressions the way ffmpeg would, for
// frame `n` of a W x H picture. Only the operators the filter uses are mapped.
function corner(filter, name, n, W = 1920, H = 1080) {
  const expr = filter.match(new RegExp(`${name}='([^']+)'`))[1];
  const js = expr.replace(/\bPI\b/g, "Math.PI").replace(/\bcos\(/g, "Math.cos(").replace(/\bin\b/g, "n");
  return new Function("W", "H", "n", `return ${js};`)(W, H, n);
}

test("drift is a sub-pixel perspective warp, not zoompan's whole-pixel steps", () => {
  const f = driftFilter({ fps: 24 });
  assert.match(f, /^perspective=/);
  assert.match(f, /interpolation=linear/);
  assert.match(f, /eval=frame/);
  assert.ok(!/zoompan/.test(f));
});

test("the picture starts fully framed, exactly as the still would show it", () => {
  const f = driftFilter({ fps: 24 });
  assert.equal(corner(f, "x0", 0), 0);
  assert.equal(corner(f, "y0", 0), 0);
  assert.equal(corner(f, "x3", 0), 1920);
  assert.equal(corner(f, "y3", 0), 1080);
});

test("it breathes: in to the full zoom at half a period, back out at a full one", () => {
  const fps = 24;
  const f = driftFilter({ fps });
  const period = DRIFT_PERIOD_SEC * fps;
  const inset = (1920 / 2) * (1 - 1 / (1 + DRIFT_ZOOM));
  assert.ok(Math.abs(corner(f, "x0", period / 2) - inset) < 1e-6);
  assert.ok(Math.abs(corner(f, "x0", period)) < 1e-6);
  // Never past the full zoom, at any frame.
  for (let n = 0; n <= period * 3; n += 7) {
    const x0 = corner(f, "x0", n);
    assert.ok(x0 >= -1e-9 && x0 <= inset + 1e-9, `frame ${n}: ${x0}`);
  }
});

test("the zoom stays centred: every corner moves in by the same share", () => {
  const f = driftFilter({ fps: 24 });
  const n = 500;
  const x0 = corner(f, "x0", n);
  const y0 = corner(f, "y0", n);
  assert.ok(Math.abs(x0 / 1920 - y0 / 1080) < 1e-12);
  assert.ok(Math.abs(corner(f, "x1", n) - (1920 - x0)) < 1e-9);
  assert.ok(Math.abs(corner(f, "y2", n) - (1080 - y0)) < 1e-9);
  assert.ok(Math.abs(corner(f, "x2", n) - x0) < 1e-9);
});

test("it is gentle: the edge of a 1080p frame never moves more than a few pixels a second", () => {
  const fps = 24;
  const f = driftFilter({ fps });
  let fastest = 0;
  for (let n = 0; n < DRIFT_PERIOD_SEC * fps; n += 1) {
    fastest = Math.max(fastest, Math.abs(corner(f, "x0", n + 1) - corner(f, "x0", n)) * fps);
  }
  assert.ok(fastest > 0.5, `moves at all: ${fastest}px/s`);
  assert.ok(fastest < 4, `stays calm: ${fastest}px/s`);
});

test("the period follows the frame rate it is given", () => {
  const f24 = driftFilter({ fps: 24 });
  const f30 = driftFilter({ fps: 30 });
  assert.ok(Math.abs(corner(f24, "x0", 12 * 24) - corner(f30, "x0", 12 * 30)) < 1e-9);
});

test("no comma or colon inside an expression, so the graph can't be split in the wrong place", () => {
  const f = driftFilter({ fps: 24 });
  for (const m of f.matchAll(/='([^']*)'/g)) assert.ok(!/[,:]/.test(m[1]), m[1]);
});
