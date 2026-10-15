import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLyricAss, resolvedEffects } from "./lyricAss.js";
import { chooseEffects } from "./policy.js";
import { parseSheet } from "./sheetParser.js";
import { resolveLook } from "../kinetic/looks.js";
import { eventInk, startOf } from "../kinetic/inkTestkit.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-lines.json"), "utf8"));
const kinds = { intro: "intro", verse1: "verse", pre: "pre", chorus1: "chorus", verse2: "verse", bridge: "bridge", final: "final", outro: "outro" };
const sectionIds = [...new Set(expected.map((l) => l.section))];
const project = {
  title: "My Time No Late",
  look: { id: "studio-lagos-night", energy: "wild", seed: 2026 },
  sections: sectionIds.map((s) => ({ id: s, kind: kinds[s], label: s })),
  lines: expected.map((l, i) => ({ id: `l${i}`, sectionId: l.section, kind: l.kind === "response" ? "response" : "lead",
    text: l.text, words: l.words, start: l.start, end: l.end, effect: "auto", confidence: 1, flag: null })),
};

test("builds a full ASS document with every line's words", () => {
  const ass = buildLyricAss(project, { w: 720, h: 1280 });
  assert.match(ass, /^\[Script Info\]/);
  assert.match(ass, /PlayResY: 1280/);
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(events.length >= project.lines.length);
  assert.match(ass, /MY TIME/);
});

test("the same project renders the same ASS", () => {
  assert.equal(buildLyricAss(project, { w: 720, h: 1280 }), buildLyricAss(project, { w: 720, h: 1280 }));
});

test("unplaced lines are left out; none placed gives an empty string", () => {
  const empty = { ...project, lines: project.lines.map((l) => ({ ...l, words: [] })) };
  assert.equal(buildLyricAss(empty, { w: 720, h: 1280 }), "");
});

test("the reference project keeps the engine's spacing rules on a Shorts frame", () => {
  const fx = chooseEffects({ lines: project.lines, sections: project.sections, title: project.title });
  const words = (l) => l.text.trim().split(/\s+/).length;
  const gaps = (id, from) => {
    const at = project.lines.filter((_, i) => fx[i] === id);
    return at.slice(1).map((l, i) => from(at[i], l));
  };
  assert.ok(gaps("slam", (a, b) => b.start - a.end).every((g) => g >= 4), "slams 4 s apart");
  assert.ok(gaps("frame", (a, b) => b.start - a.start).every((g) => g >= 30), "frames 30 s apart");
  assert.ok(gaps("curve", (a, b) => b.start - a.start).every((g) => g >= 20), "curves 20 s apart");
  project.lines.forEach((l, i) => {
    if (words(l) > 5) assert.ok(fx[i] === "pop" || fx[i] === "stack", `line ${i} (${words(l)} words) got ${fx[i]}`);
    if (fx[i] === "slam") assert.ok(words(l) <= 4, `slam on ${words(l)} words`);
  });
  assert.ok(fx.includes("slam") && fx.includes("frame"), "the song still gets its big moments");
  assert.ok(buildLyricAss(project, { w: 720, h: 1280 }).length > 0);
});

test("the project's energy reaches the effect choice: a calm video has no slams (R42)", () => {
  const calm = { ...project, look: { ...project.look, energy: "calm" } };
  const fx = chooseEffects({ lines: calm.lines, sections: calm.sections, title: calm.title, energy: "calm" });
  assert.ok(!fx.some((e) => e === "slam" || e === "frame" || e === "curve"));
  // The same calm project with those choices written onto its lines draws exactly the same.
  const pinned = { ...calm, lines: calm.lines.map((l, i) => ({ ...l, effect: fx[i] })) };
  assert.equal(buildLyricAss(calm, { w: 720, h: 1280 }), buildLyricAss(pinned, { w: 720, h: 1280 }));
});

const timed = (id, kind, text, start, sectionId = "s1") => {
  const ws = text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.28 }));
  return { id, sectionId, kind, text, effect: "auto", words: ws, start, end: ws[ws.length - 1].end, confidence: 1, flag: null };
};
const mini = (lines, extra = {}) => ({
  title: "My Time No Late", look: { id: "studio-lagos-night", energy: "wild", seed: 1 },
  sections: [{ id: "s1", kind: "chorus", label: "CHORUS" }], song: { durationSec: 30 }, timing: { status: "done" }, lines, ...extra,
});
const dialogues = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
const toSec = (t) => { const [h, m, s] = t.split(":"); return +h * 3600 + +m * 60 + +s; };
const endOf = (d) => toSec(d.split(",")[2]);
/** What a Dialogue line shows: the text after the style fields, with {override} blocks removed. */
const shown = (d) => d.replace(/^.*?Kinetic,,0,0,0,,/, "").replace(/\{[^}]*\}/g, "");

test("a call holds on screen until the next lead line when an echo follows it", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 10), timed("l2", "response", "(WHO TALK SAY?!)", 11.2), timed("l3", "lead", "My time no late", 14)]);
  const all = dialogues(buildLyricAss(p, { w: 720, h: 1280 }));
  const call = all.filter((d) => /WHO/i.test(shown(d)) && !shown(d).includes("("));
  const echo = all.filter((d) => shown(d).includes("("));
  assert.ok(call.length, "the call is drawn");
  assert.ok(echo.length, "the echo is drawn");
  assert.ok(Math.abs(Math.max(...call.map(endOf)) - 13.95) < 0.02, `call ends ${Math.max(...call.map(endOf))}`);
  assert.ok(Math.abs(Math.max(...echo.map(endOf)) - 13.95) < 0.02, `echo ends ${Math.max(...echo.map(endOf))}`);
});

test("the last call and echo stop by the audible end", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 20), timed("l2", "response", "(WHO TALK SAY?!)", 21.2)], { timing: { status: "done", audibleEnd: 22.5 } });
  const all = dialogues(buildLyricAss(p, { w: 720, h: 1280 }));
  assert.ok(all.length);
  for (const d of all) assert.ok(endOf(d) <= 22.5 + 0.01, d);
});

test("without an audible end the song's length bounds the hold", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 20), timed("l2", "response", "(WHO TALK SAY?!)", 21.2)], { song: { durationSec: 22.5 } });
  for (const d of dialogues(buildLyricAss(p, { w: 720, h: 1280 }))) assert.ok(endOf(d) <= 22.5 + 0.01, d);
});

test("a soft line is drawn in Caveat", () => {
  const p = mini([timed("l1", "soft", "In the quiet of the night", 5)]);
  assert.match(buildLyricAss(p, { w: 720, h: 1280 }), /\\fnCaveat/);
});

test("resolvedEffects maps each placed line to the effect the render uses", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 10), timed("l2", "response", "(WHO TALK SAY?!)", 11.2)]);
  const fx = resolvedEffects(p);
  assert.equal(fx.l2, "echo");
  assert.ok(typeof fx.l1 === "string");
});

test("resolvedEffects leaves out lines that are not placed", () => {
  const p = mini([timed("l1", "lead", "Who talk say", 10), { ...timed("l2", "lead", "Not timed", 12), words: [] }]);
  assert.deepEqual(Object.keys(resolvedEffects(p)), ["l1"]);
});

/**
 * Each line's Dialogue events, told apart by when they come up: a line's events start at or after
 * its own start and before the next line's.
 */
function eventsByLine(ass, lines) {
  const all = dialogues(ass);
  return lines.map((l, i) => all.filter((d) => startOf(d) >= l.start - 0.005 && (i + 1 === lines.length || startOf(d) < lines[i + 1].start - 0.005)));
}

/**
 * Where two lines' events are on screen together, as text: each pair that shares screen time and
 * whose ink boxes overlap top to bottom. Empty when the two lines never collide.
 */
function collisions(a, b, look, size) {
  const out = [];
  for (const x of a) {
    for (const y of b) {
      if (!(startOf(x) < endOf(y) && startOf(y) < endOf(x))) continue;
      const ix = eventInk(x, look, size);
      const iy = eventInk(y, look, size);
      if (ix.bottom > iy.top && iy.bottom > ix.top) {
        out.push(`${shown(x)} [${startOf(x)}-${endOf(x)} y ${ix.top.toFixed(0)}-${ix.bottom.toFixed(0)}] meets ${shown(y)} [${startOf(y)}-${endOf(y)} y ${iy.top.toFixed(0)}-${iy.bottom.toFixed(0)}]`);
      }
    }
  }
  return out;
}

const SIZES = [[720, 1280, "shorts"], [720, 1280, "default"], [1280, 720, "default"]];
const LAGOS = resolveLook("studio-lagos-night");

test("overlap (a): a reply set to a non-echo effect never shares the screen with its call", () => {
  const bad = [];
  for (const fx of ["stack", "pop", "slam", "quote", "curve", "frame", "title"]) {
    const lines = [timed("l1", "lead", "Who talk say", 10), { ...timed("l2", "response", "(WHO TALK SAY?!)", 12), effect: fx }, timed("l3", "lead", "My time no late", 16)];
    for (const [w, h, layout] of SIZES) {
      const [call, reply] = eventsByLine(buildLyricAss(mini(lines), { w, h, layout }), lines);
      assert.ok(call.length && reply.length, `${fx}: both lines drawn`);
      bad.push(...collisions(call, reply, LAGOS, { w, h }).map((c) => `${fx} ${w}x${h} ${layout}: ${c}`));
    }
  }
  assert.deepEqual(bad, []);
});

test("overlap (b): two crowd replies in a row never sit on each other", () => {
  const sheet = parseSheet("[Chorus]\nShine? (WHO TALK SAY?!)\n(YEAH!)\nMy time no late");
  assert.deepEqual(sheet.lines.map((l) => l.kind), ["lead", "response", "response", "lead"], "the sheet gives a call and two replies");
  const at = [12, 13.5, 15.5, 19];
  const lines = sheet.lines.map((l, i) => ({ ...timed(`l${i}`, l.kind, l.text, at[i]), sectionId: "s1" }));
  const bad = [];
  for (const [w, h, layout] of SIZES) {
    const [call, first, second] = eventsByLine(buildLyricAss(mini(lines), { w, h, layout }), lines);
    assert.ok(first.length && second.length, "both replies drawn");
    for (const [x, y, what] of [[first, second, "reply/reply"], [call, first, "call/first reply"], [call, second, "call/second reply"]]) {
      bad.push(...collisions(x, y, LAGOS, { w, h }).map((c) => `${what} ${w}x${h} ${layout}: ${c}`));
    }
  }
  assert.deepEqual(bad, []);
});

test("overlap (c): a lead line set to Echo never shares the screen with its reply", () => {
  const lines = [{ ...timed("l1", "lead", "Who talk say", 10), effect: "echo" }, timed("l2", "response", "(WHO TALK SAY?!)", 11.2), timed("l3", "lead", "My time no late", 14)];
  const bad = [];
  for (const [w, h, layout] of SIZES) {
    const [call, reply] = eventsByLine(buildLyricAss(mini(lines), { w, h, layout }), lines);
    assert.ok(call.length && reply.length, "both lines drawn");
    bad.push(...collisions(call, reply, LAGOS, { w, h }).map((c) => `${w}x${h} ${layout}: ${c}`));
  }
  assert.deepEqual(bad, []);
});

test("a call with two echoes: the call and the last echo hold to the next lead, the first echo leaves when the second comes", () => {
  const lines = [timed("l1", "lead", "Who talk say", 10), timed("l2", "response", "(WHO TALK SAY?!)", 11.2),
    timed("l3", "response", "(YEAH!)", 13), timed("l4", "lead", "My time no late", 15.5)];
  const [call, first, second] = eventsByLine(buildLyricAss(mini(lines), { w: 720, h: 1280 }), lines);
  const last = (evs) => Math.max(...evs.map(endOf));
  assert.ok(Math.abs(last(call) - 15.45) < 0.02, `call ends ${last(call)}`);
  assert.ok(Math.abs(last(first) - 12.95) < 0.02, `first echo ends ${last(first)}`);
  assert.ok(Math.abs(last(second) - 15.45) < 0.02, `last echo ends ${last(second)}`);
});

test("the shuffle seed changes the captions; seed 1 matches the default", () => {
  const lines = [timed("l1", "lead", "Everywhere you go", 5, "s2"), timed("l2", "lead", "Everybody get pain", 7, "s2"), timed("l3", "lead", "Some dey work", 9, "s2")];
  const p = mini(lines, { sections: [{ id: "s2", kind: "verse", label: "VERSE" }] });
  const a = buildLyricAss(p, { w: 720, h: 1280 });
  const seeds = new Set([2, 3, 4, 5, 6].map((seed) => buildLyricAss({ ...p, look: { ...p.look, seed } }, { w: 720, h: 1280 })));
  assert.ok([...seeds].some((s) => s !== a));
  const noSeed = { ...p, look: { id: p.look.id, energy: p.look.energy } };
  assert.equal(buildLyricAss(noSeed, { w: 720, h: 1280 }), a, "a missing seed is seed 1");
});
