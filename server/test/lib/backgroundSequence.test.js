import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeSyncedSegments, buildCrossfadeChain } from "../../src/lib/backgroundSequence.js";

const sum = (a) => a.reduce((x, y) => x + y, 0);

describe("computeSyncedSegments", () => {
  test("count < 2 returns a single full-length slot", () => {
    const segs = computeSyncedSegments({ words: [], durationSec: 30, count: 1 });
    assert.deepEqual(segs, [30]);
  });

  test("no word timings falls back to an even split", () => {
    const segs = computeSyncedSegments({ words: [], durationSec: 30, count: 3 });
    assert.equal(segs.length, 3);
    segs.forEach((s) => assert.ok(Math.abs(s - 10) < 1e-9));
  });

  test("segments always sum to the full duration", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({ start: i * 0.75, end: i * 0.75 + 0.6 }));
    const segs = computeSyncedSegments({ words, durationSec: 30, count: 4 });
    assert.equal(segs.length, 4);
    assert.ok(Math.abs(sum(segs) - 30) < 1e-6);
  });

  test("boundaries snap to phrase starts (a word start time)", () => {
    // One obvious phrase boundary near the midpoint at t=16.0.
    const words = [
      { start: 1, end: 2 }, { start: 5, end: 6 }, { start: 16.0, end: 17 }, { start: 24, end: 25 },
    ];
    const segs = computeSyncedSegments({ words, durationSec: 30, count: 2, minSegSec: 1.5 });
    // First segment should end at the snapped boundary 16.0, not the even 15.0.
    assert.ok(Math.abs(segs[0] - 16.0) < 1e-6, `first segment was ${segs[0]}`);
  });

  test("never produces a segment shorter than minSegSec (falls back to even)", () => {
    // All candidate words clustered at the very start → snapping would collapse
    // a segment, so it must fall back to the even split.
    const words = [{ start: 0.2, end: 0.4 }, { start: 0.5, end: 0.7 }];
    const segs = computeSyncedSegments({ words, durationSec: 20, count: 4, minSegSec: 1.5 });
    segs.forEach((s) => assert.ok(s >= 1.5));
    assert.ok(Math.abs(sum(segs) - 20) < 1e-6);
  });
});

describe("buildCrossfadeChain", () => {
  test("emits an xfade per transition and ends in the [vbg] label", () => {
    const { chain } = buildCrossfadeChain({ count: 3, segments: [10, 10, 10], w: 1080, h: 1920 });
    assert.equal((chain.match(/xfade=/g) || []).length, 2, "N-1 transitions");
    assert.match(chain, /\[vbg\];$/);
    assert.match(chain, /scale=1080:1920/);
  });

  test("each input clip carries its slot + one transition of tail material", () => {
    const { inputDurations } = buildCrossfadeChain({ count: 2, segments: [8, 12], w: 1080, h: 1920, transitionSec: 0.5 });
    assert.deepEqual(inputDurations, [8.5, 12.5]);
  });

  test("xfade offsets are non-negative and the transition never exceeds half the shortest slot", () => {
    // Shortest slot is 1.0s, so transition must clamp to <= 0.5s.
    const { chain } = buildCrossfadeChain({ count: 2, segments: [1.0, 20], w: 1080, h: 1920, transitionSec: 5 });
    const dur = Number(chain.match(/duration=([\d.]+):offset/)[1]);
    assert.ok(dur <= 0.5, `transition ${dur} should clamp to <= half the shortest slot`);
    const offset = Number(chain.match(/offset=([\d.]+)/)[1]);
    assert.ok(offset >= 0);
  });
});
