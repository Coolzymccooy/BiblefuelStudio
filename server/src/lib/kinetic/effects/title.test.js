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

const cardAt = (firstStart) => titleCard({
  text: "I Still Dey", look: resolveLook("studio-lagos-night"), w: 1280, h: 720, aspect: "wide", firstStart,
});
const seconds = (stamp) => stamp.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
const times = (line) => {
  const [, start, end] = line.match(/^Dialogue: \d+,([\d:.]+),([\d:.]+),/);
  return [seconds(start), seconds(end)];
};

test("a title card shows from 0 s until just before the first lyric, at most 3 s", () => {
  const card = cardAt(4);
  assert.equal(card.length, 2);
  assert.match(card[0], /^Dialogue: 2,0:00:00\.00,0:00:03\.00,/);
  assert.match(card[1], /^Dialogue: 2,0:00:00\.25,0:00:03\.00,/);
  assert.ok(card.join(" ").includes("STILL"));
  assert.match(cardAt(2.2)[0], /,0:00:02\.15,/);
  assert.deepEqual(titleCard({ text: "   ", look: resolveLook("studio-lagos-night"), w: 1280, h: 720, aspect: "wide", firstStart: 4 }), []);
});

test("a short silence still gets a card that ends before the first lyric, and its lines never start after it ends", () => {
  const card = cardAt(1.0);
  assert.equal(card.length, 2);
  assert.match(card[0], /,0:00:00\.95,/);
  for (const line of card) {
    const [start, end] = times(line);
    assert.ok(start === 0 || start === 0.25, `start ${start}`);
    assert.ok(start < end, `start ${start} is before end ${end}`);
    assert.ok(end < 1.0, "the card is gone before the first lyric");
  }
});

test("a card that would stay up under 0.6 s is skipped, so it never covers the opening lyric", () => {
  assert.deepEqual(cardAt(0.5), []);
  assert.deepEqual(cardAt(0), []);
  assert.deepEqual(cardAt(0.64), [], "end 0.59 is too short to read");
  const justEnough = cardAt(0.70);
  assert.equal(justEnough.length, 2);
  assert.match(justEnough[0], /,0:00:00\.65,/);
  // With so little room, both lines come up together at 0 s rather than the second one after the card is gone.
  assert.match(justEnough[0], /^Dialogue: 2,0:00:00\.00,/);
  assert.match(justEnough[1], /^Dialogue: 2,0:00:00\.00,/);
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
