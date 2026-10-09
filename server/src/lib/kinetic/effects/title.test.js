import { test } from "node:test";
import assert from "node:assert/strict";
import { render as title, splitTitle, titleCard } from "./title.js";
import { ctx, planned } from "./testkit.js";
import { resolveLook } from "../looks.js";

const w = (s) => s.split(" ").map((text) => ({ text }));
const joined = (lines) => lines.map((l) => l.map((x) => x.text).join(" "));

test("splitTitle balances two lines by length; one word stays one line", () => {
  assert.deepEqual(joined(splitTitle(w("I still dey here"))), ["I still", "dey here"]);
  assert.deepEqual(joined(splitTitle(w("After the rain"))), ["After", "the rain"]);
  assert.deepEqual(joined(splitTitle(w("Hallelujah"))), ["Hallelujah"]);
});

test("the title effect draws two big centred lines, the second in the hit colour", () => {
  const lines = title(ctx(planned("After the rain", "title")));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.includes("\\fnKnewave") && l.startsWith("Dialogue: 2,")));
  assert.ok(!lines[0].includes("&H003AD3F5&"), "first line in the body colour");
  assert.ok(lines[1].includes("&H003AD3F5&"), "second line in the hit colour");
  assert.ok(Number(lines[0].match(/\\fs(\d+)/)[1]) >= 150);
});

test("a title card shows from 0 s until just before the first lyric, 1.5 to 3 s", () => {
  const look = resolveLook("studio-lagos-night");
  const card = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 4 });
  assert.equal(card.length, 2);
  assert.match(card[0], /^Dialogue: 2,0:00:00\.00,0:00:03\.00,/);
  assert.match(card[1], /^Dialogue: 2,0:00:00\.25,0:00:03\.00,/);
  assert.ok(card.join(" ").includes("STILL"));
  const early = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 0.5 });
  assert.match(early[0], /,0:00:01\.50,/);
  const mid = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart: 2.2 });
  assert.match(mid[0], /,0:00:02\.15,/);
  assert.deepEqual(titleCard({ text: "   ", look, w: 1280, h: 720, aspect: "wide", firstStart: 4 }), []);
});

test("a title with no words draws nothing, and a missing first-lyric time shows the card for 3 s", () => {
  const empty = { ...planned("x", "title"), phrase: { text: "", start: 2, end: 2.5, words: [] } };
  assert.deepEqual(title(ctx(empty)), []);
  const look = resolveLook("studio-lagos-night");
  for (const firstStart of [null, undefined, ""]) {
    const card = titleCard({ text: "I Still Dey", look, w: 1280, h: 720, aspect: "wide", firstStart });
    assert.match(card[0], /^Dialogue: 2,0:00:00\.00,0:00:03\.00,/, String(firstStart));
  }
});
