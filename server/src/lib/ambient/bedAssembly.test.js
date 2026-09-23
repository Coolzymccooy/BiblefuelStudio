import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { orderTracks, chainDurationSec, bedHash, buildBedArgs } from "./bedAssembly.js";

const track = (ref, durationSec) => ({ ref, file: `${ref}.mp3`, durationSec });

test("chainDurationSec subtracts the crossfade overlap at every join", () => {
  // Three 100s tracks joined with 6s crossfades overlap twice: 300 - 12.
  assert.equal(chainDurationSec([track("a", 100), track("b", 100), track("c", 100)], 6), 288);
  assert.equal(chainDurationSec([track("a", 100)], 6), 100, "a single track has no join");
  assert.equal(chainDurationSec([], 6), 0);
});

test("orderTracks covers the target once crossfade overlap is accounted for", () => {
  const pool = [track("a", 60), track("b", 90), track("c", 120)];
  const chosen = orderTracks(pool, 600, { crossfadeSec: 6, rng: seeded(7) });
  assert.ok(
    chainDurationSec(chosen, 6) >= 600,
    `bed came up short: ${chainDurationSec(chosen, 6)}s of 600s`,
  );
});

test("orderTracks never places a track next to itself across a reshuffle seam", () => {
  const pool = [track("a", 30), track("b", 30), track("c", 30)];
  // Long target forces many passes, so plenty of seams to get wrong.
  const chosen = orderTracks(pool, 1800, { crossfadeSec: 3, rng: seeded(11) });
  for (let i = 1; i < chosen.length; i += 1) {
    assert.notEqual(chosen[i].ref, chosen[i - 1].ref, `adjacent repeat at index ${i}`);
  }
});

test("orderTracks tolerates a single-track pool rather than returning a short bed", () => {
  // Adjacency is impossible to avoid here; a short bed would be worse.
  const chosen = orderTracks([track("solo", 60)], 300, { crossfadeSec: 5 });
  assert.ok(chainDurationSec(chosen, 5) >= 300);
});

test("orderTracks ignores tracks with no usable duration", () => {
  const chosen = orderTracks([track("a", 0), track("b", null), track("c", 120)], 200, { crossfadeSec: 4 });
  assert.ok(chosen.every((t) => t.ref === "c"));
});

test("bedHash changes when anything that affects the audio changes", () => {
  const base = { trackRefs: ["a", "b"], crossfadeSec: 6, targetSec: 7200 };
  assert.equal(bedHash(base), bedHash({ ...base }), "same inputs must hit the cache");
  assert.notEqual(bedHash(base), bedHash({ ...base, crossfadeSec: 8 }));
  assert.notEqual(bedHash(base), bedHash({ ...base, targetSec: 3600 }));
  assert.notEqual(bedHash(base), bedHash({ ...base, trackRefs: ["b", "a"] }), "order is audible");
});

test("buildBedArgs chains crossfades, trims to length, and emits no inline filter_complex", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bed-"));
  const out = path.join(dir, "bed.m4a");
  const { args, filter } = buildBedArgs(["a.mp3", "b.mp3", "c.mp3"], {
    crossfadeSec: 6, targetSec: 240, outPath: out,
  });

  assert.equal(filter.match(/acrossfade=d=6/g)?.length, 2, "three tracks means two joins");
  assert.match(filter, /atrim=0:240/);
  assert.ok(!args.includes("-filter_complex"), "prod ffmpeg 5.1 needs the script form");
  assert.ok(args.includes("-filter_complex_script"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("buildBedArgs refuses to build a bed from nothing", () => {
  assert.throws(() => buildBedArgs([], { targetSec: 60, outPath: "x.m4a" }), /no tracks/);
});

/** Deterministic PRNG so shuffle-dependent assertions do not flake. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
