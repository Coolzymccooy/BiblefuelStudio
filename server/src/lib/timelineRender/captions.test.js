import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptionClipsFromWords } from "./captions.js";

test("buildCaptionClipsFromWords groups word timings into readable caption clips", () => {
  const clips = buildCaptionClipsFromWords([
    { text: "Amazing", startMs: 0, endMs: 300 },
    { text: "grace", startMs: 320, endMs: 620 },
    { text: "how", startMs: 900, endMs: 1100 },
    { text: "sweet", startMs: 1120, endMs: 1400 },
    { text: "the", startMs: 1420, endMs: 1500 },
    { text: "sound", startMs: 1520, endMs: 1900 },
  ], { maxWordsPerClip: 3, maxGapMs: 500 });

  assert.equal(clips.length, 2);
  assert.equal(clips[0].text, "Amazing grace how");
  assert.equal(clips[0].startSec, 0);
  assert.equal(clips[1].text, "sweet the sound");
  assert.equal(clips[1].startSec, 1.12);
});
