import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { kenBurnsVariedFilter, moveForIndex, MOVES } from './kenBurnsVaried.js';

describe('moveForIndex', () => {
  test('cycles through every move before repeating', () => {
    const seen = MOVES.map((_, i) => moveForIndex(i));
    assert.equal(new Set(seen).size, MOVES.length);
  });

  test('never repeats the same move on consecutive scenes', () => {
    for (let i = 0; i < 12; i += 1) {
      assert.notEqual(moveForIndex(i), moveForIndex(i + 1), `scenes ${i}/${i + 1} share a move`);
    }
  });

  test('is deterministic — a re-render must match the approved video', () => {
    assert.equal(moveForIndex(7), moveForIndex(7));
  });

  test('handles invalid input without throwing', () => {
    assert.ok(MOVES.includes(moveForIndex(undefined)));
    assert.ok(MOVES.includes(moveForIndex(-3)));
  });
});

describe('kenBurnsVariedFilter', () => {
  test('zooms in for the "in" move', () => {
    const f = kenBurnsVariedFilter(1080, 1920, 5, 30, 'in');
    assert.match(f, /zoompan=z='min\(1/);
  });

  test('zooms out for the "out" move', () => {
    const f = kenBurnsVariedFilter(1080, 1920, 5, 30, 'out');
    assert.match(f, /zoompan=z='max\(1\.06/);
  });

  test('pans horizontally for lateral moves, in opposite directions', () => {
    const left = kenBurnsVariedFilter(1080, 1920, 5, 30, 'left');
    const right = kenBurnsVariedFilter(1080, 1920, 5, 30, 'right');
    assert.match(left, /x='\(iw-iw\/zoom\)\*\(1-on\//);
    assert.match(right, /x='\(iw-iw\/zoom\)\*\(on\//);
    assert.notEqual(left, right);
  });

  test('upscales 2x so zooming does not shimmer', () => {
    assert.match(kenBurnsVariedFilter(1080, 1920, 5), /^scale=2160:3840,/);
  });

  test('frame count follows duration and fps', () => {
    assert.match(kenBurnsVariedFilter(1080, 1920, 5, 30, 'in'), /:d=150:/);
    assert.match(kenBurnsVariedFilter(1080, 1920, 2, 25, 'in'), /:d=50:/);
  });

  test('outputs at the requested canvas size', () => {
    assert.match(kenBurnsVariedFilter(1080, 1920, 5), /s=1080x1920/);
  });

  test('unknown move falls back to a push-in rather than breaking', () => {
    assert.match(kenBurnsVariedFilter(1080, 1920, 5, 30, 'nonsense'), /z='min\(1/);
  });

  test('zero and negative durations still produce a valid filter', () => {
    assert.match(kenBurnsVariedFilter(1080, 1920, 0), /:d=1:/);
  });
});
