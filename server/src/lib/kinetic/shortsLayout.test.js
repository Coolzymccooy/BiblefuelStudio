import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, EFFECTS, assHeader } from "./ass.js";
import { isTall, clampBlockY, slotsFor } from "./layout.js";

const W = 720;
const H = 1280;
const words = (text, t0) => text.split(" ").map((t, i) => ({ text: t, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.3 }));
const song = [
  ...words("Eh yeah eh yeah", 0.5), ...words("Dem say make I calm down", 3),
  ...words("Who talk say I no go shine", 8), ...words("My time no late my time no late", 12),
  ...words("Oya dance dance dance", 16), ...words("This one na celebration", 19),
];
const ys = (ass) => [...ass.matchAll(/\\(?:move\(-?\d+,-?\d+,-?\d+,|pos\(-?\d+,)(-?\d+)/g)].map((m) => Number(m[1]));

test("isTall covers tall and shorts", () => {
  assert.equal(isTall("tall"), true);
  assert.equal(isTall("shorts"), true);
  assert.equal(isTall("wide"), false);
});

test("shorts blocks are clamped into the safe band", () => {
  assert.equal(clampBlockY(50, 100, H, "shorts"), Math.ceil(H * 0.11 + 50));
  assert.equal(clampBlockY(1200, 100, H, "shorts"), Math.floor(H * 0.75 - 50));
  assert.equal(slotsFor("shorts").length, 3);
});

test("a shorts render keeps every text anchor inside 0.11h–0.75h", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const ass = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed, layout: "shorts" });
    const bad = ys(ass.split("\n").filter((l) => !/\\p1/.test(l) && !/\\clip/.test(l)).join("\n"))
      .filter((y) => y < H * 0.11 - 1 || y > H * 0.75 + 1);
    assert.deepEqual(bad, [], `seed ${seed}`);
  }
});

test("the default layout is unchanged", () => {
  const a = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed: 3 });
  const b = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed: 3, layout: "default" });
  assert.equal(a, b);
});

test("EFFECTS and assHeader are exported for lyric videos", () => {
  assert.deepEqual(Object.keys(EFFECTS).sort(), ["curve", "echo", "frame", "pop", "quote", "slam", "stack", "title"]);
  assert.match(assHeader(W, H), /PlayResX: 720\nPlayResY: 1280/);
});

test("every effect, forced on every phrase, stays inside the safe band in a shorts render", () => {
  for (const effect of Object.keys(EFFECTS)) {
    const overrides = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, effect]));
    const ass = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed: 2, layout: "shorts", overrides });
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    const text = lines.filter((l) => !/\\p1/.test(l) && !/\\clip/.test(l)).join("\n");
    assert.deepEqual(ys(text).filter((y) => y < H * 0.11 - 1 || y > H * 0.75 + 1), [], effect);
    // Clipped events (frame bands, quote underline) must be clipped inside the band too.
    for (const l of lines) {
      const c = l.match(/\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/);
      if (c) assert.ok(Number(c[2]) >= H * 0.11 - 1 && Number(c[4]) <= H * 0.75 + 1, `${effect} clip ${c[0]}`);
    }
  }
});

test("a shorts layout on a wide frame falls back to the wide layout", () => {
  const a = buildAss({ words: song, w: H, h: W, look: "studio-lagos-night", energy: "wild", seed: 3 });
  const b = buildAss({ words: song, w: H, h: W, look: "studio-lagos-night", energy: "wild", seed: 3, layout: "shorts" });
  assert.equal(a, b);
});
