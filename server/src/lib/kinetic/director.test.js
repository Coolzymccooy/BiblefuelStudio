import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, findHooks, planPhrases, EFFECT_IDS } from "./director.js";

const P = (text, start) => ({ text, start, end: start + 1.2, words: text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.2, end: start + i * 0.2 + 0.2 })) });
const song = [
  P("After the rain", 0), P("Five in the morning", 1.5), P("Who still dey", 7), P("I still dey", 8.4),
  P("By his grace", 9.8), P("I still dey!", 11.2), P("From Lagos traffic to the last train home", 13), P("I STILL DEY", 20),
];

test("the PRNG is deterministic per seed", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const xs = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], xs);
  assert.notDeepEqual([c(), c(), c()], xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test("a line sung two or more times is a hook, ignoring case and punctuation", () => {
  assert.deepEqual([...findHooks(song)].sort((a, b) => a - b), [3, 5, 7]);
});

test("same seed, same plan; another seed, another plan", () => {
  const a = planPhrases({ phrases: song, energy: "wild", seed: 7, slotCount: 5 });
  const b = planPhrases({ phrases: song, energy: "wild", seed: 7, slotCount: 5 });
  assert.deepEqual(a.map((p) => [p.effect, p.slot, p.rot]), b.map((p) => [p.effect, p.slot, p.rot]));
  const others = [1, 2, 3, 4, 5].map((s) => JSON.stringify(planPhrases({ phrases: song, energy: "wild", seed: s, slotCount: 5 }).map((p) => [p.effect, p.slot])));
  assert.ok(new Set(others).size > 1, "different seeds give different plans");
});

test("rules: no repeat except pop, slams spaced 4 s, long lines never slam, slots never repeat", () => {
  for (const energy of ["wild", "lively"]) {
    for (let seed = 1; seed <= 50; seed += 1) {
      const plan = planPhrases({ phrases: song, energy, seed, slotCount: 5 });
      let lastSlamEnd = -Infinity;
      plan.forEach((p, i) => {
        if (i > 0 && p.effect !== "pop") {
          assert.notEqual(p.effect, plan[i - 1].effect, `${energy} seed ${seed}: back-to-back ${p.effect}`);
        }
        if (p.effect === "slam") {
          assert.ok(p.phrase.text.split(/\s+/).length <= 4);
          assert.ok(p.phrase.start - lastSlamEnd >= 4, `${energy} seed ${seed}: slams too close`);
          lastSlamEnd = p.phrase.end;
        }
        if (i > 0) assert.notEqual(p.slot, plan[i - 1].slot);
        assert.ok(Number.isInteger(p.rot) && Math.abs(p.rot) <= 4);
      });
    }
  }
});

test("an override on one phrase leaves every other phrase's slot and rot unchanged", () => {
  const base = planPhrases({ phrases: song, energy: "wild", seed: 3, slotCount: 5 });
  const over = planPhrases({ phrases: song, energy: "wild", seed: 3, slotCount: 5, overrides: { 0: "pop" } });
  for (let i = 1; i < song.length; i += 1) {
    assert.equal(over[i].slot, base[i].slot, `slot of phrase ${i}`);
    assert.equal(over[i].rot, base[i].rot, `rot of phrase ${i}`);
  }
});

test("null overrides are tolerated and a NaN slotCount puts every phrase in slot 0", () => {
  assert.doesNotThrow(() => planPhrases({ phrases: song, energy: "wild", seed: 1, overrides: null }));
  const plan = planPhrases({ phrases: song, energy: "wild", seed: 1, slotCount: NaN });
  assert.ok(plan.every((p) => p.slot === 0));
});

test("seed 0 is a valid seed distinct from seed 1", () => {
  const key = (seed) => JSON.stringify(planPhrases({ phrases: song, energy: "wild", seed, slotCount: 5 }).map((p) => [p.effect, p.slot]));
  assert.notEqual(key(0), key(1));
});

test("calm never slams; lively slams only hooks", () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    assert.ok(planPhrases({ phrases: song, energy: "calm", seed, slotCount: 5 }).every((p) => p.effect !== "slam"));
    planPhrases({ phrases: song, energy: "lively", seed, slotCount: 5 }).forEach((p) => {
      if (p.effect === "slam") assert.equal(p.hook, true);
    });
  }
});

test("wild actually slams: at least 1.5 slams per plan on average", () => {
  let slams = 0;
  for (let seed = 1; seed <= 50; seed += 1) {
    slams += planPhrases({ phrases: song, energy: "wild", seed, slotCount: 5 }).filter((p) => p.effect === "slam").length;
  }
  assert.ok(slams / 50 >= 1.5, `average slams ${slams / 50}`);
});

test("an override wins over every rule; unknown overrides are ignored", () => {
  const plan = planPhrases({ phrases: song, energy: "calm", seed: 1, slotCount: 5, overrides: { 0: "slam", 1: "explode" } });
  assert.equal(plan[0].effect, "slam");
  assert.notEqual(plan[1].effect, "explode");
});

const long = Array.from({ length: 40 }, (_, i) => P(i % 4 === 3 ? "Hold my hand" : `Line ${i} of the song`, i * 3));

test("every effect has an id the overrides accept", () => {
  assert.deepEqual([...EFFECT_IDS].sort(), ["curve", "frame", "pop", "quote", "slam", "stack", "title"]);
});

test("calm keeps to pops and stacks; lively adds quotes and curves but never frames or titles", () => {
  const seen = { calm: new Set(), lively: new Set() };
  for (let seed = 1; seed <= 50; seed += 1) {
    for (const energy of ["calm", "lively"]) {
      planPhrases({ phrases: long, energy, seed, slotCount: 5 }).forEach((p) => seen[energy].add(p.effect));
    }
  }
  assert.deepEqual([...seen.calm].sort(), ["pop", "stack"]);
  for (const e of ["quote", "curve"]) assert.ok(seen.lively.has(e), `lively uses ${e}`);
  for (const e of ["frame", "title"]) assert.ok(!seen.lively.has(e), `lively never uses ${e}`);
});

test("frames go only on hooks, at most once per 30 s; curves at most once per 20 s", () => {
  let frames = 0;
  for (const energy of ["wild", "lively"]) {
    for (let seed = 1; seed <= 50; seed += 1) {
      let lastFrame = -Infinity;
      let lastCurve = -Infinity;
      planPhrases({ phrases: long, energy, seed, slotCount: 5 }).forEach((p) => {
        if (p.effect === "frame") {
          frames += 1;
          assert.equal(p.hook, true, `${energy} seed ${seed}: frame on a non-hook`);
          assert.ok(p.phrase.start - lastFrame >= 30, `${energy} seed ${seed}: frames too close`);
          lastFrame = p.phrase.start;
        }
        if (p.effect === "curve") {
          assert.ok(p.phrase.start - lastCurve >= 20, `${energy} seed ${seed}: curves too close`);
          lastCurve = p.phrase.start;
        }
      });
    }
  }
  assert.ok(frames > 0, "wild does frame its hooks");
});

test("a wild video opens on its first line as a title, unless a title card is given", () => {
  assert.equal(planPhrases({ phrases: song, energy: "wild", seed: 1 })[0].effect, "title");
  assert.notEqual(planPhrases({ phrases: song, energy: "wild", seed: 1, titleFirst: false })[0].effect, "title");
  assert.notEqual(planPhrases({ phrases: song, energy: "lively", seed: 1 })[0].effect, "title");
  const longFirst = [P("From Lagos traffic to the last train home", 0), ...song.slice(1)];
  assert.notEqual(planPhrases({ phrases: longFirst, energy: "wild", seed: 1 })[0].effect, "title");
});
