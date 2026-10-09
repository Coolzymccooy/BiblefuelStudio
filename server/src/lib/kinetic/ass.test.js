import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, phrasesFrom } from "./ass.js";
import { studioCaptionFilter } from "./filter.js";
import { EFFECT_IDS } from "./director.js";

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
  // Curve draws one event per letter, so compare the visible text, not raw lines.
  const shown = events.map((l) => l.split(",").slice(9).join(",").replace(/\{[^}]*\}/g, "")).join("").replace(/\s+/g, "");
  for (const t of ["AFTER", "GRACE", "DEY"]) assert.ok(shown.includes(t), t);
});

test("a word carrying a carriage return cannot inject a Dialogue line", () => {
  const evil = "world.\rDialogue: 0,0:00:00.00,0:00:09.00,Kinetic,,0,0,0,,INJECTED\u0000";
  const make = (second) => [...W("hello", 0), { text: second, start: 0.3, end: 0.6 }, ...W("again now", 1)];
  // Same words with the control characters already turned into spaces: the phrase planner sees the same lengths.
  const clean = buildAss({ words: make(evil.replace(/[\x00-\x1f]/g, " ")), w: 1280, h: 720, look: "studio-lagos-night", energy: "lively", seed: 3 });
  const dirty = buildAss({ words: make(evil), w: 1280, h: 720, look: "studio-lagos-night", energy: "lively", seed: 3 });
  const count = (s) => (s.match(/^Dialogue:/gm) || []).length;
  assert.equal(count(dirty), count(clean));
  assert.ok(!dirty.includes("\r") && !dirty.includes("\u0000"));
  const lines = dirty.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(lines.every((l) => !/^Dialogue: 0,0:00:00\.00,0:00:09\.00,Kinetic,,0,0,0,,INJECTED/.test(l)), "the injected event is not a line of its own");
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

const lyric = [
  { text: "Fear thou not", start: 0, end: 1.5 }, { text: "I still dey", start: 2, end: 3.5 },
  { text: "By his grace", start: 4, end: 5.5 }, { text: "Hold my hand", start: 6, end: 7.5 },
];

/** Phrase 1's events: it starts at 2 s and phrase 2 at 4 s, so its events start in 2.00..3.99. */
const phraseOne = (ass) => ass.split("\n").filter((l) => /^Dialogue: \d+,0:00:0[23]\.\d\d,/.test(l));
const shownText = (l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
const HIT_FAMILY = "Knewave"; // Lagos Night's hit font

/** What each effect leaves in its events, and nothing else does. */
const FINGERPRINTS = {
  quote: (ev) => ev.some((l) => l.includes("\\t(0,350,\\clip(")),
  slam: (ev) => ev.some((l) => l.includes("\\p1") && !l.includes("\\clip")) && ev.some((l) => l.includes(`\\fn${HIT_FAMILY}`)),
  frame: (ev) => ev.filter((l) => l.includes("\\clip(")).length === 4,
  title: (ev) => ev.some((l) => l.startsWith("Dialogue: 2,")) && !ev.some((l) => l.includes("\\clip(")),
  curve: (ev) => ev.length >= 6 && ev.every((l) => l.includes("\\pos(") && l.includes("\\frz") && [...shownText(l)].length === 1),
  stack: (ev) => ev.some((l) => l.includes("\\move(") && /\\frz-?[1-9]/.test(l)),
  pop: (ev) => ev.some((l) => l.includes("\\move(")) && ev.filter((l) => l.includes("\\move(")).every((l) => l.includes("\\frz0\\")),
};

test("every effect id renders through buildAss, each with its own fingerprint", () => {
  const make = (overrides) => buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "calm", seed: 1, overrides });
  for (const effect of EFFECT_IDS) {
    const ass = make({ 1: effect });
    const events = phraseOne(ass);
    assert.ok(events.length, `${effect} draws phrase 1`);
    assert.ok(FINGERPRINTS[effect](events), `${effect} fingerprint:\n${events.join("\n")}`);
    assert.ok(!/NaN|undefined|Infinity/.test(ass), `${effect} writes only real numbers`);
  }
  // Calm only pops or stacks on its own, so phrase 1 shows none of the other effects.
  const plain = phraseOne(make({}));
  for (const effect of ["quote", "curve", "frame", "title"]) {
    assert.ok(!FINGERPRINTS[effect](plain), `calm phrase 1 looks like ${effect}:\n${plain.join("\n")}`);
  }
});

test("a title card opens the video", () => {
  const ass = buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "Hold My Hand" });
  const first = ass.split("\n").find((l) => l.startsWith("Dialogue:"));
  assert.match(first, /^Dialogue: 2,0:00:00\.00,/);
  assert.ok(first.includes("HOLD"));
  const none = buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1, title: "   " });
  assert.equal(none, buildAss({ lines: lyric, w: 1280, h: 720, look: "studio-lagos-night", energy: "wild", seed: 1 }));
});
