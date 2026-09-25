import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expandScenesToBeats } from "./visualBeats.js";

const scene = (i, startMs, endMs) => ({
  id: `s${i}`, text: `scene ${i}`, imagePrompt: "", imageStatus: "done",
  imagePath: `/img/${i}.png`, imageUrl: `/outputs/genImg/p/part-${i}.png`, startMs, endMs,
});

describe("expandScenesToBeats", () => {
  test("returns the scenes untouched when no beat length is set", () => {
    const scenes = [scene(1, 0, 150_000), scene(2, 150_000, 300_000)];
    assert.equal(expandScenesToBeats(scenes, {}), scenes);
    assert.equal(expandScenesToBeats(scenes, { beatSec: 0 }), scenes);
    assert.equal(expandScenesToBeats(scenes, { beatSec: -5 }), scenes);
  });
  test("returns the scenes untouched when they are already shorter than a beat", () => {
    const scenes = [scene(1, 0, 20_000), scene(2, 20_000, 45_000)];
    assert.equal(expandScenesToBeats(scenes, { beatSec: 40 }), scenes);
  });
  test("splits a long run into ~beatSec beats that tile the whole duration contiguously", () => {
    const scenes = [scene(1, 0, 150_000), scene(2, 150_000, 300_000), scene(3, 300_000, 450_000)];
    const beats = expandScenesToBeats(scenes, { beatSec: 40 });
    // 450s / 40s ≈ 11 beats
    assert.equal(beats.length, 11);
    assert.equal(beats[0].startMs, 0);
    assert.equal(beats[beats.length - 1].endMs, 450_000);
    for (let i = 1; i < beats.length; i++) assert.equal(beats[i].startMs, beats[i - 1].endMs, "beats are contiguous");
    for (const b of beats) {
      const len = b.endMs - b.startMs;
      assert.ok(len >= 35_000 && len <= 45_000, `beat length ${len} stays close to beatSec`);
      assert.equal(b.imageStatus, "done");
    }
  });
  test("cycles through every scene image in order so no two neighbouring beats share an image", () => {
    const scenes = [scene(1, 0, 150_000), scene(2, 150_000, 300_000), scene(3, 300_000, 450_000)];
    const beats = expandScenesToBeats(scenes, { beatSec: 40 });
    assert.deepEqual(beats.slice(0, 6).map((b) => b.imagePath), ["/img/1.png", "/img/2.png", "/img/3.png", "/img/1.png", "/img/2.png", "/img/3.png"]);
    for (let i = 1; i < beats.length; i++) assert.notEqual(beats[i].imagePath, beats[i - 1].imagePath);
    // Every image gets used.
    assert.equal(new Set(beats.map((b) => b.imagePath)).size, 3);
  });
  test("beat ids are unique and derived from the source scene; text follows the image's scene", () => {
    const scenes = [scene(1, 0, 100_000), scene(2, 100_000, 200_000)];
    const beats = expandScenesToBeats(scenes, { beatSec: 40 });
    assert.equal(new Set(beats.map((b) => b.id)).size, beats.length);
    assert.match(beats[0].id, /^s1-b0$/);
    assert.equal(beats[1].text, "scene 2");
    assert.equal(beats[1].imageUrl, "/outputs/genImg/p/part-2.png");
  });
  test("never mutates the input scenes", () => {
    const scenes = [scene(1, 0, 100_000), scene(2, 100_000, 200_000)];
    const snapshot = JSON.stringify(scenes);
    expandScenesToBeats(scenes, { beatSec: 40 });
    assert.equal(JSON.stringify(scenes), snapshot);
  });
  test("a single-image project still gets beats (reframed dissolves) rather than one static frame", () => {
    const scenes = [scene(1, 0, 200_000)];
    const beats = expandScenesToBeats(scenes, { beatSec: 40 });
    assert.equal(beats.length, 5);
    assert.ok(beats.every((b) => b.imagePath === "/img/1.png"));
  });
});
