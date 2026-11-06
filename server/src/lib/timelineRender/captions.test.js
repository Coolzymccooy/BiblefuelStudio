import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptionClipsFromWords, captionRendererInput } from "./captions.js";

// Mirror the client equivalence matrix: punctuation inside numbers is spoken
// meaning, not typography. Exercise both edits and attempted reverse edits.
for (const [source, edited] of [
  ['John 3:16', 'John 316'], ['1.5', '15'], ['-1', '1'], ['+1', '1'],
  ['−1', '1'], ['±1', '1'], ['.5', '5'], ['-.5', '.5'],
  ['3:16', '3.16'], ['1,000', '1000'], ['1/2', '12'], ['1e-3', '1e3'],
  ['$1', '1'], ['1%', '1'],
]) {
  test(`numeric edits invalidate source timing: ${source} → ${edited}`, () => {
    for (const [before, after] of [[source, edited], [edited, source]]) {
      const words = before.split(' ').map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400 }));
      assert.deepEqual(captionRendererInput({ text: after, words, durationSec: 2 }), { timingStatus: 'unavailable', words: [] });
    }
  });
}
for (const [source, edited] of [
  ['Hello.', 'Hello!'], ['John 3:16', 'JOHN (3:16)!'], ['1.5', '(1.5)!'],
  ['-1', '“-1!”'], ['+.5', '(+.5)!'], ['1%', '(1%)!'],
]) {
  test(`cosmetic edits retain timing and authored tokens: ${source} → ${edited}`, () => {
    const words = source.split(' ').map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400 }));
    const clip = { text: edited, words, startSec: 3, durationSec: 2, timingStatus: 'source' };
    const before = JSON.stringify(clip);
    const result = captionRendererInput(JSON.parse(before));
    assert.equal(result.timingStatus, 'source');
    assert.deepEqual(result.words, words.map((w, i) => ({ text: edited.split(' ')[i], start: 3 + w.startMs / 1000, end: 3 + w.endMs / 1000 })));
    assert.equal(JSON.stringify(clip), before);
  });
}
test('authored-token mapping precedes source trimming, not filtered indexes', () => {
  const words = [
    { text: 'Hello.', startMs: 100, endMs: 300 },
    { text: 'world.', startMs: 1100, endMs: 1300 },
  ];
  const result = captionRendererInput({ text: 'HELLO! WORLD?', words, startSec: 5, sourceStartSec: 1, durationSec: 1 });
  assert.equal(result.timingStatus, 'source');
  assert.equal(result.words.length, 1);
  assert.equal(result.words[0].text, 'WORLD?');
  assert.ok(Math.abs(result.words[0].start - 5.1) < 1e-9);
  assert.ok(Math.abs(result.words[0].end - 5.3) < 1e-9);
});

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
