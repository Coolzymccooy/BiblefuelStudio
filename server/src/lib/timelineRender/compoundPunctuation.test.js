import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captionRendererInput, matchCaptionDisplayWords } from './captions.js';

const timed = (texts) => texts.map((text, i) => ({ text, startMs: i * 700 + 50, endMs: i * 700 + 400, identity: i }));
for (const punctuation of ['—', '–', '‐', '‑', '‒', '―', '-', '…', '— ! ? …', '” ) , ; :']) {
  test(`compound display punctuation ${punctuation} preserves units and authored punctuation`, () => {
    const source = timed(['Studio —', 'Fuel']);
    const before = JSON.stringify(source);
    const text = `“ Studio ${punctuation} Fuel !`;
    const mapped = matchCaptionDisplayWords(source, text);
    assert.deepEqual(mapped, [{ ...source[0], text: `“ Studio ${punctuation}` }, { ...source[1], text: 'Fuel !' }]);
    assert.equal(mapped.map((w) => w.text).join(' '), text);
    assert.equal(JSON.stringify(source), before);
    assert.equal(captionRendererInput({ text, words: source, durationSec: 2 }).timingStatus, 'source');
  });
}
for (const [source, text] of [
  [['Studio Fuel', 'Your'], 'Studio Your'],
  [['Studio —', 'Fuel', 'Your'], 'Studio — Your'],
  [['Studio —', 'Fuel'], 'Studio — new Fuel'],
  [['Studio —', 'Fuel'], 'Fuel — Studio'],
  [['John', '3:16 —'], 'John 316 —'],
  [['John', '3:16 —'], 'John 3.16 —'],
  [['Cost', '-$1 —'], 'Cost $1 —'],
  [['Cost', '<1 —'], 'Cost 1 —'],
  [['Cost', '1 —'], 'Cost € 1 —'],
  [['Cost', '$', '1'], 'Cost 1'],
  [['Studio', '—', 'Fuel'], 'Studio — Fuel'],
  [['Studio —', 'Fuel'], '— !'],
]) test(`fails closed ${source.join('|')} -> ${text}`, () => {
  assert.equal(matchCaptionDisplayWords(timed(source), text), null);
});
test('compound mapping precedes trimming and never shifts a later lexical window', () => {
  const words = timed(['Studio —', 'Fuel', 'Your']);
  const result = captionRendererInput({ text: '“ Studio — ! Fuel Your ?', words, startSec: 10, sourceStartSec: 0.8, durationSec: 0.2 });
  assert.equal(result.timingStatus, 'source');
  assert.deepEqual(result.words, [{ text: 'Fuel', start: 10, end: 10.2 }]);
});

test('saved real-audio caption-34 retains exactly five native source windows', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('../../../test/fixtures/caption-acceptance/timeline-closing.json', import.meta.url)));
  const clip = plan.tracks.find((t) => t.kind === 'captions').clips.find((c) => c.id === 'caption-34');
  const before = JSON.stringify(clip);
  const result = captionRendererInput(clip);
  assert.equal(result.timingStatus, 'source');
  assert.equal(result.words.length, 5);
  assert.equal(result.words.map((w) => w.text).join(' '), clip.text);
  clip.words.forEach((w, i) => {
    assert.ok(Math.abs(result.words[i].start - (clip.startSec + w.startMs / 1000)) < 1e-12);
    assert.ok(Math.abs(result.words[i].end - (clip.startSec + w.endMs / 1000)) < 1e-12);
  });
  assert.equal(JSON.stringify(clip), before);
});
