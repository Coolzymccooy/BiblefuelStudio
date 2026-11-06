import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvenWordTimings, normalizeWordTimings, buildImportedTranscript } from './scriptImport.js';
import { prepareScriptureForSpeech } from '../voice/scripture.js';

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

  test('rejects the whole source with missing or invalid timings', () => {
    const w = normalizeWordTimings([
      { text: 'ok', startMs: 0, endMs: 100 },
      { text: 'no-timing' },
      { text: 'reversed', startMs: 500, endMs: 100 },
      null,
    ]);
    assert.deepEqual(w, []);
  });

  test('handles a non-array input', () => {
    assert.deepEqual(normalizeWordTimings(null), []);
  });
});


const timed = texts => texts.map((text, i) => ({ text, startMs: i * 100, endMs: (i + 1) * 100 }));
const imported = (script, words) => buildImportedTranscript({ script, words, audioPath: '/x.mp3', durationMs: 5000 });

describe('script coverage safety', () => {
  for (const [label, script, texts] of [
    ['omitted middle word', 'a b c', ['a', 'c']],
    ['omitted suffix', 'a b c', ['a', 'b']],
    ['same-count mismatch', 'a b c', ['a', 'x', 'c']],
    ['reordered words', 'a b c', ['c', 'b', 'a']],
    ['spoken verse expansion', 'John 3:16', ['John', 'three', 'sixteen']],
    ['ambiguous internal punctuation', 'John 3:16', ['John', '316']],
    ['numeric sign', 'value -3', ['value', '3']],
    ['decimal point', 'value .5', ['value', '5']],
  ]) test(label, () => assert.throws(() => imported(script, timed(texts)), /mismatch.*every script token/));

  test('preserves exact Unicode author tokens and original whitespace', () => {
    const script = '  “Éternel,”\nDieu’s  grâce!  ';
    const r = imported(script, timed(['éternel', "dieu's", 'grâce']));
    assert.equal(r.transcript.script, script);
    assert.deepEqual(r.transcript.words.map(w => w.text), ['“Éternel,”', 'Dieu’s', 'grâce!']);
  });

  for (const bad of [null, { text: 'b' }, { text: 'b', startMs: null, endMs: 200 },
    { text: 'b', startMs: -1, endMs: 200 }, { text: 'b', startMs: 100, endMs: 100 },
    { text: 'b', startMs: '100', endMs: 200 }, { text: 'b', startMs: 0, endMs: 50 }]) {
    test(`rejects malformed whole-source ${JSON.stringify(bad)}`, () => {
      assert.throws(() => imported('a b', [timed(['a'])[0], bad]), /invalid word timings/);
    });
  }
  test('requires finite measured duration even when provider words exist', () => {
    for (const durationMs of [0, -1, NaN, Infinity, undefined]) {
      assert.throws(() => buildImportedTranscript({ script: 'a', words: timed(['a']), durationMs }), /measured/);
    }
  });
});

describe('deterministic authored-to-spoken references', () => {
  const synthWords = (spoken) => timed(spoken.split(/\s+/u));
  for (const [script, spoken] of [
    ['Read John 3:16 today', 'Read John chapter three, verse sixteen today.'],
    ['Read 1 John 3:16-18 today', 'Read 1 John chapter three, verses sixteen to eighteen today.'],
    ['Read 2 Corinthians 12:9 today', 'Read 2 Corinthians chapter twelve, verse nine today.'],
    ['Read 3 John 1:2 today', 'Read 3 John chapter one, verse two today.'],
    ['John 3:16 - 18', 'John chapter three, verses sixteen to eighteen.'],
    ['“John 3:16!” — believe.', '“John chapter three, verse sixteen!” — believe.'],
  ]) test(script, () => {
    const words = synthWords(spoken);
    const r = imported(script, words);
    assert.equal(r.transcript.script, script);
    assert.deepEqual(r.transcript.words.map(w => w.text), script.split(/\s+/u));
    assert.equal(r.transcript.timing.verified, false);
    assert.equal(r.transcript.timing.accuracy, 'unknown');
    const reference = r.transcript.words.find(w => /^3:16/u.test(w.text));
    if (reference) {
      assert.equal(reference.startMs, words.find(w => w.text === 'chapter').startMs);
      assert.ok(reference.endMs > reference.startMs);
    }
  });
  for (const spoken of ['Read John chapter three today', 'Read John chapter three verse sixteen yesterday',
    'Read John three sixteen today', 'Read John chapter three verse sixteen today extra']) {
    test(`rejects partial/unrelated ${spoken}`, () => assert.throws(() => imported('Read John 3:16 today', synthWords(spoken)), /mismatch/));
  }
  for (const book of ['John', '1 John', '2 Corinthians', '3 John', 'Song of Solomon']) {
    for (const separator of ['-', '- ', ' -', ' - ']) {
      test(`preserves complete range coverage: ${book} 3:16${separator}18`, () => {
        const script = `  Read “${book} 3:16${separator}18!”\nNOW.  `;
        const spoken = `Read “${book} chapter three, verses sixteen to eighteen!” NOW.`;
        assert.equal(prepareScriptureForSpeech(script), spoken);
        const words = synthWords(spoken);
        const r = imported(script, words);
        const tokens = script.trim().split(/\s+/u);
        assert.equal(r.transcript.script, script);
        assert.deepEqual(r.transcript.words.map(w => w.text), tokens);
        const chapter = words.findIndex(w => w.text === 'chapter');
        const ref = tokens.findIndex(t => t.startsWith('3:16'));
        const split = separator.includes(' ');
        const expected = tokens.map((text, i) => {
          if (i < ref) return { ...words[i], text };
          if (i === ref) return { text, startMs: words[chapter].startMs,
            endMs: words[chapter + (split ? 3 : 5)].endMs };
          if (text === '-') return { text, startMs: words[chapter + 4].startMs, endMs: words[chapter + 4].startMs };
          if (i === tokens.length - 1) return { ...words.at(-1), text };
          return { text, startMs: words[chapter + 4].startMs, endMs: words[chapter + 5].endMs };
        });
        assert.deepEqual(r.transcript.words, expected);
        assert.equal(r.transcript.timing.verified, false);
      });
    }
  }
  for (const [script, spoken] of [
    ['John 3:16- 18', 'John chapter three verses sixteen to nineteen'],
    ['John 3:16 -18', 'John chapter three verses sixteen'],
    ['John 3:16- 18', 'John chapter three verses sixteen to eighteen extra'],
    ['John 3:16 -18', 'John chapter three verses eighteen to sixteen'],
    ['John 3:16 -18 and 2 John 1:2', 'John chapter three verses sixteen to eighteen and 2 John 1:2'],
    ['john 3:16- 18', 'john chapter three verses sixteen to eighteen'],
    ['3:16 -18', 'chapter three verses sixteen to eighteen'],
    ['John3:16 -18', 'John chapter three verses sixteen to eighteen'],
    ['John 3:16 --18', 'John chapter three verses sixteen to eighteen'],
    ['John 3:16 –18', 'John chapter three verses sixteen to eighteen'],
    ['John 3:16 +18', 'John chapter three verses sixteen to eighteen'],
    ['John 3:16 -18.5', 'John chapter three verses sixteen to eighteen'],
    ['John 3:16- 18 costs -3.5', 'John chapter three verses sixteen to eighteen costs 3.5'],
    ['John 3:16 -18 costs $5', 'John chapter three verses sixteen to eighteen costs 5'],
    ['1 John 3:16 -18', 'First John chapter three verses sixteen to eighteen'],
  ]) test(`rejects unsupported range handoff: ${script} / ${spoken}`, () => {
    assert.throws(() => imported(script, synthWords(spoken)), /mismatch/);
  });
  for (const separator of ['-', '- ', ' -', ' - ']) {
    for (const [book, chapter, start, end] of [['John', 3, 16, 18], ['1 John', 1, 2, 4],
      ['2 Corinthians', 12, 9, 10], ['3 John', 1, 2, 4], ['Psalm', 119, 105, 112]]) {
      test(`imports literal synthesizer output: ${book} ${chapter}:${start}${separator}${end}`, () => {
        const script = `${book} ${chapter}:${start}${separator}${end}`;
        const words = synthWords(prepareScriptureForSpeech(script));
        const r = imported(script, words);
        assert.deepEqual(r.transcript.words.map(w => w.text), script.split(/\s+/u));
        assert.equal(r.transcript.words[0].startMs, words[0].startMs);
        assert.equal(r.transcript.words.at(-1).endMs, words.at(-1).endMs);
        assert.equal(r.transcript.words.filter(w => w.endMs > w.startMs)
          .reduce((sum, w) => sum + w.endMs - w.startMs, 0), words.at(-1).endMs);
      });
    }
  }
  test('preserves numeric meaning and complete multiple-reference coverage', () => {
    const script = 'Read 1 John 3:16- 18 and 2 Corinthians 12:9 -10; pay $5, not -3.5.';
    const words = synthWords(prepareScriptureForSpeech(script));
    const r = imported(script, words);
    assert.deepEqual(r.transcript.words.map(w => w.text), script.split(/\s+/u));
    assert.deepEqual(r.transcript.words.slice(-3), words.slice(-3));
    assert.equal(r.transcript.words.at(-1).endMs, words.at(-1).endMs);
  });
  test('rejects fabricated explicit maps for spaced ranges', () => {
    const script = 'John 3:16 -18';
    const words = synthWords(prepareScriptureForSpeech(script));
    const args = { script, words, audioPath: '/x', durationMs: 5000,
      spokenText: prepareScriptureForSpeech(script), tokenMap: [
        { tokenIndex: 0, spokenStart: 0, spokenEnd: 1 },
        { tokenIndex: 1, spokenStart: 1, spokenEnd: 5 },
        { tokenIndex: 2, spokenStart: 5, spokenEnd: 7 },
      ] };
    assert.equal(buildImportedTranscript(args).transcript.words.at(-1).endMs, words.at(-1).endMs);
    assert.throws(() => buildImportedTranscript({ ...args, tokenMap: args.tokenMap.map((m, i) =>
      i === 1 ? { ...m, spokenEnd: 4 } : m) }), /mismatch/);
    assert.throws(() => buildImportedTranscript({ ...args, spokenText: 'John chapter three verses sixteen to nineteen' }), /mismatch/);
  });
  test('nonspoken dash keeps its canonical token without inventing a timed word', () => {
    const r = imported('Be — still!', timed(['Be', 'still']));
    assert.deepEqual(r.transcript.words.map(w => w.text), ['Be', '—', 'still!']);
    assert.equal(r.transcript.words[1].startMs, r.transcript.words[1].endMs);
    assert.throws(() => imported('Pay $ today', timed(['Pay', 'today'])), /mismatch/);
  });
  test('explicit spoken text/map must agree with complete deterministic mapping', () => {
    const args = { script: 'John 3:16', words: synthWords('John chapter three verse sixteen'), audioPath: '/x', durationMs: 5000,
      spokenText: 'John chapter three verse sixteen', tokenMap: [
        { tokenIndex: 0, spokenStart: 0, spokenEnd: 1 }, { tokenIndex: 1, spokenStart: 1, spokenEnd: 5 },
      ] };
    assert.equal(buildImportedTranscript(args).transcript.words[1].endMs, args.words.at(-1).endMs);
    assert.throws(() => buildImportedTranscript({ ...args, spokenText: 'John chapter four verse sixteen' }), /mismatch/);
    assert.throws(() => buildImportedTranscript({ ...args, tokenMap: args.tokenMap.slice(0, 1) }), /mismatch/);
  });
  test('rejects partially expanded references and unsupported reference rewrites', () => {
    assert.throws(() => imported('John 3:16 and John 3:17', synthWords('John chapter three verse sixteen and John 3:17')), /mismatch/);
    assert.throws(() => imported('1 John 3:16', synthWords('First John chapter three verse sixteen')), /mismatch/);
    assert.throws(() => imported('John3:16', synthWords('John chapter three verse sixteen')), /mismatch/);
  });
  test('caller supplied timing cannot assert acoustic verification', () => {
    const r = buildImportedTranscript({ script: 'Be still', words: timed(['Be', 'still']), durationMs: 5000,
      timing: { provenance: 'acoustic', verified: true, accuracy: 'verified' } });
    assert.equal(r.transcript.timing.verified, false);
    assert.equal(r.transcript.timing.accuracy, 'unknown');
  });
});

describe('buildImportedTranscript', () => {
  test('uses provider timings when available', () => {
    const r = buildImportedTranscript({
      script: 'The Lord!',
            audioPath: '/out/a.mp3',
            durationMs: 4000,
      words: [
        { text: 'the', startMs: 0, endMs: 400 },
        { text: 'lord', startMs: 400, endMs: 1200 },
      ],
    });
    assert.equal(r.transcript.words.length, 2);
    assert.equal(r.source.audioPath, '/out/a.mp3');
    assert.deepEqual(r.transcript.words.map(w => w.text), ['The', 'Lord!']);
    assert.equal(r.transcript.timing.accuracy, 'unknown');
    assert.equal(r.transcript.timing.verified, false);
  });

  test('falls back to even timings when the provider gives none', () => {
    const r = buildImportedTranscript({
      script: 'the lord is my shepherd',
      audioPath: '/out/a.mp3',
      durationMs: 5000,
    });
    assert.equal(r.transcript.words.length, 5, 'one entry per word in the script');
    assert.equal(r.transcript.words[4].endMs, 5000);
    assert.equal(r.transcript.timing.estimated, true);
    assert.equal(r.transcript.timing.verified, false);
  });

  test('hash matches the transcribeStage format so caching behaves the same', () => {
    const r = buildImportedTranscript({ script: 'a b', audioPath: '/x.mp3', durationMs: 2000 });
    assert.equal(r.transcript.hash, '2000:2');
  });

  test('rejects timestamps beyond measured audio rather than inventing duration', () => {
    assert.throws(() => buildImportedTranscript({
      script: 'a b', audioPath: '/x.mp3', durationMs: 1000,
      words: [{ text: 'a', startMs: 0, endMs: 900 }, { text: 'b', startMs: 900, endMs: 2500 }],
    }), /measured audio duration/);
  });

  test('throws when there is nothing to build from', () => {
    assert.throws(() => buildImportedTranscript({ script: '', audioPath: '/x.mp3', durationMs: 0 }),
      /no words/i);
  });
});
