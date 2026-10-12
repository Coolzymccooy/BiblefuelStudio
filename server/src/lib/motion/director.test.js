import { test } from "node:test";
import assert from "node:assert/strict";
import { directMoment, assignPhotos, placeCaptions } from "./director.js";
import { beatGridOf, pulseGrid } from "./cuts.js";
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

test("captions hold to their end and reveal within them", () => {
  const caps = placeCaptions({
    cuts: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 8 }, { start: 8, end: 10 }],
    title: "Hi", statements: ["one two three", "end"], period: 0.5,
  });
  for (const c of caps) {
    assert.equal(c.holdUntil, c.end);
    assert.ok(c.reveal > 0 && c.reveal <= c.end - c.start);
  }
});

test("no statements and no title gives no captions", () => {
  const { plan } = directMoment(base({ title: "", statements: [] }));
  assert.deepEqual(plan.captions, []);
});

test("a pulse grid (no music) still makes a valid plan", () => {
  const { plan } = directMoment(base({ grid: pulseGrid(15), lengthSec: 15 }));
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
});

test("every seed, style, energy and length gives a valid, reproducible plan", () => {
  const photoCount = 6;
  for (const lengthSec of [15, 30, 60]) {
    const grids = { beats: grid120(lengthSec), pulse: pulseGrid(lengthSec) };
    for (const [gridName, grid] of Object.entries(grids)) {
      for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
        for (const energy of [0.1, 0.5, 0.9]) {
          for (let seed = 1; seed <= 30; seed += 1) {
            const input = base({ photos: tall(photoCount), grid, lengthSec, styleId, energy, seed });
            const { plan } = directMoment(input);
            const label = `${gridName} ${styleId}@${energy} ${lengthSec}s seed ${seed}`;
            const r = validatePlan(plan, { photoCount });
            assert.equal(r.ok, true, `${label}: ${JSON.stringify(r.errors)}`);
            assert.deepEqual(directMoment(input).plan, plan, `${label} is not reproducible`);
          }
        }
      }
    }
  }
});
