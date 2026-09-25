import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWordDrawtext } from './videoFilters.js';

// The Story project store persists "Layered depth" as one of the strings
// none/soft/hard (that is the catalogue the captions route validates
// against). resolveDepth only understood `true` and `{dx,dy,...}`, so a
// string fell through to null — and because `depth ?? style.depth` treats a
// string as present, picking "soft" actively CANCELLED the preset's own
// ghost instead of drawing one.

const W = 1080;
const H = 1920;
const words = [
  { text: 'Be', start: 0, end: 0.4 },
  { text: 'still', start: 0.4, end: 0.9 },
];
// The ghost is the only layer drawn with borderw=0 and an @opacity colour.
const ghosts = (out) => [...String(out || '').matchAll(/fontcolor=([a-z]+)@([\d.]+):borderw=0/g)];

test('a "soft" depth draws the ghost, the same way `true` does', () => {
  const soft = buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: 'soft' });
  const yes = buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: true });
  assert.ok(ghosts(soft).length > 0, 'soft produced a ghost layer');
  assert.equal(ghosts(soft).length, ghosts(yes).length);
});

test('"hard" is a heavier ghost than "soft"', () => {
  const soft = ghosts(buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: 'soft' }));
  const hard = ghosts(buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: 'hard' }));
  assert.ok(Number(hard[0][2]) > Number(soft[0][2]), 'hard is more opaque');
});

test('"none" means none, even when the preset asks for a ghost', () => {
  const out = buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: 'none' });
  assert.equal(ghosts(out).length, 0);
});

test('an unknown depth string is ignored rather than cancelling the preset', () => {
  const base = buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default' });
  const odd = buildWordDrawtext({ words, w: W, h: H, preset: 'cinematic-default', depth: 'wibble' });
  assert.equal(odd, base);
});
