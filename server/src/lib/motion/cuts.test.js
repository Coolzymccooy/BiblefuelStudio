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

test("medium cuts every 2 beats", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.5, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const inner = cuts.slice(1, -1).map((c) => Math.round((c.end - c.start) * 1000) / 1000);
  assert.ok(inner.every((d) => d === 1), JSON.stringify(inner));
});

test("hype cuts every beat", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const inner = cuts.slice(1, -1).map((c) => Math.round((c.end - c.start) * 1000) / 1000);
  assert.ok(inner.every((d) => d === 0.5), JSON.stringify(inner));
  assert.ok(cuts.some((c) => c.strong), "the strong beats are marked");
});

test("hype bursts split a strong beat in two when half a beat is long enough", () => {
  // 80 BPM: half a beat is 0.375 s, just over MIN_SHOT.
  const period = 0.75;
  const beats = [];
  for (let t = 0; t < 20; t += period) beats.push(Math.round(t * 1000) / 1000);
  const grid = beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8], period });
  const cuts = cutPoints({ grid, energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const at6 = cuts.find((c) => Math.abs(c.start - 6) < 1e-6);
  assert.ok(at6 && Math.abs(at6.end - 6.375) < 1e-6, JSON.stringify(cuts.slice(6, 10)));
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
  assert.ok(hype.slice(0, -1).every((c) => c.end - c.start <= 1.5 + 1e-9), JSON.stringify(hype));
});

test("the same seed gives the same cuts", () => {
  const a = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  const b = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  assert.deepEqual(a, b);
});
