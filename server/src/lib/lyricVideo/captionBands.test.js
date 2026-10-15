import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInkEvents, bandHideWindows, captionsEnd } from "./captionBands.js";
import { buildLyricAss } from "./lyricAss.js";

const ev = (start, end, text) => `Dialogue: 0,${start},${end},Kinetic,,0,0,0,,${text}`;
const ASS = [
  "[Events]",
  ev("0:00:01.00", "0:00:02.00", "{\\an5\\pos(360,300)\\fs40\\bord5}HIGH"),
  ev("0:00:05.00", "0:00:06.50", "{\\an5\\move(360,700,360,690,0,180)\\fs60}LOW"),
  ev("0:00:07.00", "0:00:08.00", "{\\an7\\pos(40,100)\\fs30}TOP LEFT"),
  ev("0:00:03.00", "0:00:04.00", "{\\an7\\pos(0,0)\\p1}m 0 0 l 10 0 10 10{\\p0}"),
  ev("0:00:09.00", "0:00:09.50", "{\\an2\\pos(360,240)\\fs40}BOTTOM ANCHOR"),
].join("\n");

test("each text event gives its time and the top of its ink; drawings are skipped", () => {
  const events = parseInkEvents(ASS);
  assert.equal(events.length, 4);
  assert.deepEqual(events[0], { start: 1, end: 2, top: 300 - 0.5 * 40 * 1.35 - 5 });
  assert.equal(events[1].top, 690 - 0.5 * 60 * 1.35);
  assert.equal(events[2].top, 100);
  assert.equal(events[3].top, 240 - 40 * 1.35);
});

test("windows cover the captions that reach into the band, padded, and close gaps under a second", () => {
  const events = parseInkEvents(ASS);
  assert.deepEqual(bandHideWindows(events, { bandBottom: 300 }), [[0.75, 2.25], [6.75, 9.75]]);
  assert.deepEqual(bandHideWindows(events, { bandBottom: 50 }), []);
});

test("captionsEnd is the last moment any caption is on screen", () => {
  assert.equal(captionsEnd(parseInkEvents(ASS)), 9.5);
  assert.equal(captionsEnd([]), 0);
});

test("font names with spaces, several override blocks and a drawing later in the text are handled", () => {
  const ass = [
    ev("0:00:01.00", "0:00:02.00", "{\\an8\\move(360,100,360,90,0,180)\\fnBebas Neue\\fs72}A{\\pos(1,999)\\fs10}B"),
    ev("0:00:03.00", "0:00:04.00", "{\\an5\\pos(360,300)\\fs40}x{\\p1}m 0 0 l 5 5{\\p0}"),
    ev("0:00:05.00", "0:00:06.00", "{\\an5\\fs40}no position"),
    ev("0:00:07.00", "0:00:08.00", "{\\an5\\pos(360,300)}no size"),
    ev("1:02:03.50", "1:02:04.25", "{\\pos(360,300)\\fs40}default alignment, comma, in text"),
  ].join("\n");
  const events = parseInkEvents(ass);
  assert.equal(events.length, 2);
  assert.equal(events[0].top, 90);
  assert.deepEqual(events[1], { start: 3723.5, end: 3724.25, top: 300 - 0.5 * 40 * 1.35 });
});

test("overlapping windows merge and starts are clamped at zero", () => {
  const events = [
    { start: 0.1, end: 1, top: 10 },
    { start: 1.5, end: 2, top: 10 },
    { start: 5, end: 6, top: 10 },
    { start: 6.2, end: 7, top: 500 },
  ];
  assert.deepEqual(bandHideWindows(events, { bandBottom: 100 }), [[0, 2.25], [4.75, 6.25]]);
  assert.deepEqual(bandHideWindows(events, { bandBottom: 100, pad: 0, joinGap: 0.1 }), [[0.1, 1], [1.5, 2], [5, 6]]);
});

const timed = (id, text, start) => {
  const ws = text.split(" ").map((t, i) => ({ text: t, start: start + i * 0.3, end: start + i * 0.3 + 0.28 }));
  return { id, sectionId: "s1", kind: "lead", text, effect: "auto", words: ws, start, end: ws[ws.length - 1].end, confidence: 1, flag: null };
};

test("a real project's ASS parses to finite events and captionsEnd passes the last line's end", () => {
  const lines = [
    timed("l1", "Nothing can stop me now", 2),
    timed("l2", "I am running through the night", 6),
    timed("l3", "My time no late", 10),
    timed("l4", "Every voice sings along", 14),
  ];
  const project = {
    title: "My Time No Late", look: { id: "studio-lagos-night", energy: "wild", seed: 1 },
    sections: [{ id: "s1", kind: "chorus", label: "CHORUS" }], song: { durationSec: 30 }, timing: { status: "done" }, lines,
  };
  const events = parseInkEvents(buildLyricAss(project, { w: 720, h: 1280, layout: "shorts" }));
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(Number.isFinite(e.start) && Number.isFinite(e.end) && Number.isFinite(e.top));
    assert.ok(e.end > e.start);
  }
  assert.ok(captionsEnd(events) > lines[lines.length - 1].end);
});
