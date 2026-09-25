import test from 'node:test';
import assert from 'node:assert/strict';
import { pathCanHaveAudio, planAudioSources } from './audioGraph.js';

test('an image cannot carry audio', () => {
  for (const p of ['/a/bg.jpg', '/a/bg.JPEG', '/a/x.png', '/a/x.webp', '/a/x.gif']) {
    assert.equal(pathCanHaveAudio(p), false, p);
  }
});

test('video and audio files can', () => {
  for (const p of ['/a/clip.mp4', '/a/clip.mov', '/a/bed.mp3', '/a/vo.wav']) {
    assert.equal(pathCanHaveAudio(p), true, p);
  }
});

test('a query string does not hide the extension', () => {
  assert.equal(pathCanHaveAudio('https://cdn/x/bg.jpg?token=abc'), false);
});

test('an empty path carries nothing', () => {
  assert.equal(pathCanHaveAudio(''), false);
  assert.equal(pathCanHaveAudio(null), false);
});

test('base audio is skipped when the main clip is an image', () => {
  // This is the exact failure: Real footage empty, so the main clip fell back
  // to a B-roll still, and [0:a] matched no streams.
  const r = planAudioSources({ mainPath: '/a/bg.jpg' });
  assert.equal(r.useBaseAudio, false);
});

test('base audio is used when the main clip is a video', () => {
  assert.equal(planAudioSources({ mainPath: '/a/sermon.mp4' }).useBaseAudio, true);
});

test('an image main clip still has audio when a voice-over exists', () => {
  const r = planAudioSources({ mainPath: '/a/bg.jpg', voiceovers: [{ resolvedPath: '/a/vo.wav' }] });
  assert.equal(r.useBaseAudio, false);
  assert.equal(r.hasAnyAudio, true);
});

test('an image main clip still has audio when music exists', () => {
  const r = planAudioSources({ mainPath: '/a/bg.jpg', music: { resolvedPath: '/a/bed.mp3' } });
  assert.equal(r.hasAnyAudio, true);
});

test('images alone means a SILENT render, not a broken one', () => {
  const r = planAudioSources({ mainPath: '/a/bg.jpg' });
  assert.equal(r.hasAnyAudio, false);
});
