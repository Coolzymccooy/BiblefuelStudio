import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLyricAss } from "./lyricAss.js";
import { chooseEffects } from "./policy.js";

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
