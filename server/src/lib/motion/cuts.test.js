import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../kinetic/director.js";
import {
  beatGridOf, pulseGrid, pauseGrid, cutPoints, energyBand, MIN_SHOT, MAX_SHOT, END_CARD_MIN,
} from "./cuts.js";

/** A 120 BPM grid over `len` s: downbeats every 4 beats from beat 0, beat 8 strong. */
function grid120(len = 30) {
  const period = 0.5;
  const beats = [];
  for (let t = 0.2; t < len; t += period) beats.push(Math.round(t * 1000) / 1000);
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  return beatGridOf({ beats, downbeats, strong: [8, 24], period });
}

function checkTiling(cuts, len) {
  assert.equal(cuts[0].start, 0);
  assert.equal(cuts.at(-1).end, len);
  for (let i = 1; i < cuts.length; i += 1) assert.equal(cuts[i].start, cuts[i - 1].end);
  for (const c of cuts) {
    assert.ok(c.end - c.start >= MIN_SHOT - 1e-9, `short shot ${JSON.stringify(c)}`);
    assert.ok(c.end - c.start <= MAX_SHOT + 1e-9, `long shot ${JSON.stringify(c)}`);
  }
  assert.ok(cuts.at(-1).end - cuts.at(-1).start >= END_CARD_MIN - 1e-9, "end card is long enough");
}

test("energy bands split at 0.34 and 0.66", () => {
  assert.equal(energyBand(0), "calm");
  assert.equal(energyBand(0.33), "calm");
  assert.equal(energyBand(0.34), "medium");
  assert.equal(energyBand(0.66), "medium");
  assert.equal(energyBand(0.67), "hype");
});

test("calm cuts every 4 or 8 beats, on downbeats", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const cuts = cutPoints({ grid: grid120(), energy: 0.1, lengthSec: 30, rnd: mulberry32(seed) });
    checkTiling(cuts, 30);
    for (const c of cuts.slice(1, -1)) assert.ok(c.downbeat, `seed ${seed}: cut at ${c.start} is not a downbeat`);
    // The last two shots may be the halves of an over-long end card, so only
    // the shots before them must be whole 4- or 8-beat steps.
    for (const c of cuts.slice(1, -2)) {
      const beats = Math.round((c.end - c.start) / 0.5);
      assert.ok([4, 8].includes(beats), `seed ${seed}: ${beats} beats at ${c.start}`);
    }
  }
});

const lengths = (cuts) => cuts.map((c) => Math.round((c.end - c.start) * 1000) / 1000);

test("medium cuts every 4 beats (a bar), so photos have time to land", () => {
  const cuts = cutPoints({ grid: grid120(30), energy: 0.5, lengthSec: 30, rnd: mulberry32(1) });
  checkTiling(cuts, 30);
  // The last two shots may be the halves of an over-long end card.
  const inner = lengths(cuts.slice(1, -2));
  assert.ok(inner.length > 0 && inner.every((d) => d === 2), JSON.stringify(inner));
});

test("hype cuts every 2 beats, with a quick double cut on a strong beat", () => {
  const cuts = cutPoints({ grid: grid120(30), energy: 0.9, lengthSec: 30, rnd: mulberry32(1) });
  checkTiling(cuts, 30);
  const inner = lengths(cuts.slice(1, -2));
  assert.ok(inner.every((d) => d === 1 || d === 0.5), JSON.stringify(inner));
  assert.ok(inner.filter((d) => d === 1).length > inner.filter((d) => d === 0.5).length, "most shots are 2 beats");
  // Beat 8 (4.2 s) is strong: one beat to the next cut, then one more back on the 2-beat step.
  const at = (t) => cuts.find((c) => Math.abs(c.start - t) < 1e-6);
  assert.equal(at(4.2)?.end, 4.7, JSON.stringify(cuts.slice(0, 6)));
  assert.equal(at(4.7)?.end, 5.2, JSON.stringify(cuts.slice(0, 6)));
  assert.ok(cuts.some((c) => c.strong), "the strong beats are marked");
});

test("maxShots spaces the cuts so a few photos are not repeated over and over", () => {
  for (const energy of [0.1, 0.5, 0.9]) {
    const cuts = cutPoints({ grid: grid120(), energy, lengthSec: 15, rnd: mulberry32(1), maxShots: 8 });
    checkTiling(cuts, 15);
    assert.ok(cuts.length <= 8, `energy ${energy}: ${cuts.length} shots ${JSON.stringify(lengths(cuts))}`);
  }
});

test("without maxShots, a hype 15 s Moment still cuts no faster than every 2 beats on average", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  // 2 beats at 120 BPM is 1 s, so at most 15 shots (13 here: the end card takes 3 s).
  assert.ok(cuts.length <= 15, `${cuts.length} shots`);
});

test("a long Moment with few photos keeps its cuts on the beat and Energy still matters", () => {
  // 60 s from 3 photos: maxShots 6 is below what MAX_SHOT allows, so shots run near MAX_SHOT, on beats.
  const grid = grid120(60);
  const beatTimes = new Set(grid.marks.map((m) => m.t));
  const counts = [0.1, 0.5, 0.9].map((energy) => {
    const cuts = cutPoints({ grid, energy, lengthSec: 60, rnd: mulberry32(2), maxShots: 6 });
    checkTiling(cuts, 60);
    // Without maxShots this is 21-59 shots; with it, about 3 s each (MAX_SHOT bounds the rest).
    assert.ok(cuts.length <= 20, `energy ${energy}: ${cuts.length} shots`);
    for (const c of cuts.slice(1)) assert.ok(beatTimes.has(c.start), `energy ${energy}: cut at ${c.start} is off the beat`);
    if (energy < 0.67) for (const c of cuts.slice(1)) assert.ok(c.downbeat, `energy ${energy}: cut at ${c.start} is off the bar`);
    return cuts.length;
  });
  assert.ok(new Set(counts).size > 1, `Energy still changes the edit: ${JSON.stringify(counts)}`);
});

test("maxShots also spaces a voice Moment's phrase cuts and an even pulse", () => {
  const pauses = Array.from({ length: 40 }, (_, i) => ({ start: 1.4 + i * 1.5, end: 1.6 + i * 1.5 }));
  for (const [label, grid] of [["pauses", pauseGrid(pauses, 60)], ["pulse", pulseGrid(60)]]) {
    for (const energy of [0.1, 0.5, 0.9]) {
      const cuts = cutPoints({ grid, energy, lengthSec: 60, rnd: mulberry32(1), maxShots: 6 });
      checkTiling(cuts, 60);
      // Without maxShots: 39 phrase cuts, 29 pulse cuts.
      assert.ok(cuts.length <= 20, `${label} @${energy}: ${cuts.length} shots`);
    }
  }
});

test("the end card holds at least END_CARD_MIN and at most MAX_SHOT, at every energy and tempo", () => {
  for (const period of [0.4, 0.5, 0.75, 0.9]) {
    const beats = [];
    for (let t = 0.1; t < 70; t += period) beats.push(Math.round(t * 1000) / 1000);
    const grid = beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8, 24], period });
    for (const energy of [0.1, 0.5, 0.9]) {
      for (const len of [15, 30, 60]) {
        const cuts = cutPoints({ grid, energy, lengthSec: len, rnd: mulberry32(3), maxShots: 8 });
        checkTiling(cuts, len);
      }
    }
  }
});

test("a pulse grid cuts every 2 s and every cut is a downbeat", () => {
  const cuts = cutPoints({ grid: pulseGrid(15), energy: 0.5, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  assert.ok(cuts.every((c) => c.downbeat));
});

test("a pause grid cuts in the voice's gaps and splits long phrases by energy", () => {
  const grid = pauseGrid([{ start: 2.9, end: 3.1 }, { start: 9.8, end: 10.2 }], 15);
  const calm = cutPoints({ grid, energy: 0.1, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(calm, 15);
  assert.ok(calm.some((c) => Math.abs(c.start - 3) < 1e-6));
  assert.ok(calm.some((c) => Math.abs(c.start - 10) < 1e-6));
  const hype = cutPoints({ grid, energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  assert.ok(hype.slice(0, -1).every((c) => c.end - c.start <= 2 + 1e-9), JSON.stringify(hype));
  assert.ok(hype.length > calm.length, "hype still cuts more than calm");
});

test("the same seed gives the same cuts", () => {
  const a = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  const b = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  assert.deepEqual(a, b);
});

const r3 = (n) => Math.round(n * 1000) / 1000;

test("a snapped split never leaves an end card under END_CARD_MIN", () => {
  // 69.2 BPM, first beat at 0.448 s, bar downbeats at beat indexes 2 mod 4.
  const period = 60 / 69.2;
  const beats = [];
  for (let i = 0; 0.448 + i * period < 48.496; i += 1) beats.push(0.448 + i * period);
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 2);
  const grid = beatGridOf({ beats, downbeats, strong: [], period });
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const cuts = cutPoints({ grid, energy: 0.045, lengthSec: 48.496, rnd: mulberry32(seed) });
    checkTiling(cuts, 48.496);
    assert.ok(cuts.at(-1).end - cuts.at(-1).start >= END_CARD_MIN - 1e-9, `seed ${seed}`);
  }
});

test("cut times are 3-decimal even when the beat times are not", () => {
  // Deterministic sweep over tempos, offsets and lengths with 6-decimal beat times.
  const rng = mulberry32(42);
  for (let k = 0; k < 300; k += 1) {
    const period = 0.4 + rng() * 0.6;
    const offset = rng() * 0.5;
    const len = r3(10 + rng() * 50);
    const energy = [0.1, 0.5, 0.9][Math.floor(rng() * 3)];
    const beats = [];
    for (let i = 0; offset + i * period < len + 5; i += 1) beats.push(Number((offset + i * period).toFixed(6)));
    const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
    const grid = beatGridOf({ beats, downbeats, strong: [8, 24], period });
    for (const seed of [1, 2]) {
      const cuts = cutPoints({ grid, energy, lengthSec: len, rnd: mulberry32(seed) });
      checkTiling(cuts, len);
      for (const c of cuts) {
        assert.equal(c.start, r3(c.start), `k ${k} seed ${seed} start ${c.start}`);
        assert.equal(c.end, r3(c.end), `k ${k} seed ${seed} end ${c.end}`);
      }
    }
  }
});

test("beat and pause marks are sorted by time", () => {
  const beatGrid = beatGridOf({ beats: [1.0, 0.5, 0.75], downbeats: [0], strong: [1], period: 0.25 });
  assert.deepEqual(beatGrid.marks.map((m) => m.t), [0.5, 0.75, 1.0]);
  assert.deepEqual(beatGrid.marks.map((m) => m.downbeat), [false, false, true]);
  // Strong index 1 is the beat at 0.5 s, which now sorts first.
  assert.deepEqual(beatGrid.marks.map((m) => m.strong), [true, false, false]);
  const pauses = pauseGrid([{ start: 1, end: 5 }, { start: 2, end: 2.2 }], 10);
  assert.deepEqual(pauses.marks.map((m) => m.t), [2.1, 3]);
});

test("overlapping pauses still give contiguous, in-range shots", () => {
  const grid = pauseGrid([{ start: 1, end: 5 }, { start: 2, end: 2.2 }], 10);
  for (const energy of [0.1, 0.5, 0.9]) {
    const cuts = cutPoints({ grid, energy, lengthSec: 10, rnd: mulberry32(1) });
    checkTiling(cuts, 10);
  }
});

test("a fractional lengthSec is rounded to 3 decimals", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.5, lengthSec: 15.0004, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
});

test("a Moment shorter than the end card plus a shot is one shot", () => {
  for (const energy of [0.1, 0.5, 0.9]) {
    for (const len of [1.7, 1.8, 3.2]) {
      const cuts = cutPoints({ grid: grid120(), energy, lengthSec: len, rnd: mulberry32(1) });
      assert.deepEqual(cuts, [{ start: 0, end: len, downbeat: true, strong: false }]);
    }
  }
});
