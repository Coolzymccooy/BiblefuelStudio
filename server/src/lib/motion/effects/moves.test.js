import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { frameCount, anchoredXY } from "./common.js";
import { filterNames } from "../testkit.js";

const ctx = { w: 1080, h: 1920, fps: 30, frames: 45, dur: 1.5, prev: null };
const shot = (move, intensity = 0.5) => ({
  start: 0, end: 1.5, photo: 0, role: "body", move: { id: move, intensity }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 },
});
const MOVES = ["push", "punch", "shake", "still", "pan", "split2", "split3"];

test("every move is registered as a move", () => {
  assert.deepEqual(effectsOfKind("move").map((e) => e.id).sort(), [...MOVES].sort());
  for (const id of MOVES) assert.equal(getEffect(id).kind, "move");
});

test("getEffect ignores the prototype chain", () => {
  assert.equal(getEffect("constructor"), null);
  assert.equal(getEffect("__proto__"), null);
  assert.equal(getEffect("nope"), null);
});

for (const id of MOVES) {
  test(`${id} reads its input label, writes its output label, and uses only ffmpeg 5.1 filters`, () => {
    const g = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.length >= 1);
    assert.ok(g.some((s) => s.includes("[0:v]")), "reads the input");
    assert.ok(g.at(-1).endsWith("[mv]"), "ends at the output");
    for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  });
}

test("zoom moves make exactly the shot's frame count at the output size", () => {
  for (const id of ["push", "punch", "shake", "still"]) {
    const [g] = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.includes(":d=45:s=1080x1920:fps=30"), `${id}: ${g}`);
  }
});

test("a stronger push zooms further", () => {
  const z = (i) => getEffect("push").graph({ input: "[0:v]", output: "[mv]", shot: shot("push", i), ctx, tag: "m" })[0].match(/z='1\+([\d.]+)\*on/)[1];
  assert.ok(Number(z(1)) > Number(z(0)));
});

test("the zoom stays anchored where the faces are", () => {
  assert.deepEqual(anchoredXY({ x: 0.5, y: 0.38 }), { x: "(iw-iw/zoom)*0.500", y: "(ih-ih/zoom)*0.380" });
});

test("pan travels a 9:16 window across a wide photo", () => {
  const [g] = getEffect("pan").graph({ input: "[0:v]", output: "[mv]", shot: shot("pan"), ctx, tag: "m" });
  assert.match(g, /crop=w='ih\*1080\/1920':h=ih/);
  assert.match(g, /x='\(iw-ow\)\*\(0\.15\+0\.7\*t\/1\.500\)'/);
  assert.match(g, /scale=1080:1920/);
});

test("split panels crop to the panel's own shape, so wide photos are never squashed", () => {
  const g = getEffect("split3").graph({ input: "[0:v]", output: "[mv]", shot: shot("split3"), ctx, tag: "m" }).join(";");
  // Panel 1080x640: the crop keeps w:h = 1080:640 whichever side limits it.
  assert.match(g, /crop=w='min\(iw,ih\*1080\/640\)':h='min\(ih,iw\*640\/1080\)'/);
  assert.equal((g.match(/zoompan=/g) || []).length, 3);
});

test("only pan and the splits take wide photos", () => {
  const wide = MOVES.filter((id) => getEffect(id).shapes.includes("wide")).sort();
  assert.deepEqual(wide, ["pan", "split2", "split3"]);
});

test("splits are strong; zoom moves are not", () => {
  assert.equal(getEffect("split2").strong, true);
  assert.equal(getEffect("split3").strong, true);
  assert.equal(getEffect("push").strong, false);
});

test("frameCount tiles consecutive shots exactly", () => {
  const a = { start: 0, end: 0.517 };
  const b = { start: 0.517, end: 1.033 };
  assert.equal(frameCount(a, 30) + frameCount(b, 30), Math.round(1.033 * 30));
});
