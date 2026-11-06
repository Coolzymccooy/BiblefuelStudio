import { test } from "node:test";
import assert from "node:assert/strict";
import { placeLines } from "./align.js";
import { placementPolicy, shift, transcribeSong } from "./transcribeWindows.js";
import { atLeastHeard } from "./alignJob.js";

const line = { id: "a", text: "alpha one two three omega", kind: "lead" };
const wordsOf = (seq, start = 10) => seq.map((word, i) => ({ word, start: start + i * 0.3, end: start + (i + 1) * 0.3 }));
// Frozen decisions measured with the original HEAD align.js before provenance.
for (const c of [
  { name: "substituted", seq: ["alpha", "foo", "bar", "baz", "omega"], confidence: 1, flag: null, end: 11.5, audibleEnd: 11.5 },
  { name: "partial", seq: ["alpha", "omega"], confidence: 0.4, flag: "check", end: 10.6, audibleEnd: 2 },
  { name: "interpolated", seq: ["alpha", "one", "three", "omega"], confidence: 0.8, flag: null, end: 11.2, audibleEnd: 11.2 },
]) {
  test(`original ${c.name} audible-end and placement policy survives stricter quality flags`, () => {
    const heard = wordsOf(c.seq);
    const placed = placeLines([line], heard, { durationSec: 30 })[0];
    assert.deepEqual(placementPolicy(placed), { confidence: c.confidence, flag: c.flag });
    assert.equal(placed.start, 10);
    assert.equal(placed.end, c.end);
    assert.equal(placed.flag, "check", "estimates and substitutions remain exposed diagnostically");
    assert.equal(atLeastHeard(2, [line], heard, new Map(), 30), c.audibleEnd);
  });
}

for (const c of [
  { name: "substituted", seq: ["alpha", "foo", "bar", "baz", "omega"], cuts: [], heardCount: 15 },
  { name: "partial", seq: ["alpha", "omega"], cuts: [[0, 30], [0, 15], [13, 28]], heardCount: 0 },
  { name: "interpolated", seq: ["alpha", "one", "three", "omega"], cuts: [], heardCount: 12 },
]) {
  test(`whole-song ${c.name} prefix keeps original window/frontier decisions`, async () => {
    const lines = Array.from({ length: 3 }, (_, i) => ({ ...line, id: `l${i}` }));
    const words = lines.flatMap((_, i) => wordsOf(c.seq, 1 + i * 3));
    const cuts = [];
    let calls = 0;
    const result = await transcribeSong({ audioPath: "synthetic", lines, durationSec: 30,
      transcribe: async (file) => { calls++; return { words: file === "synthetic" ? words : [] }; },
      cutAudio: async (from, to) => { cuts.push([from, to]); return "cut"; },
    });
    assert.deepEqual(cuts, c.cuts);
    assert.equal(calls, 1 + c.cuts.length);
    assert.equal(result.heard.length, c.heardCount);
    assert.deepEqual(result.heard, c.heardCount ? words : []);
    assert.deepEqual(result.passes, [
      { from: 0, to: 30, status: "used" },
      ...c.cuts.map(([from, to]) => ({ from, to, status: "rejected", reason: "heard nothing" })),
    ]);
  });
}

test("window transcription retains measured provenance on the song clock through final placement", async () => {
  const lines = [{ id: "a", text: "alpha" }, { id: "b", text: "beta" }];
  let cutFrom;
  const result = await transcribeSong({ audioPath: "synthetic", durationSec: 10, lines,
    cutAudio: async (from) => { cutFrom = from; return "cut"; },
    transcribe: async (file) => ({ words: file === "synthetic"
      ? [{ word: "alpha", start: 5, end: 5.3 }]
      : [{ word: "beta", start: 7 - cutFrom, end: 7.4 - cutFrom, timingSource: "measured" }] }),
  });
  assert.ok(Math.abs(cutFrom - 3.28) < 1e-9, "legacy frontier uses the display line end, not the acoustic end");
  const placed = placeLines(lines, result.heard, { durationSec: 10 });
  assert.equal(placed[1].timingQuality.status, "measured");
  assert.equal(placed[1].words[0].timing.acousticStart, 7);
  assert.equal(placed[1].words[0].timing.acousticEnd, 7.4);
});

test("window rebasing preserves measured identity and transforms evidence exactly once without mutating input", () => {
  const input = [{ word: "alpha", start: 1, end: 2, timingSource: "measured", confidence: 0.9,
    timing: { source: "measured", acousticStart: 1.1, acousticEnd: 1.9,
      anchors: [{ word: "alpha", start: 1.1, end: 1.9, source: "measured", exact: true }] } },
    { word: "gap", start: 2, end: 3, timing: { source: "unresolved", acousticStart: null, acousticEnd: null, anchors: [] } }];
  const before = structuredClone(input);
  const rebased = shift(input, 20);
  assert.equal(rebased[0].timingSource, "measured");
  assert.equal(rebased[0].confidence, 0.9);
  assert.equal(rebased[0].start, 21);
  assert.equal(rebased[0].timing.acousticStart, 21.1);
  assert.equal(rebased[0].timing.acousticEnd, 21.9);
  assert.equal(rebased[0].timing.anchors[0].start, 21.1);
  assert.equal(rebased[0].timing.anchors[0].end, 21.9);
  assert.equal(rebased[1].timing.acousticStart, null);
  assert.deepEqual(input, before);
  const placed = placeLines([{ id: "l", text: "alpha" }], [rebased[0]], { durationSec: 30 })[0];
  assert.equal(placed.timingQuality.status, "measured");
  assert.equal(placed.words[0].timing.acousticStart, 21);
});
