import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { orderTracks, chainDurationSec, bedHash, buildBedArgs, fixedOrder, trackStarts } from "./bedAssembly.js";

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

test("each track is set to the same loudness before the crossfades", () => {
  const { filter } = buildBedArgs(["a.mp3", "b.mp3", "c.mp3"], {
    crossfadeSec: 6, targetSec: 240, outPath: "bed.m4a", gainsDb: [4.5, 0, -3.25],
  });
  assert.match(filter, /\[0:a\]volume=4\.50dB\[g0\]/);
  assert.match(filter, /\[2:a\]volume=-3\.25dB\[g2\]/);
  assert.ok(!/volume=0\.00dB/.test(filter), "a track already at level is left untouched");
  assert.match(filter, /\[g0\]\[1:a\]acrossfade/);
});

test("a bed built before levelling is rebuilt, not reused", () => {
  // The cached bed has uneven tracks; the hash must not match it.
  const base = { trackRefs: ["a", "b"], crossfadeSec: 6, targetSec: 7200 };
  const before = crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex");
  assert.notEqual(bedHash(base), before, "same key as an unlevelled bed");
});

test("buildBedArgs refuses to build a bed from nothing", () => {
  assert.throws(() => buildBedArgs([], { targetSec: 60, outPath: "x.m4a" }), /no tracks/);
});

// fixedOrder — the operator's order
test("fixedOrder: plays tracks exactly in the given order", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  const out = fixedOrder([t("a", 100), t("b", 100), t("c", 100)], 250, { crossfadeSec: 0 });
  assert.deepEqual(out.map((x) => x.ref), ["a", "b", "c"]);
});

test("fixedOrder: repeats the list from the top when one pass is short", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  const out = fixedOrder([t("a", 100), t("b", 100)], 350, { crossfadeSec: 0 });
  assert.deepEqual(out.map((x) => x.ref), ["a", "b", "a", "b"]);
});

test("fixedOrder: never puts a track next to itself across the seam", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  const out = fixedOrder([t("a", 100), t("b", 100), t("a", 100)], 500, { crossfadeSec: 0 });
  for (let i = 1; i < out.length; i += 1) assert.notEqual(out[i].ref, out[i - 1].ref);
});

test("fixedOrder: a single track still fills the length", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  const out = fixedOrder([t("a", 100)], 250, { crossfadeSec: 0 });
  assert.deepEqual(out.map((x) => x.ref), ["a", "a", "a"]);
});

test("fixedOrder: a list of one track twice does not loop forever", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  const out = fixedOrder([t("a", 100), t("a", 100)], 250, { crossfadeSec: 0 });
  assert.equal(out.length, 3);
});

test("fixedOrder: stops at maxTracks", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  assert.equal(fixedOrder([t("a", 1), t("b", 1)], 10_000, { crossfadeSec: 0, maxTracks: 5 }).length, 5);
});

test("fixedOrder: ignores tracks with no duration", () => {
  const t = (ref, durationSec) => ({ ref, file: `/f/${ref}.mp3`, durationSec });
  assert.deepEqual(fixedOrder([t("a", 0), t("b", 100)], 50, { crossfadeSec: 0 }).map((x) => x.ref), ["b"]);
});

// trackStarts — where each track begins in the bed
test("trackStarts: each join overlaps by the crossfade", () => {
  const out = trackStarts([{ ref: "a", durationSec: 100 }, { ref: "b", durationSec: 100 }, { ref: "c", durationSec: 100 }], 6, 10_000);
  assert.deepEqual(out.map((x) => x.startSec), [0, 94, 188]);
});

test("trackStarts: a track starting at or after the target is left out and the last is cut short", () => {
  const out = trackStarts([{ ref: "a", durationSec: 100 }, { ref: "b", durationSec: 100 }, { ref: "c", durationSec: 100 }], 0, 150);
  assert.deepEqual(out.map((x) => [x.ref, x.startSec, x.durationSec]), [["a", 0, 100], ["b", 100, 50]]);
});

test("trackStarts: keeps the other fields of each entry", () => {
  const [first] = trackStarts([{ ref: "a", durationSec: 10, label: "A", credit: "X" }], 0, 60);
  assert.equal(first.label, "A");
  assert.equal(first.credit, "X");
});

// bedHash — order is part of the cache key
test("bedHash: shuffle and fixed hash differently", () => {
  const base = { trackRefs: ["library:a"], crossfadeSec: 6, targetSec: 60 };
  assert.notEqual(bedHash({ ...base, order: "shuffle" }), bedHash({ ...base, order: "fixed" }));
});

test("bedHash: order defaults to shuffle", () => {
  const base = { trackRefs: ["library:a"], crossfadeSec: 6, targetSec: 60 };
  assert.equal(bedHash(base), bedHash({ ...base, order: "shuffle" }));
});

/** Deterministic PRNG so shuffle-dependent assertions do not flake. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
