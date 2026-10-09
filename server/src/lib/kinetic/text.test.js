import { test } from "node:test";
import assert from "node:assert/strict";
import { widthAt, fitSize, covers, assEscape, assColour, assTime } from "./text.js";

test("ASS colours are BGR with a zero alpha", () => {
  assert.equal(assColour("#F5D33A"), "&H003AD3F5&");
  assert.equal(assColour("#ffffff"), "&H00FFFFFF&");
});

test("ASS times are h:mm:ss.cc and never negative", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(61.237), "0:01:01.24");
  assert.equal(assTime(-3), "0:00:00.00");
});

test("text cannot inject override blocks or line breaks", () => {
  assert.equal(assEscape("a {\\pos(1,1)} b\\N c\nd"), "a /pos(1,1) b/N c d");
});

test("control characters cannot end a caption line or stop libass parsing", () => {
  assert.ok(!assEscape("a\rDialogue: x").includes("\r"));
  assert.equal(assEscape("a\rDialogue: x"), "a Dialogue: x");
  assert.ok(!assEscape("hel\u0000lo").includes("\u0000"));
  assert.equal(assEscape("a\tb\u2028c\u2029d\u007fe"), "a b c d e");
  assert.equal(assEscape("a\r\nb"), "a b");
});

test("width grows with size and text; fitSize shrinks to fit", () => {
  const a = widthAt("PermanentMarker.ttf", "I STILL DEY", 60);
  assert.ok(a > 200 && a < 700, `width ${a}`);
  assert.ok(widthAt("PermanentMarker.ttf", "I STILL DEY", 120) > a * 1.9);
  const fs = fitSize("PermanentMarker.ttf", ["A VERY LONG LINE OF LYRICS HERE"], 120, 500);
  assert.ok(fs < 120 && widthAt("PermanentMarker.ttf", "A VERY LONG LINE OF LYRICS HERE", fs) <= 500 + 1);
  assert.equal(fitSize("PermanentMarker.ttf", ["HI"], 90, 1000), 90);
});

test("covers spots letters a font cannot draw", () => {
  assert.equal(covers("DejaVuSans.ttf", "Ọlọ́run ṣe é"), true);
  assert.equal(covers("PermanentMarker.ttf", "I STILL DEY"), true);
  assert.equal(covers("PermanentMarker.ttf", "ẹ ọ ṣ"), false);
});
