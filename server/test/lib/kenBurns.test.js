import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kenBurnsFilter } from '../../src/lib/kenBurns.js';

test('builds a zoompan filter sized to the canvas with the right frame count', () => {
  const f = kenBurnsFilter(1080, 1920, 5, 30);
  assert.match(f, /zoompan=/);
  assert.match(f, /s=1080x1920/);
  assert.match(f, /:d=150/, 'd = durSec * fps = 5*30');
  assert.match(f, /fps=30/);
  assert.match(f, /^scale=/);
});

test('zoom expression increases monotonically and is capped', () => {
  const f = kenBurnsFilter(1080, 1920, 5, 30);
  assert.match(f, /zoom\+0\.0\d+/, 'zoom increments each frame');
  assert.match(f, /min\(/, 'zoom is capped');
});

test('clamps degenerate durations to at least 1 frame', () => {
  const f = kenBurnsFilter(1080, 1920, 0, 30);
  assert.match(f, /:d=1/);
});

test('rounds canvas dims to integers', () => {
  const f = kenBurnsFilter(1080.4, 1920.6, 3, 25);
  assert.match(f, /s=1080x1921/);
  assert.match(f, /:d=75/);
});
