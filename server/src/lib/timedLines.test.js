import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineDrawtext } from './videoFilters.js';

// Line captions were paced by dividing the video duration evenly across the
// lines. That is fine for a 40 s short, where every line really does get an
// equal share, but a 12-minute long-form narration has real word timings and
// even pacing drifts minutes away from the voice.
//
// So a line may now arrive as { text, start, end } and keep its own window.
// Plain strings must behave exactly as before.

const W = 1280;
const H = 720;
const windowsOf = (out) => [...String(out || '').matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)]
  .map((m) => [Number(m[1]), Number(m[2])]);

test('timed lines keep their own windows instead of an even split', () => {
  const lines = [
    { text: 'Be still', start: 0, end: 2 },
    { text: 'and know', start: 30, end: 33 },
    { text: 'that I am God', start: 100, end: 104 },
  ];
  const out = buildLineDrawtext({ lines, w: W, h: H, duration: 120, preset: 'cinematic-default' });
  assert.ok(out, 'a filter was produced');
  const spans = windowsOf(out);
  assert.deepEqual(spans, [[0, 2], [30, 33], [100, 104]]);
  assert.match(out, /Be still/);
  assert.match(out, /that I am God/);
});

test('timed lines work in block mode, and in reveal mode', () => {
  const lines = [
    { text: 'Be still', start: 0, end: 2 },
    { text: 'and know', start: 30, end: 33 },
  ];
  for (const mode of [{ block: true }, { reveal: true }]) {
    const out = buildLineDrawtext({ lines, w: W, h: H, duration: 120, preset: 'cinematic-default', ...mode });
    const spans = windowsOf(out);
    assert.ok(spans.length >= 2, `${JSON.stringify(mode)} produced windows`);
    assert.equal(spans[0][0], 0, `${JSON.stringify(mode)} starts on the first line's own start`);
    const last = spans[spans.length - 1];
    assert.ok(last[1] <= 33.001, `${JSON.stringify(mode)} ends on the last line's own end, not the duration`);
    assert.doesNotMatch(out, /\[object Object\]/);
  }
});

test('plain string lines still get the even split they always had', () => {
  const out = buildLineDrawtext({ lines: ['one', 'two'], w: W, h: H, duration: 10, preset: 'cinematic-default' });
  assert.deepEqual(windowsOf(out), [[0, 5], [5, 10]]);
});

test('a timed line with a broken window falls back rather than drawing nothing', () => {
  const lines = [
    { text: 'good', start: 0, end: 2 },
    { text: 'bad', start: 5, end: 5 },
  ];
  const out = buildLineDrawtext({ lines, w: W, h: H, duration: 10, preset: 'cinematic-default' });
  assert.match(out, /good/);
  assert.doesNotMatch(out, /\[object Object\]/);
});
