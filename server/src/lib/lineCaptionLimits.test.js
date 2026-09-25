import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineDrawtext } from './videoFilters.js';
import { splitPhrases } from './captions.js';
import { buildStoryCaptions, buildSubtitleDrawtext } from './story/storyRender.js';

// 'staggered' is one catalogue shared by word and line captions. For word
// captions it alternates left/centre/right per phrase; line captions pinned
// every line to the left anchor, so the same name meant two different looks.
test('staggered line captions alternate the way staggered word captions do', () => {
  const lines = ['one', 'two', 'three', 'four'];
  const out = buildLineDrawtext({ lines, w: 1080, h: 1920, duration: 8, preset: 'cinematic-default', layout: 'staggered' });
  const xs = [...out.matchAll(/:x=([^:]+):y=/g)].map((m) => m[1]);
  assert.equal(xs.length, 4);
  assert.equal(new Set(xs).size, 3, `three anchors in rotation, got ${JSON.stringify(xs)}`);
  assert.equal(xs[0], xs[3], 'the rotation repeats every three lines');
});

// Per-word captions have a word-count escape hatch because thousands of
// drawtext filters stall ffmpeg. Line captions are cheaper but not free:
// reveal mode wraps each phrase into rows, so a 27-minute sermon still
// reaches four figures. The claim that line mode needs no cap was wrong.
const sermon = (n) => Array.from({ length: n }, (_, i) => ({ text: `word${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));

test('a sermon-length transcript takes the same escape hatch per-word captions take', () => {
  const words = sermon(4000);
  const out = buildStoryCaptions({
    words, w: 1080, h: 1920, durationSec: 1600,
    captions: 'static', captionMotion: 'lines', kineticMaxWords: 900,
  });
  assert.ok(out, 'still produced captions');
  // Past the cap it is the compact lower-third chain, byte for byte — the
  // same fallback the per-word path has always used at this length.
  assert.equal(out, buildSubtitleDrawtext(words, 1080, 1920));
  const capped = out.split('drawtext=').length - 1;
  const uncapped = buildLineDrawtext({
    lines: splitPhrases(words, { maxWords: 7, maxChars: 42 }),
    w: 1080, h: 1920, duration: 1600, reveal: true,
  }).split('drawtext=').length - 1;
  assert.ok(capped < uncapped / 3, `the cap cut the filter count (${capped} vs ${uncapped})`);
});

test('a normal-length transcript still gets real line captions', () => {
  const out = buildStoryCaptions({
    words: sermon(200), w: 1080, h: 1920, durationSec: 90,
    captions: 'static', captionMotion: 'lines', kineticMaxWords: 900,
  });
  const filters = out.split('drawtext=').length - 1;
  assert.ok(filters > 10, `line captions were built, not the subtitle fallback (${filters})`);
});
