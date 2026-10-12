import { test } from "node:test";
import assert from "node:assert/strict";
import { directMoment, assignPhotos, placeCaptions, TITLE_MAX, STATEMENT_MAX, STATEMENT_LIMITS } from "./director.js";
import { beatGridOf, pulseGrid, cutPoints } from "./cuts.js";
import { mulberry32 } from "../kinetic/director.js";
import { STYLES } from "./styles.js";
import { validatePlan } from "./plan.js";
import { getEffect } from "./effects/index.js";

function grid120(len) {
  const beats = [];
  for (let t = 0.2; t < len; t += 0.5) beats.push(Math.round(t * 1000) / 1000);
  return beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8, 16, 40], period: 0.5 });
}
const tall = (n) => Array.from({ length: n }, () => ({ shape: "tall" }));
const base = (over = {}) => ({
  photos: tall(6), heroIndex: 0, grid: grid120(30), title: "HAPPY 40TH, TOLU",
  statements: ["40 years of grace", "Still rising", "Favour looks good on you", "Celebrate!"],
  styleId: "celebrate", energy: 0.8, lengthSec: 30, seed: 11, ...over,
});

test("the plan validates", () => {
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    for (const energy of [0.1, 0.5, 0.9]) {
      const { plan } = directMoment(base({ styleId, energy }));
      const r = validatePlan(plan, { photoCount: 6 });
      assert.equal(r.ok, true, `${styleId}@${energy}: ${JSON.stringify(r.errors)}`);
    }
  }
});

test("the same seed gives the same plan; another seed gives another", () => {
  assert.deepEqual(directMoment(base()).plan, directMoment(base()).plan);
  assert.notDeepEqual(directMoment(base()).plan.shots, directMoment(base({ seed: 12 })).plan.shots);
});

test("no move or entrance repeats on consecutive shots", () => {
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    const { plan } = directMoment(base({ styleId, energy: 0.9, lengthSec: 60, grid: grid120(60) }));
    for (let i = 1; i < plan.shots.length; i += 1) {
      assert.notEqual(plan.shots[i].move.id, plan.shots[i - 1].move.id, `${styleId} move at ${i}`);
      assert.notEqual(plan.shots[i].entrance.id, plan.shots[i - 1].entrance.id, `${styleId} entrance at ${i}`);
    }
  }
});

test("strong effects only land on downbeats or strong beats", () => {
  const { plan } = directMoment(base({ styleId: "hype", energy: 0.9 }));
  const grid = grid120(30);
  const hits = new Set(grid.marks.filter((m) => m.downbeat || m.strong).map((m) => m.t));
  plan.shots.slice(1).forEach((s) => {
    const strong = getEffect(s.move.id).strong || getEffect(s.entrance.id).strong;
    if (strong) assert.ok(hits.has(s.start), `strong effect at ${s.start}`);
  });
});

test("the hero opens and closes; the end card carries its overlay", () => {
  const { plan } = directMoment(base({ heroIndex: 3 }));
  assert.equal(plan.shots[0].photo, 3);
  assert.equal(plan.shots[0].role, "open");
  assert.equal(plan.shots.at(-1).photo, 3);
  assert.equal(plan.shots.at(-1).role, "end");
  assert.deepEqual(plan.shots.at(-1).overlays, [{ id: "rayBurst" }]);
  assert.equal(plan.shots[0].entrance.id, "cut");
});

test("the same photo never appears in consecutive shots, even with 3 photos for 60 s of hype", () => {
  const { plan } = directMoment(base({ photos: tall(3), energy: 0.95, lengthSec: 60, grid: grid120(60), styleId: "hype" }));
  for (let i = 1; i < plan.shots.length; i += 1) assert.notEqual(plan.shots[i].photo, plan.shots[i - 1].photo, `at ${i}`);
});

test("too many photos: the user's order is kept and the extras dropped from the end", () => {
  const { sequence, dropped } = assignPhotos(10, 0, 6);
  assert.deepEqual(sequence, [0, 1, 2, 3, 4, 0]);
  assert.equal(dropped, 5);
});

test("wide photos only get pan or a split", () => {
  const photos = [{ shape: "tall" }, { shape: "wide" }, { shape: "tall" }, { shape: "wide" }];
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    const { plan } = directMoment(base({ photos, styleId }));
    for (const s of plan.shots) {
      if (photos[s.photo].shape === "wide") assert.ok(getEffect(s.move.id).shapes.includes("wide"), `${styleId}: ${s.move.id}`);
    }
  }
});

test("open and end shots never use a split", () => {
  const { plan } = directMoment(base({ styleId: "hype" }));
  assert.ok(!plan.shots[0].move.id.startsWith("split"));
  assert.ok(!plan.shots.at(-1).move.id.startsWith("split"));
});

test("effects needing a capability we lack are never chosen", () => {
  const { plan } = directMoment(base({ capabilities: [] }));
  for (const s of plan.shots) {
    for (const id of [s.move.id, s.entrance.id, ...s.overlays.map((o) => o.id)]) {
      assert.deepEqual(getEffect(id).needs.filter((n) => n !== ""), []);
    }
  }
});

test("the title opens with the title effect; the last statement is on the end card", () => {
  const { plan } = directMoment(base());
  assert.equal(plan.captions[0].text, "HAPPY 40TH, TOLU");
  assert.equal(plan.captions[0].effect, "title");
  const endStart = plan.shots.at(-1).start;
  assert.equal(plan.captions.at(-1).text, "Celebrate!");
  assert.ok(plan.captions.at(-1).start >= endStart);
});

test("statements start near a downbeat shot and never overlap", () => {
  const { plan } = directMoment(base({ energy: 0.5 }));
  const shotStarts = plan.shots.map((s) => s.start);
  for (let i = 1; i < plan.captions.length; i += 1) {
    assert.ok(plan.captions[i].start >= plan.captions[i - 1].end - 1e-9);
    assert.ok(shotStarts.some((t) => plan.captions[i].start - t >= 0 && plan.captions[i].start - t <= 0.2), `caption ${i}`);
  }
});

// Fix round 1: spec section 6.4 wins over the brief. A caption's words are placed by `end`
// but stay up (holdUntil) until the next caption starts; the last one holds to the end.
test("captions reveal within their words and hold until the next caption starts", () => {
  const caps = placeCaptions({
    cuts: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 8 }, { start: 8, end: 10 }],
    title: "Hi", statements: ["one two three", "end"], period: 0.5,
  });
  assert.equal(caps.length, 3);
  caps.forEach((c, i) => {
    assert.equal(c.holdUntil, i + 1 < caps.length ? caps[i + 1].start : 10, `caption ${i}`);
    assert.ok(c.holdUntil >= c.end);
    assert.ok(c.reveal > 0 && c.reveal <= c.end - c.start);
  });
});

test("a lone title holds until the end of the Moment", () => {
  const { plan } = directMoment(base({ statements: [] }));
  assert.equal(plan.captions.length, 1);
  assert.equal(plan.captions[0].holdUntil, plan.durationSec);
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
});

test("in a plan, the title holds until the first statement and the last caption to durationSec", () => {
  const { plan } = directMoment(base({ energy: 0.5 }));
  assert.equal(plan.captions[0].holdUntil, plan.captions[1].start);
  assert.equal(plan.captions.at(-1).holdUntil, plan.durationSec);
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
});

test("statements start on the first downbeat shot of their group, else the group's first shot", () => {
  const cut = (i, downbeat) => ({ start: i * 2, end: i * 2 + 2, downbeat });
  const cutsWith = (downs) => Array.from({ length: 8 }, (_, i) => cut(i, downs.includes(i)));
  // title "T": slots 2..6, two body statements: groups [2,3] and [4,5,6].
  const starts = (downs) => placeCaptions({ cuts: cutsWith(downs), title: "T", statements: ["a", "b", "end"], period: 0.5 })
    .slice(1, 3).map((c) => c.start);
  assert.deepEqual(starts([3, 5]), [6.05, 10.05]);
  assert.deepEqual(starts([2, 4]), [4.05, 8.05]);
  assert.deepEqual(starts([]), [4.05, 8.05]);
});

test("in a real plan every body statement starts 0.05 s into a downbeat shot", () => {
  for (const seed of [3, 11, 12, 40]) {
    const input = base({ energy: 0.5, seed });
    const { plan } = directMoment(input);
    const cuts = cutPoints({ grid: input.grid, energy: 0.5, lengthSec: 30, rnd: mulberry32(seed) });
    plan.captions.slice(1, -1).forEach((c, i) => {
      const hit = cuts.find((k) => Math.abs(k.start + 0.05 - c.start) < 1e-9);
      assert.ok(hit, `seed ${seed} caption ${i} starts on a shot`);
      assert.ok(hit.downbeat, `seed ${seed} caption ${i} starts on a downbeat shot`);
    });
  }
});

test("words are capped per length: the first N statements, the Nth on the end card", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  const long = directMoment(base({ statements: twelve, lengthSec: 60, grid: grid120(60), energy: 0.9 }));
  assert.equal(validatePlan(long.plan, { photoCount: 6 }).ok, true);
  assert.equal(long.plan.captions.length, 1 + 8);
  assert.equal(long.plan.captions.at(-1).text, "line 8");

  const five = ["s1", "s2", "s3", "s4", "s5"];
  const short = directMoment(base({ statements: five, lengthSec: 15, grid: grid120(15), energy: 0.5 }));
  assert.equal(validatePlan(short.plan, { photoCount: 6 }).ok, true);
  assert.deepEqual(short.plan.captions.map((c) => c.text), ["HAPPY 40TH, TOLU", "s1", "s2", "s3"]);
  assert.ok(short.plan.captions.at(-1).start >= short.plan.shots.at(-1).start);
});

test("the per-length limit for other lengths is the nearest at or below, minimum 3", () => {
  const many = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  const count = (lengthSec) => directMoment(base({
    statements: many, lengthSec, grid: grid120(lengthSec), energy: 0.9, title: "",
  })).plan.captions.length;
  assert.equal(count(10), 3);
  assert.equal(count(20), 3);
  assert.equal(count(45), 5);
});

test("an over-long title and statement are truncated to 40 and 60 characters", () => {
  const { plan } = directMoment(base({
    title: `  ${"T".repeat(70)}  `,
    statements: ["  short one  ", "x".repeat(80)],
    lengthSec: 15, grid: grid120(15), energy: 0.5,
  }));
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
  assert.equal(plan.captions[0].text, "T".repeat(40));
  assert.equal(plan.captions.at(-1).text, "x".repeat(60));
  assert.equal(plan.captions[1].text, "short one");
});

test("no statements and no title gives no captions", () => {
  const { plan } = directMoment(base({ title: "", statements: [] }));
  assert.deepEqual(plan.captions, []);
});

test("a pulse grid (no music) still makes a valid plan", () => {
  const { plan } = directMoment(base({ grid: pulseGrid(15), lengthSec: 15 }));
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
});

const MIXED = ["tall", "wide", "tall", "wide", "wide", "tall"].map((shape) => ({ shape }));
const WIDE_ONLY = Array.from({ length: 4 }, () => ({ shape: "wide" }));
const STYLE_IDS = ["glow", "celebrate", "hype", "gallery"];
const TWELVE = Array.from({ length: 12 }, (_, i) => `line number ${i + 1}`);

test("every seed, style, energy, length and photo set gives a valid, reproducible plan", () => {
  const photoSets = { tall: tall(6), mixed: MIXED, wide: WIDE_ONLY };
  for (const [setName, photos] of Object.entries(photoSets)) {
    for (const lengthSec of [15, 30, 60]) {
      const grids = { beats: grid120(lengthSec), pulse: pulseGrid(lengthSec) };
      for (const [gridName, grid] of Object.entries(grids)) {
        for (const styleId of STYLE_IDS) {
          for (const energy of [0.1, 0.5, 0.9]) {
            for (let seed = 1; seed <= 30; seed += 1) {
              const input = base({ photos, grid, lengthSec, styleId, energy, seed, statements: TWELVE });
              const { plan } = directMoment(input);
              const label = `${setName} ${gridName} ${styleId}@${energy} ${lengthSec}s seed ${seed}`;
              const r = validatePlan(plan, { photoCount: photos.length });
              assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.errors)}`);
              assert.deepEqual(directMoment(input).plan, plan, `${label} is not reproducible`);
            }
          }
        }
      }
    }
  }
});

test("glow and celebrate never get a split, whatever the photos", () => {
  for (const styleId of ["glow", "celebrate"]) {
    for (const photos of [MIXED, WIDE_ONLY]) {
      for (const energy of [0, 0.5, 1]) {
        for (let seed = 1; seed <= 30; seed += 1) {
          const { plan } = directMoment(base({ photos, styleId, energy, seed }));
          for (const s of plan.shots) {
            assert.ok(!s.move.id.startsWith("split"), `${styleId}@${energy} seed ${seed}: ${s.move.id}`);
          }
        }
      }
    }
  }
});

test("with mixed photos no move repeats back to back unless two wide photos leave no alternative", () => {
  for (const styleId of STYLE_IDS) {
    const hasSplit = Object.keys(STYLES[styleId].moves).some((m) => m.startsWith("split"));
    for (const lengthSec of [15, 30, 60]) {
      for (const energy of [0.5, 0.9]) {
        for (let seed = 1; seed <= 30; seed += 1) {
          const input = base({ photos: MIXED, styleId, energy, seed, lengthSec, grid: grid120(lengthSec) });
          const { plan } = directMoment(input);
          const cuts = cutPoints({ grid: input.grid, energy, lengthSec, rnd: mulberry32(seed) });
          for (let i = 1; i < plan.shots.length; i += 1) {
            const [a, b] = [plan.shots[i - 1], plan.shots[i]];
            if (a.move.id !== b.move.id) continue;
            const bothWide = MIXED[a.photo].shape === "wide" && MIXED[b.photo].shape === "wide";
            const splitPossible = hasSplit && b.role === "body" && (cuts[i].downbeat || cuts[i].strong);
            assert.ok(bothWide && b.move.id === "pan" && !splitPossible,
              `${styleId}@${energy} ${lengthSec}s seed ${seed}: ${b.move.id} repeats at shot ${i}`);
          }
        }
      }
    }
  }
});

test("dropped is the number of photos the plan never uses", () => {
  for (const energy of [0.1, 0.5, 0.9]) {
    for (const seed of [1, 2, 3]) {
      const photos = Array.from({ length: 20 }, () => ({ shape: "tall" }));
      const { plan, dropped } = directMoment(base({ photos, lengthSec: 15, grid: grid120(15), energy, seed }));
      const used = new Set(plan.shots.map((s) => s.photo));
      // Calm and medium cut few shots in 15 s, so photos are left out; hype has enough shots for all 20.
      if (energy < 0.9) assert.ok(dropped > 0, `energy ${energy} drops some`);
      assert.equal(dropped, 20 - used.size, `energy ${energy} seed ${seed}`);
      assert.equal(validatePlan(plan, { photoCount: 20 }).ok, true);
    }
  }
});

test("a tall photo is never panned: its 9:16 window is the whole picture, so pan would be a frozen shot", () => {
  for (const lengthSec of [15, 30, 60]) {
    for (const styleId of STYLE_IDS) {
      for (const energy of [0, 0.5, 1]) {
        for (let seed = 1; seed <= 30; seed += 1) {
          const { plan } = directMoment(base({ photos: tall(6), styleId, energy, seed, lengthSec, grid: grid120(lengthSec) }));
          for (const [i, s] of plan.shots.entries()) {
            assert.notEqual(s.move.id, "pan", `${styleId}@${energy} ${lengthSec}s seed ${seed} shot ${i}`);
          }
        }
      }
    }
  }
});

function gridEvery(len, step) {
  const beats = [];
  for (let t = 0.2; t < len; t += step) beats.push(Math.round(t * 1000) / 1000);
  return beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8, 16, 40], period: step });
}

test("the title stays up for 2.5 s of shots, even when high Energy cuts every half second", () => {
  for (const [name, step] of [["120 bpm", 0.5], ["fast", 0.35]]) {
    for (const lengthSec of [15, 30, 60]) {
      for (const styleId of STYLE_IDS) {
        for (const energy of [0, 0.5, 1]) {
          for (let seed = 1; seed <= 30; seed += 1) {
            const input = base({ photos: tall(6), styleId, energy, seed, lengthSec, grid: gridEvery(lengthSec, step) });
            const { plan } = directMoment(input);
            const label = `${name} ${styleId}@${energy} ${lengthSec}s seed ${seed}`;
            const [title, ...rest] = plan.captions;
            assert.equal(title.effect, "title", label);
            assert.ok(title.holdUntil - title.start >= 2.2, `${label}: title holds ${title.holdUntil - title.start} s`);
            // The title shot ends at or after 2.5 s, and everything else starts after it.
            const titleShot = plan.shots.find((s) => s.end >= 2.5);
            assert.ok(title.end <= titleShot.end + 1e-9, label);
            for (const c of rest) assert.ok(c.start >= titleShot.end - 1e-9, `${label}: "${c.text}" starts inside the title`);
            assert.ok(plan.captions.at(-1).start >= plan.shots.at(-1).start, `${label}: last statement on the end card`);
            assert.ok(plan.captions.every((c) => c.start <= plan.durationSec - 0.3), `${label}: nothing starts in the last 0.3 s`);
            const r = validatePlan(plan, { photoCount: 6 });
            assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.errors)}`);
          }
        }
      }
    }
  }
});

test("the word limits are exported for the server to share", () => {
  assert.equal(TITLE_MAX, 40);
  assert.equal(STATEMENT_MAX, 60);
  assert.deepEqual(STATEMENT_LIMITS, { 15: 3, 30: 5, 60: 8 });
  assert.ok(Object.isFrozen(STATEMENT_LIMITS));
});
