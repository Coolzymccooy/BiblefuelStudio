import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captionWindow, captionOpacity, scheduleCaptions } from './captionSchedule.ts';
const line = (start = 0, dur = 1, gap = 0) => ({ start, dur, gap, kind: 'narration' });

test('tight adjacent lines hard handoff at unchanged 50ms lead, final word not faded early', () => {
  const w = captionWindow(line(), 1.01);
  assert.equal(w.end, 0.96);
  assert.equal(w.fadeOutStart, 0.96);
  assert.equal(captionOpacity(w, 0.959), 1);
  assert.equal(captionOpacity(w, 0.96), 0);
  assert.equal(captionOpacity(captionWindow(line(1.01)), 0.96), 0);
  assert.ok(captionOpacity(captionWindow(line(1.01)), 0.97) > 0);
});
test('short silence shortens hold/fade, not spoken word visibility', () => {
  const w = captionWindow(line(), 1.2);
  assert.equal(w.fadeOutStart, 1);
  assert.equal(w.end, 1.15);
  assert.equal(captionOpacity(w, 0.999), 1);
  assert.ok(captionOpacity(w, 1.1) > 0);
  assert.equal(captionOpacity(w, 1.15), 0);
});
test('long gap and final line retain natural hold/fade and clear before next line', () => {
  const w = captionWindow(line(0, 1, 4), 5);
  assert.equal(w.fadeOutStart, 1.9);
  assert.equal(w.end, 2.1999999999999997);
  assert.deepEqual(captionWindow(line(0, 1, 4)), w);
  assert.equal(captionOpacity(w, 3), 0);
});
test('unsorted input unchanged; equal starts last authored line wins', () => {
  const input = [{ ...line(2), id: 'later' }, { ...line(), id: 'first' }, { ...line(), id: 'tie-winner' }];
  const result = scheduleCaptions(input);
  assert.deepEqual(input.map(l => l.id), ['later', 'first', 'tie-winner']);
  assert.deepEqual(result.map(r => r.line.id), ['first', 'tie-winner', 'later']);
  assert.equal(captionOpacity(result[0].window, 0.2), 0);
  assert.ok(captionOpacity(result[1].window, 0.2) > 0);
});
test('reference extended hold and chant whole-line mode need no word spans', () => {
  const ref = { ...line(), kind: 'reference' };
  assert.equal(captionWindow(ref).fadeOutStart, 1.9);
  assert.equal(captionWindow(ref, 1.2).end, 1.15);
  assert.ok(captionOpacity(captionWindow({ ...line(), kind: 'chant' }), 0.3) > 0);
});
test('very short and overlapping lines have finite nonnegative opacity and exclusive boundaries', () => {
  const result = scheduleCaptions([line(0, 0.001), line(0.002), line(0.1)]);
  for (let frame = -10; frame < 100; frame++) {
    const active = result.map(r => captionOpacity(r.window, frame / 300));
    assert.ok(active.every(o => Number.isFinite(o) && o >= 0 && o <= 1));
    assert.ok(active.filter(o => o > 0).length <= 1);
  }
});
test('exact real-audio fixture: every 30fps frame exclusive, Your retained, Faith at 10.900', () => {
  const props = JSON.parse(fs.readFileSync(new URL('../../test/fixtures/caption-acceptance/scenescript-closing.json', import.meta.url), 'utf8'));
  const result = scheduleCaptions(props.lines);
  for (let frame = 0; frame < 360; frame++) {
    assert.ok(result.filter(r => captionOpacity(r.window, frame / 30) > 0).length <= 1, `frame ${frame}`);
  }
  assert.equal(captionOpacity(result[4].window, 10.666666666666666), 1);
  assert.equal(captionOpacity(result[4].window, 10.9), 0);
  assert.equal(captionOpacity(result[5].window, 10.9), 1);
  assert.equal(captionOpacity(result[5].window, 11.2), 1);
});
