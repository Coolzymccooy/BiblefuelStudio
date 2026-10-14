// A call and its crowd echo share the screen (spec §6.2), so the call's ink must stay above the
// echo's ink with a visible gap, on every aspect, look, energy and call effect.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLyricAss, resolvedEffects } from "./lyricAss.js";
import { parseSheet } from "./sheetParser.js";
import * as echo from "../kinetic/effects/echo.js";
import { resolveLook } from "../kinetic/looks.js";
import { eventInk, startOf } from "../kinetic/inkTestkit.js";

const LOOKS = ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"];
const ENERGIES = ["calm", "lively", "wild"];
const SIZES = [["shorts", 720, 1280, "shorts"], ["tall", 720, 1280, "default"], ["wide", 1280, 720, "default"]];
const CALL_EFFECTS = ["pop", "stack", "slam", "quote", "curve", "frame", "title"];
const GAP = 0.02; // of the frame height
const ECHO = "(WHO TALK SAY?!)";
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");

const timed = (id, kind, text, start, effect = "auto") => {
  const ws = text.split(" ").map((t, i) => ({ text: t, start: Number((start + i * 0.3).toFixed(2)), end: Number((start + i * 0.3 + 0.28).toFixed(2)) }));
  return { id, sectionId: "s1", kind, text, effect, words: ws, start, end: ws[ws.length - 1].end, confidence: 1, flag: null };
};
const project = (lines, look, energy, seed = 1) => ({
  title: "My Time No Late", look: { id: look, energy, seed },
  sections: [{ id: "s1", kind: "chorus", label: "CHORUS" }], song: { durationSec: 60 }, timing: { status: "done" }, lines,
});
const dialogues = (ass) => ass.split("\n").filter((l) => l.startsWith("Dialogue:"));

/**
 * Lowest ink of the events that start in [from, to) and highest ink of those that start in
 * [to, until): the call's block and its echoes' block, told apart by when they come up.
 */
function inkSplit(ass, look, { w, h }, from, to, until) {
  let callBottom = -Infinity;
  let echoTop = Infinity;
  for (const d of dialogues(ass)) {
    const t = startOf(d);
    const ink = eventInk(d, look, { w, h });
    if (t >= from && t < to) callBottom = Math.max(callBottom, ink.bottom);
    else if (t >= to && t < until) echoTop = Math.min(echoTop, ink.top);
  }
  return { callBottom, echoTop };
}

/**
 * Call at 10 s, its echo when the call ends, the next lead at 18 s. `before` lead lines come
 * first, which moves the call to another slot (seed 1 puts it in slot 0, 2 and 1 for 0, 1, 2).
 */
function callAndEcho(call, effect, lookId, energy, [, w, h, layout], echoes = [ECHO], before = 0) {
  const lead = timed("l1", "lead", call, 10, effect);
  const lines = [...Array.from({ length: before }, (_, i) => timed(`p${i}`, "lead", "Eh yeah", 1 + i * 3)), lead];
  const first = lines.length;
  let t = lead.end + 0.3;
  echoes.forEach((text, i) => {
    const r = timed(`r${i}`, "response", text, Number(t.toFixed(2)));
    lines.push(r);
    t = r.end + 0.2;
  });
  lines.push(timed("l9", "lead", "Oya dance dance dance", 18));
  const ass = buildLyricAss(project(lines, lookId, energy), { w, h, layout });
  return { ass, ...inkSplit(ass, resolveLook(lookId), { w, h }, 10, lines[first].start, 18) };
}

test("echo exposes the top of its ink, computed by the code that draws it", () => {
  assert.equal(typeof echo.echoInkTop, "function", "echo.js exports echoInkTop");
  for (const [aspect, w, h, layout] of SIZES) {
    for (const lookId of LOOKS) {
      const look = resolveLook(lookId);
      for (const text of [ECHO, "(NO DEY LATE!)", "(MY TIME NO LATE, MY TIME NO LATE!)"]) {
        const p = timed("r", "response", text, 4);
        const phrase = { text, start: p.start, end: p.end, words: p.words };
        const events = echo.render({ planned: { index: 0, phrase, effect: "echo", slot: 0, hook: false, rot: 2 }, look, energy: "wild", w, h, aspect, nextStart: 20 });
        const drawn = Math.min(...events.map((e) => eventInk(e, look, { w, h }).top));
        const told = echo.echoInkTop({ phrase, look, w, h, aspect });
        // The helper may be pessimistic by a pixel or two (rounding), never optimistic.
        assert.ok(told <= drawn + 0.5 && drawn - told < 3, `${layout}/${lookId}/${text}: helper ${told.toFixed(1)} vs drawn ${drawn.toFixed(1)}`);
      }
    }
  }
});

test("a call's whole ink stays above its echo's ink on every effect, look, energy and aspect", () => {
  const bad = [];
  let checked = 0;
  for (const size of SIZES) {
    for (const lookId of LOOKS) {
      for (const energy of ENERGIES) {
        for (const effect of CALL_EFFECTS) {
          for (const call of ["Who talk say I no go shine?", "My time no late"]) {
            for (const before of [0, 1, 2]) {
              const { callBottom, echoTop } = callAndEcho(call, effect, lookId, energy, size, [ECHO], before);
              assert.ok(Number.isFinite(callBottom) && Number.isFinite(echoTop), `${effect}: both blocks drawn`);
              checked += 1;
              const room = echoTop - (callBottom + GAP * size[2]);
              if (room < 0) bad.push(`${size[0]}/${lookId}/${energy}/${effect}/slot-run ${before} "${call}": call ink ${callBottom.toFixed(1)} + gap > echo ink ${echoTop.toFixed(1)} (by ${(-room).toFixed(1)} px)`);
            }
          }
        }
      }
    }
  }
  assert.equal(checked, SIZES.length * LOOKS.length * ENERGIES.length * CALL_EFFECTS.length * 2 * 3);
  assert.equal(bad.length, 0, `${bad.length} calls run into their echo\n${bad.slice(0, 8).join("\n")}`);
});

/**
 * The Task 8 render's project: the reference sheet, each line timed from the hand-checked lines
 * where they match (an echo the hand-timed list lacks comes 0.1 s after the line before it).
 */
function referenceSheetProject() {
  const parsed = parseSheet(fs.readFileSync(path.join(FIX, "sheet.txt"), "utf8"));
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-lines.json"), "utf8"));
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "");
  let cursor = 0;
  let prevEnd = 0;
  const lines = parsed.lines.map((l, i) => {
    const at = expected.findIndex((e, k) => k >= cursor && norm(e.text) === norm(l.text));
    let line;
    if (at >= 0) {
      cursor = at + 1;
      line = { ...l, id: `l${i}`, effect: "auto", words: expected[at].words, start: expected[at].start, end: expected[at].end };
    } else {
      line = { ...timed(`l${i}`, l.kind, l.text, Number((prevEnd + 0.1).toFixed(2))), sectionId: l.sectionId };
    }
    prevEnd = line.end;
    return line;
  });
  return { title: "My Time No Late", look: { id: "studio-lagos-night", energy: "wild", seed: 1 }, sections: parsed.sections, lines, song: { durationSec: 180 }, timing: { status: "done" } };
}

test("regression: 'Who talk say I no go shine?' clears '(WHO TALK SAY?!)' on lagos-night, wild, 720x1280 Shorts", () => {
  const p = referenceSheetProject();
  const at = p.lines.findIndex((l) => l.text === "Who talk say I no go shine?");
  const call = p.lines[at];
  const reply = p.lines[at + 1];
  assert.equal(reply.text, ECHO);
  assert.equal(reply.kind, "response");
  const fx = resolvedEffects(p);
  assert.equal(fx[call.id], "stack", "the policy draws this call as a stack, as in the real render");
  assert.equal(fx[reply.id], "echo");
  const look = resolveLook("studio-lagos-night");
  const ass = buildLyricAss(p, { w: 720, h: 1280, layout: "shorts" });
  const { callBottom, echoTop } = inkSplit(ass, look, { w: 720, h: 1280 }, call.start, reply.start, p.lines[at + 2].start);
  assert.ok(callBottom + GAP * 1280 <= echoTop, `call ink ${callBottom.toFixed(1)} + ${GAP * 1280} > echo ink ${echoTop.toFixed(1)}`);
  // The stack moved up inside the Shorts band rather than off its top.
  const callTop = Math.min(...dialogues(ass).filter((d) => startOf(d) >= call.start && startOf(d) < reply.start).map((d) => eventInk(d, look, { w: 720, h: 1280 }).top));
  assert.ok(callTop >= 0.11 * 1280 - 1.5, `call ink top ${callTop.toFixed(1)} above the Shorts band`);
});

test("repeated responses all sit under the call", () => {
  const bad = [];
  for (const size of SIZES) {
    for (const effect of CALL_EFFECTS) {
      for (const before of [0, 1, 2]) {
        const { callBottom, echoTop } = callAndEcho("Who talk say I no go shine?", effect, "studio-gospel-gold", "wild", size,
          [ECHO, "(MY TIME NO LATE, MY TIME NO LATE!)"], before);
        if (callBottom + GAP * size[2] > echoTop) bad.push(`${size[0]}/${effect}/${before}: ${callBottom.toFixed(1)} vs ${echoTop.toFixed(1)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("the echo stays on its anchor whatever the call does", () => {
  for (const size of SIZES) {
    const [, w, h, layout] = size;
    const alone = buildLyricAss(project([timed("r0", "response", ECHO, 11)], "studio-lagos-night", "wild"), { w, h, layout });
    const echoAlone = dialogues(alone).map((d) => d.split(",").slice(3).join(","));
    for (const effect of CALL_EFFECTS) {
      const lines = [timed("l1", "lead", "Who talk say I no go shine?", 8.5, effect), timed("r0", "response", ECHO, 11)];
      const ass = buildLyricAss(project(lines, "studio-lagos-night", "wild"), { w, h, layout });
      const echoWithCall = dialogues(ass).filter((d) => startOf(d) >= 11).map((d) => d.split(",").slice(3).join(","));
      assert.deepEqual(echoWithCall, echoAlone, `${size[0]}/${effect}`);
    }
  }
});
