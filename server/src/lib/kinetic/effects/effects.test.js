import { test } from "node:test";
import assert from "node:assert/strict";
import { render as pop } from "./pop.js";
import { render as stack } from "./stack.js";
import { render as slam } from "./slam.js";
import { holdEnd, fontsFor, lineEvent, keyWordIndex } from "./common.js";
import { resolveLook } from "../looks.js";
import { widthAt } from "../text.js";

const words = (text, start) => text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.25, end: start + i * 0.25 + 0.25 }));
const phrase = (text, start = 2) => ({ text, start, end: start + text.split(" ").length * 0.25, words: words(text, start) });
const planned = (text, effect, extra = {}) => ({ index: 0, phrase: phrase(text), effect, slot: 0, hook: false, rot: -2, ...extra });
const ctx = (p, over = {}) => ({ planned: p, look: resolveLook("studio-lagos-night"), energy: "lively", w: 1280, h: 720, aspect: "wide", nextStart: 10, ...over });
const posOf = (line) => line.match(/\\(?:move|pos)\((-?\d+),(-?\d+)/).slice(1).map(Number);

test("a phrase holds until just before the next one, at least 0.25 s past its last word", () => {
  assert.equal(holdEnd({ start: 1, end: 2 }, 2.1), 2.25);
  assert.equal(holdEnd({ start: 1, end: 2 }, 5), 4.95);
  assert.equal(holdEnd({ start: 1, end: 2 }, Infinity), 3.2);
  assert.equal(holdEnd({ start: 1, end: 2 }, 30), 5);
});

test("letters the look's fonts lack switch the phrase to DejaVu", () => {
  const look = resolveLook("studio-lagos-night");
  assert.equal(fontsFor(look, "I STILL DEY").hit.family, "Knewave");
  const f = fontsFor(look, "Ọlọ́run ṣe é");
  assert.equal(f.body.family, "DejaVu Sans");
  assert.equal(f.hit.family, "DejaVu Sans");
  assert.equal(f.hit.colour, look.hit.colour);
});

test("lineEvent: first word shows at once, later words fade in on their beat", () => {
  const line = lineEvent({ start: 2, end: 4, x: 640, y: 360, fs: 80, family: "Knewave", rot: -2, pop: 135, bord: 5, shad: 3, outline: "#101010",
    words: [{ text: "I", t: 2, colour: "#F5D33A" }, { text: "STILL", t: 2.5, colour: "#F5D33A" }] });
  assert.match(line, /^Dialogue: 0,0:00:02\.00,0:00:04\.00,Kinetic,,0,0,0,,/);
  assert.match(line, /\\fnKnewave\\fs80/);
  assert.match(line, /\\fscx135\\fscy135\\t\(0,1[36]0,\\fscx100\\fscy100\)/);
  assert.match(line, /\{\\c&H003AD3F5&\}I \{\\c&H003AD3F5&\\alpha&HFF&\\t\(500,570,\\alpha&H00&\)\}STILL$/);
});

test("pop sits in the lower band and reveals every word", () => {
  const lines = pop(ctx(planned("When life feels dark and heavy", "pop")));
  assert.ok(lines.length >= 1 && lines.length <= 2);
  const text = lines.join(" ");
  for (const w of ["WHEN", "LIFE", "FEELS", "DARK", "AND", "HEAVY"]) assert.ok(text.includes(w), w);
  for (const l of lines) assert.ok(posOf(l)[1] > 720 * 0.6, "lower band");
});

test("stack breaks a phrase into short stacked lines at its slot, tilted", () => {
  const lines = stack(ctx(planned("Five in the morning NEPA", "stack")));
  assert.ok(lines.length >= 2);
  const ys = lines.map((l) => posOf(l)[1]);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, "top to bottom");
  for (const l of lines) assert.match(l, /\\frz-2/);
  const morning = lines.find((l) => l.includes("MORNING"));
  const nepa = lines.find((l) => l.includes("NEPA"));
  assert.match(morning, /&H003AD3F5&/, "the longest word is in the hit colour when lively");
  assert.ok(!nepa.includes("&H003AD3F5&"), "the last word is not, unless it is the key word");
});

test("keyWordIndex picks the word with the most letters; a tie goes to the later word", () => {
  assert.equal(keyWordIndex(["I", "still", "dey"]), 1);
  assert.equal(keyWordIndex(["By", "his", "grace,"]), 2);
  assert.equal(keyWordIndex(["God", "is", "good"]), 2);
  assert.equal(keyWordIndex(["Ọlọ́run", "ṣe"]), 0);
});

test("captions are big: a short stack line fills the frame", () => {
  const fsOf = (lines) => Number(lines[0].match(/\\fs(\d+)/)[1]);
  const tall = stack(ctx(planned("Fear thou", "stack"), { w: 720, h: 1280, aspect: "tall" }));
  const wide = stack(ctx(planned("Fear thou", "stack")));
  assert.ok(fsOf(tall) >= 95, `tall stack size ${fsOf(tall)}`);
  assert.ok(fsOf(wide) >= 90, `wide stack size ${fsOf(wide)}`);
});

test("calm stack keeps every word in the body colour unless the line is a hook", () => {
  const calm = stack(ctx(planned("By his grace", "stack"), { energy: "calm" })).join(" ");
  assert.ok(!calm.includes("&H003AD3F5&"));
  const hook = stack(ctx(planned("I still dey", "stack", { hook: true }), { energy: "calm" })).join(" ");
  assert.ok(hook.includes("&H003AD3F5&"));
});

test("slam is huge, centred, in the hit font, and fires sparks on its last word", () => {
  const lines = slam(ctx(planned("I still dey", "slam", { hook: true })));
  const text = lines.filter((l) => !l.includes("\\p1"));
  const sparks = lines.filter((l) => l.includes("\\p1"));
  assert.ok(text.every((l) => l.includes("\\fnKnewave")));
  const fs = Number(text[0].match(/\\fs(\d+)/)[1]);
  assert.ok(fs >= 110, `slam size ${fs}`);
  assert.equal(sparks.length, 1);
  assert.match(sparks[0], /^Dialogue: 1,0:00:02\.50,/);
});

test("tall frames keep stacked text inside the safe band", () => {
  const lines = stack(ctx(planned("From Lagos traffic to the last train home", "stack", { slot: 2 }), { w: 720, h: 1280, aspect: "tall" }));
  for (const l of lines) assert.ok(posOf(l)[1] <= 1280 * 0.82, "above the bottom strip");
});

/** The words a set of Dialogue lines show on screen, in order, with override blocks removed. */
const visible = (lines) => lines
  .map((l) => l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, ""))
  .join(" ")
  .split(" ")
  .filter(Boolean);
const upper = (text) => text.toLocaleUpperCase().split(" ");

test("pop never drops a word on a tall frame, however long the phrase", () => {
  for (const text of ["Even though I walk through the valley of the shadow of death", "Reconciliation transformation righteousness everywhere"]) {
    const lines = pop(ctx(planned(text, "pop"), { w: 720, h: 1280, aspect: "tall" }));
    assert.deepEqual(visible(lines), upper(text), text);
    for (const l of lines) assert.ok(posOf(l)[1] <= 1280 * 0.82, "inside the safe band");
  }
});

test("pop shows every word of a 12-word phrase on a wide frame", () => {
  const text = "Even though I walk through the valley of the shadow of death";
  assert.deepEqual(visible(pop(ctx(planned(text, "pop")))), upper(text));
});

test("slam sparks stay inside the safe area on tall frames", () => {
  const lines = slam(ctx(planned("Glorification Alleluia", "slam"), { w: 720, h: 1280, aspect: "tall" }));
  const sparks = lines.find((l) => l.includes("\\p1"));
  const x = Number(sparks.match(/\\pos\((-?\d+),/)[1]);
  const r = Math.round(Math.min(720, 1280) * 0.05);
  assert.ok(x <= 0.88 * 720 - 1.6 * r, `sparks x ${x}`);
});

/** Boxes (left/right/top/bottom) of a phrase's text events, from their final position, size and text (all are \an5). */
function boxesOf(lines, look, text) {
  const fonts = fontsFor(look, look.uppercase ? text.toLocaleUpperCase() : text);
  return lines.filter((l) => !l.includes("\\p1")).map((l) => {
    const [x, y] = l.match(/\\move\(-?\d+,-?\d+,(-?\d+),(-?\d+)/).slice(1).map(Number);
    const fs = Number(l.match(/\\fs(\d+)/)[1]);
    const family = l.match(/\\fn([^\\}]+)/)[1];
    const file = [fonts.body, fonts.hit].find((f) => f.family === family).file;
    const shown = l.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");
    const half = widthAt(file, shown, fs) / 2;
    return { left: x - half, right: x + half, top: y - fs / 2, bottom: y + fs / 2, shown };
  });
}

const insideSafeArea = (boxes, w, h, aspect) => {
  const right = (aspect === "tall" ? 0.88 : 0.94) * w + 1;
  const bottom = (aspect === "tall" ? 0.82 * h : h) + 1;
  for (const b of boxes) {
    const n = JSON.stringify({ ...b, w, h });
    assert.ok(b.left >= 0.06 * w - 1, `left ${n}`);
    assert.ok(b.right <= right, `right ${n}`);
    assert.ok(b.bottom <= bottom, `bottom ${n}`);
    assert.ok(b.top >= 0, `top ${n}`);
  }
};

test("a 4-word slam stays inside the safe area on a tall frame", () => {
  const text = "I still dey here";
  const c = ctx(planned(text, "slam", { hook: true }), { w: 720, h: 1280, aspect: "tall" });
  const boxes = boxesOf(slam(c), c.look, text);
  assert.equal(boxes.length, 2);
  insideSafeArea(boxes, 720, 1280, "tall");
});

test("a 5-word pop stays inside the safe area on tall and wide frames", () => {
  const text = "Even the darkest night ends";
  const tall = ctx(planned(text, "pop"), { w: 720, h: 1280, aspect: "tall" });
  insideSafeArea(boxesOf(pop(tall), tall.look, text), 720, 1280, "tall");
  const wide = ctx(planned(text, "pop"));
  insideSafeArea(boxesOf(pop(wide), wide.look, text), 1280, 720, "wide");
});

test("slams and pops are big: sizes match the approved look", () => {
  const fsOf = (lines) => Number(lines.find((l) => !l.includes("\\p1")).match(/\\fs(\d+)/)[1]);
  const tallCtx = { w: 720, h: 1280, aspect: "tall" };
  const slamWide = fsOf(slam(ctx(planned("I still dey", "slam", { hook: true }))));
  const slamTall = fsOf(slam(ctx(planned("I still dey", "slam", { hook: true }), tallCtx)));
  const popWide = fsOf(pop(ctx(planned("Fear thou not", "pop"))));
  assert.ok(slamWide >= 200, `wide slam size ${slamWide}`);
  assert.ok(slamTall >= 170, `tall slam size ${slamTall}`);
  assert.ok(popWide >= 75, `wide pop size ${popWide}`);
});
