import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvenWordTimings, normalizeWordTimings, buildImportedTranscript } from './scriptImport.js';

describe('buildEvenWordTimings', () => {
  test('spans exactly the audio duration', () => {
    const w = buildEvenWordTimings(['one', 'two', 'three'], 3000);
    assert.equal(w[0].startMs, 0);
    assert.equal(w[w.length - 1].endMs, 3000, 'last word must end exactly at the audio end');
  });

  test('gives longer words more time', () => {
    const w = buildEvenWordTimings(['a', 'Nebuchadnezzar'], 10000);
    const short = w[0].endMs - w[0].startMs;
    const long = w[1].endMs - w[1].startMs;
    assert.ok(long > short, 'longer word should take longer to say');
  });

  test('produces contiguous non-overlapping timings', () => {
    const w = buildEvenWordTimings(['the', 'lord', 'is', 'my', 'shepherd'], 5000);
    for (let i = 1; i < w.length; i += 1) {
      assert.ok(w[i].startMs >= w[i - 1].endMs - 1, `word ${i} overlaps its predecessor`);
    }
  });

  test('returns empty for no words or zero duration', () => {
    assert.deepEqual(buildEvenWordTimings([], 5000), []);
    assert.deepEqual(buildEvenWordTimings(['a'], 0), []);
  });

  test('ignores blank tokens', () => {
    assert.equal(buildEvenWordTimings(['a', '', '  ', 'b'], 2000).length, 2);
  });
});

describe('normalizeWordTimings', () => {
  test('accepts startMs/endMs', () => {
    const w = normalizeWordTimings([{ text: 'hi', startMs: 0, endMs: 500 }]);
    assert.deepEqual(w, [{ text: 'hi', startMs: 0, endMs: 500 }]);
  });

  test('accepts seconds-based start/end', () => {
    const w = normalizeWordTimings([{ word: 'hi', start: 1.5, end: 2 }]);
    assert.deepEqual(w, [{ text: 'hi', startMs: 1500, endMs: 2000 }]);
  });

  test('drops entries with missing or invalid timings', () => {
    const w = normalizeWordTimings([
      { text: 'ok', startMs: 0, endMs: 100 },
      { text: 'no-timing' },
      { text: 'reversed', startMs: 500, endMs: 100 },
      null,
    ]);
    assert.equal(w.length, 1);
    assert.equal(w[0].text, 'ok');
  });

  test('handles a non-array input', () => {
    assert.deepEqual(normalizeWordTimings(null), []);
  });
});

describe('buildImportedTranscript', () => {
  test('uses provider timings when available', () => {
    const r = buildImportedTranscript({
      script: 'the lord is my shepherd',
      audioPath: '/out/a.mp3',
      durationMs: 4000,
      words: [
        { text: 'the', startMs: 0, endMs: 400 },
        { text: 'lord', startMs: 400, endMs: 1200 },
      ],
    });
    assert.equal(r.transcript.words.length, 2);
    assert.equal(r.source.audioPath, '/out/a.mp3');
  });

  test('falls back to even timings when the provider gives none', () => {
    const r = buildImportedTranscript({
      script: 'the lord is my shepherd',
      audioPath: '/out/a.mp3',
      durationMs: 5000,
    });
    assert.equal(r.transcript.words.length, 5, 'one entry per word in the script');
    assert.equal(r.transcript.words[4].endMs, 5000);
  });

  test('hash matches the transcribeStage format so caching behaves the same', () => {
    const r = buildImportedTranscript({ script: 'a b', audioPath: '/x.mp3', durationMs: 2000 });
    assert.equal(r.transcript.hash, '2000:2');
  });

  test('duration expands if word timings run past the reported length', () => {
    const r = buildImportedTranscript({
      script: 'a b',
      audioPath: '/x.mp3',
      durationMs: 1000,
      words: [{ text: 'a', startMs: 0, endMs: 900 }, { text: 'b', startMs: 900, endMs: 2500 }],
    });
    assert.equal(r.source.durationMs, 2500, 'never truncate audio the words still cover');
  });

  test('throws when there is nothing to build from', () => {
    assert.throws(() => buildImportedTranscript({ script: '', audioPath: '/x.mp3', durationMs: 0 }),
      /no words/i);
  });
});
