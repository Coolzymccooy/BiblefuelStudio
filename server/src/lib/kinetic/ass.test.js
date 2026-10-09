import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, phrasesFrom } from "./ass.js";
import { studioCaptionFilter } from "./filter.js";

const W = (text, start, step = 0.3) => text.split(" ").map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + step }));
const words = [...W("After the rain", 0), ...W("Who still dey", 2), ...W("I still dey", 3.5), ...W("By his grace", 5), ...W("I still dey", 6.5)];

test("nothing to draw gives an empty document and an empty filter", () => {
  assert.equal(buildAss({ words: [], w: 1280, h: 720, look: "studio-lagos-night" }), "");
  assert.deepEqual(studioCaptionFilter({ assPath: "/tmp/x.ass", words: [], w: 1280, h: 720 }), { filter: "", sideFiles: [] });
});

test("the document declares the frame and one Kinetic style, and has events for every phrase", () => {
  const ass = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 3 });
  assert.match(ass, /PlayResX: 1280\nPlayResY: 720/);
  assert.match(ass, /^Style: Kinetic,/m);
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(events.length >= phrasesFrom({ words }).length);
  for (const t of ["AFTER", "GRACE", "DEY"]) assert.ok(ass.includes(t), t);
});

test("lines without word timings still animate, words spread across the line", () => {
  const ph = phrasesFrom({ lines: [{ text: "The Lord is my shepherd", start: 1, end: 4 }] });
  assert.equal(ph.length, 1);
  assert.equal(ph[0].words.length, 5);
  assert.equal(ph[0].words[0].start, 1);
  assert.ok(ph[0].words[4].start < 4);
});

test("the same seed is reproducible; overrides reach the director", () => {
  const a = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 9 });
  assert.equal(buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 9 }), a);
  const forced = buildAss({ words, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 9, overrides: { 0: "slam" } });
  assert.ok(forced.includes("\\p1"), "a slam's sparks appear although calm never slams by itself");
});

test("the filter points ffmpeg at the file and the repo fonts, with Windows colons escaped", () => {
  const out = studioCaptionFilter({ assPath: "C:\\work\\job\\captions-x.ass", words, w: 1280, h: 720, look: "studio-clean-white" });
  assert.match(out.filter, /^ass=filename='C\\:\/work\/job\/captions-x\.ass':fontsdir='/);
  assert.equal(out.sideFiles.length, 1);
  assert.equal(out.sideFiles[0].path, "C:\\work\\job\\captions-x.ass");
  assert.match(out.sideFiles[0].text, /^\[Script Info\]/);
});
