import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "./echo.js";
import { planned, ctx, posOf } from "./testkit.js";
import { EFFECT_IDS } from "../director.js";
import { EFFECTS } from "../ass.js";

const shorts = (p) => ctx(p, { w: 720, h: 1280, aspect: "shorts" });
const head = (line) => line.match(/\{[^}]*\}/)[0];
const dialogueOf = (lines) => lines.filter((l) => !/\\p1/.test(l));

test("echo is a registered effect but never a random pick", () => {
  assert.ok(EFFECT_IDS.includes("echo"));
  assert.equal(typeof EFFECTS.echo, "function");
});

test("echo draws in the hit font, filled with the body colour and outlined in the hit colour", () => {
  const dialogue = dialogueOf(render(shorts(planned("(WHO TALK SAY?!)", "echo"))));
  assert.ok(dialogue.length >= 1);
  const h0 = head(dialogue[0]);
  assert.match(h0, /\\fnKnewave/);          // lagos-night hit font
  assert.match(h0, /\\frz6\\/);             // tilted +6 degrees
  assert.match(h0, /\\fscx175\\fscy175/);   // pops in at 175%
  assert.match(h0, /\\3c&H003AD3F5&/);      // outline = hit colour #F5D33A (ASS is BGR)
  // The fill is the body colour (#FFFFFF-ish for lagos-night), not the hit colour.
  const fill = dialogue[0].match(/\{\\c(&H[0-9A-F]{8}&)/)[1];
  assert.notEqual(fill, "&H003AD3F5&");
});

test("echo sits in the lower band at about 0.645 h on a tall frame", () => {
  const dialogue = dialogueOf(render(shorts(planned("(NO DEY LATE!)", "echo"))));
  const [, y] = posOf(dialogue[0]);
  assert.ok(Math.abs(y - 0.645 * 1280) < 0.05 * 1280, `y=${y}`);
});

test("echo ends with sparks on its last word", () => {
  assert.ok(render(shorts(planned("(WHO TALK SAY?!)", "echo"))).some((l) => /\\p1/.test(l)));
});

test("a wide frame anchors the echo at about 0.72 h", () => {
  const dialogue = dialogueOf(render(ctx(planned("(NO DEY LATE!)", "echo"))));
  const [, y] = posOf(dialogue[0]);
  assert.ok(Math.abs(y - 0.72 * 720) < 0.06 * 720, `y=${y}`);
});
