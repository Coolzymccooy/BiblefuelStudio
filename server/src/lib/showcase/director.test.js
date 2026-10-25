import { test } from "node:test";
import assert from "node:assert/strict";
import { directShowcase } from "./director.js";
import { TEMPLATES } from "./templates.js";

const r3 = (n) => Math.round(n * 1000) / 1000;
/** A steady beat grid: a mark every `period` seconds up to `until`, every 4th a downbeat. */
function beatGrid(period = 0.6, until = 200) {
  const marks = [];
  for (let i = 1; i * period < until; i += 1) marks.push({ t: r3(i * period), downbeat: i % 4 === 0, strong: false });
  return { kind: "beats", marks, period };
}
const photos = (n, shape = "tall") => Array.from({ length: n }, (_, i) => ({ shape: i % 5 === 4 ? "wide" : shape }));
const base = (over = {}) => ({
  photos: photos(20), heroIndex: 0, grid: beatGrid(), title: "Men Hangout", statements: ["One", "Two", "Three"],
  styleId: "fellowship", energy: 0.5, lengthSec: 60, seed: 7, shape: "tall", details: {}, ...over,
});
const shown = (plan) => plan.scenes.flatMap((s) => s.photos);

test("the same input and seed make the same plan", () => {
  assert.deepEqual(directShowcase(base()), directShowcase(base()));
  assert.notDeepEqual(directShowcase(base()).plan.scenes, directShowcase(base({ seed: 8 })).plan.scenes);
});

test("scenes are contiguous on beats from 0 to the length", () => {
  const grid = beatGrid();
  const marks = new Set(grid.marks.map((m) => m.t));
  for (const lengthSec of [30, 60, 90, 120, 180]) {
    const { plan } = directShowcase(base({ lengthSec, photos: photos(60), grid }));
    assert.equal(plan.durationSec, lengthSec);
    assert.equal(plan.scenes[0].start, 0);
    assert.equal(plan.scenes.at(-1).end, lengthSec);
    plan.scenes.forEach((s, i) => {
      assert.ok(s.end > s.start, `scene ${i} has length`);
      if (i > 0) assert.equal(s.start, plan.scenes[i - 1].end, `scene ${i} follows on`);
      if (i > 0) assert.ok(marks.has(s.start), `scene ${i} starts on a beat (${s.start})`);
    });
  }
});

test("every photo once, in order, hero first, when they fit", () => {
  const { plan, dropped } = directShowcase(base({ photos: photos(40), heroIndex: 5, lengthSec: 120 }));
  const order = [5, ...Array.from({ length: 40 }, (_, i) => i).filter((i) => i !== 5)];
  assert.deepEqual(shown(plan).slice(0, 40), order);
  assert.equal(dropped, 0);
});

test("lots of photos for the time favour dense templates before dropping any", () => {
  const share = (n) => {
    const { plan, dropped } = directShowcase(base({ photos: photos(n), lengthSec: 30 }));
    const dense = plan.scenes.filter((s) => ["grid", "filmstrip"].includes(s.template)).length;
    return { share: dense / plan.scenes.length, dropped, used: new Set(shown(plan)).size };
  };
  const few = share(12);
  const many = share(100);
  assert.ok(many.share > few.share, `${many.share} > ${few.share}`);
  assert.equal(few.dropped, 0);
  assert.equal(many.dropped, 100 - many.used);
  assert.ok(many.dropped > 0);
});

test("never the same template twice running", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { plan } = directShowcase(base({ seed, lengthSec: 120, photos: photos(50) }));
    plan.scenes.forEach((s, i) => { if (i > 0) assert.notEqual(s.template, plan.scenes[i - 1].template, `seed ${seed} scene ${i}`); });
  }
});

test("opens on a single hero photo and closes on a finale, or an invite when the date reads", () => {
  const plain = directShowcase(base({ heroIndex: 3 })).plan;
  assert.equal(plain.scenes[0].template, "single");
  assert.deepEqual(plain.scenes[0].photos, [3]);
  assert.equal(plain.scenes.at(-1).template, "finale");
  assert.deepEqual(plain.scenes.at(-1).photos, [3]);
  assert.equal(plain.invite, null);
  assert.ok(plain.scenes.at(-1).end - plain.scenes.at(-1).start >= 3);
  const invite = directShowcase(base({ details: { date: "Saturday 21st November" } })).plan;
  assert.equal(invite.scenes.at(-1).template, "invite");
  assert.deepEqual(invite.invite, { month: 11, day: 21, label: "NOV" });
  assert.equal(invite.captions.at(-1).effect, "pop", "the closing words sit low, clear of the calendar card");
  assert.equal(plain.captions.at(-1).effect, undefined);
});

test("Energy changes how long scenes stay up", () => {
  const mean = (energy) => {
    const body = directShowcase(base({ energy, lengthSec: 120, photos: photos(60) })).plan.scenes.slice(1, -1);
    return body.reduce((a, s) => a + s.end - s.start, 0) / body.length;
  };
  assert.ok(mean(0.1) > mean(0.9), `${mean(0.1)} > ${mean(0.9)}`);
});

test("the shape sets the frame", () => {
  const tall = directShowcase(base()).plan;
  assert.deepEqual([tall.w, tall.h, tall.fps, tall.shape], [1080, 1920, 30, "tall"]);
  const wide = directShowcase(base({ shape: "wide" })).plan;
  assert.deepEqual([wide.w, wide.h, wide.shape], [1920, 1080, "wide"]);
  assert.equal(tall.beatSec, 0.6, "the beat the templates time their entrances to");
});

test("a grid that stops early still fills the length", () => {
  const grid = { kind: "beats", marks: beatGrid(0.5, 20).marks, period: 0.5 };
  const { plan } = directShowcase(base({ grid, lengthSec: 60 }));
  assert.equal(plan.scenes.at(-1).end, 60);
  plan.scenes.forEach((s, i) => { if (i > 0) assert.equal(s.start, plan.scenes[i - 1].end); });
  const pulse = directShowcase(base({ grid: { kind: "pulse", marks: [{ t: 2, downbeat: true, strong: false }], period: 2 }, lengthSec: 30 })).plan;
  assert.equal(pulse.scenes.at(-1).end, 30);
});

test("three photos over three minutes cycle without asking for more photos than exist", () => {
  const { plan, dropped } = directShowcase(base({ photos: photos(3), lengthSec: 180 }));
  assert.equal(dropped, 0);
  for (const s of plan.scenes) {
    assert.equal(s.photos.length, TEMPLATES[s.template].photos, s.template);
    assert.ok(s.photos.length <= 3);
    assert.equal(new Set(s.photos).size, s.photos.length, "no photo twice in one scene");
    for (const p of s.photos) assert.ok(p >= 0 && p < 3);
  }
});

test("captions: the title opens, the last statement sits on the closing scene", () => {
  const { plan } = directShowcase(base());
  assert.equal(plan.captions[0].effect, "title");
  assert.equal(plan.captions[0].text, "Men Hangout");
  const closing = plan.scenes.at(-1);
  const last = plan.captions.at(-1);
  assert.equal(last.text, "Three");
  assert.ok(last.start >= closing.start && last.start < closing.end);
});

test("statements past the length's limit are left out", () => {
  const many = Array.from({ length: 16 }, (_, i) => `Line ${i + 1}`);
  assert.equal(directShowcase(base({ statements: many, lengthSec: 30 })).plan.captions.length, 1 + 5);
  assert.equal(directShowcase(base({ statements: many, lengthSec: 180, photos: photos(80) })).plan.captions.length, 1 + 16);
});

test("flashes mark section changes only in styles that use them", () => {
  const fellowship = directShowcase(base({ lengthSec: 60 })).plan;
  assert.ok(fellowship.flashes.length > 0);
  for (const t of fellowship.flashes) assert.ok(fellowship.scenes.some((s) => s.start === t));
  assert.deepEqual(directShowcase(base({ styleId: "premiere" })).plan.flashes, []);
});

test("no template comes back within three scenes, even when dense ones are favoured", () => {
  for (const styleId of ["fellowship", "scrapbook", "partyPop", "premiere"]) {
    for (const [n, lengthSec] of [[24, 30], [100, 60], [40, 120]]) {
      const body = directShowcase(base({ styleId, photos: photos(n), lengthSec })).plan.scenes.slice(0, -1);
      body.forEach((s, i) => {
        if (i >= 2) assert.ok(s.template !== body[i - 1].template && s.template !== body[i - 2].template, `${styleId} ${n}@${lengthSec} scene ${i}`);
      });
    }
  }
});

test("only the style's own templates are used", () => {
  const { plan } = directShowcase(base({ styleId: "scrapbook", lengthSec: 120, photos: photos(60) }));
  const allowed = new Set(["polaroids", "single", "split", "triptych", "grid", "finale", "invite"]);
  for (const s of plan.scenes) assert.ok(allowed.has(s.template), s.template);
});
