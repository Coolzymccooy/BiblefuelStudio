import test from 'node:test';
import assert from 'node:assert/strict';
import { kerningModeForVersion, drawtextKerning } from './drawtextKerning.js';

test('ffmpeg before 6.1 kerns drawtext the legacy way', () => {
  assert.equal(kerningModeForVersion('ffmpeg version 5.1.6-0+deb12u1 Copyright (c) 2000-2024'), 'legacy');
  assert.equal(kerningModeForVersion('ffmpeg version n5.1.2'), 'legacy');
  assert.equal(kerningModeForVersion('ffmpeg version 6.0 Copyright'), 'legacy');
  assert.equal(kerningModeForVersion('ffmpeg version 4.4.2-0ubuntu0.22.04.1'), 'legacy');
});

test('ffmpeg 6.1 and later shape text', () => {
  assert.equal(kerningModeForVersion('ffmpeg version 6.1.1-3ubuntu5'), 'shaped');
  assert.equal(kerningModeForVersion('ffmpeg version 8.0.1-essentials_build-www.gyan.dev'), 'shaped');
  assert.equal(kerningModeForVersion('ffmpeg version N-117000-g1234abcd'), 'shaped');
});

test('DRAWTEXT_KERNING overrides the probe', () => {
  const before = process.env.DRAWTEXT_KERNING;
  try {
    process.env.DRAWTEXT_KERNING = 'legacy';
    assert.equal(drawtextKerning(), 'legacy');
    process.env.DRAWTEXT_KERNING = 'none';
    assert.equal(drawtextKerning(), 'none');
  } finally {
    if (before === undefined) delete process.env.DRAWTEXT_KERNING;
    else process.env.DRAWTEXT_KERNING = before;
  }
});
