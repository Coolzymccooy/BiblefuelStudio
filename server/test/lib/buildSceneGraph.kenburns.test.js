import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneGraph } from '../../src/lib/videoFilters.js';

const img = (p, duration) => ({ backgroundPath: p, duration });

test('kenBurns off: image scene filter has NO zoompan (byte-identical default)', () => {
  const g = buildSceneGraph({ scenes: [img('/a.png', 5)], w: 1080, h: 1920 });
  assert.ok(!g.filterParts.join(';').includes('zoompan'), 'no zoompan by default');
});

test('kenBurns on + image scene: filter adds single-frame zoompan', () => {
  const g = buildSceneGraph({ scenes: [img('/a.png', 5)], w: 1080, h: 1920, kenBurns: true });
  const fc = g.filterParts.join(';');
  assert.match(fc, /zoompan=/);
  assert.match(fc, /trim=end_frame=1/, 'feeds zoompan a single frame');
  assert.match(fc, /s=1080x1920/);
});

test('kenBurns on + VIDEO scene: NO zoompan (motion is image-only)', () => {
  const g = buildSceneGraph({ scenes: [img('/clip.mp4', 5)], w: 1080, h: 1920, kenBurns: true });
  assert.ok(!g.filterParts.join(';').includes('zoompan'), 'video scenes unchanged');
});

test('kenBurns on, multi-scene images: each image scene gets zoompan, xfade preserved', () => {
  const g = buildSceneGraph({ scenes: [img('/a.png', 4), img('/b.jpg', 4)], w: 1080, h: 1920, kenBurns: true });
  const fc = g.filterParts.join(';');
  assert.equal((fc.match(/zoompan=/g) || []).length, 2, 'both image scenes');
  assert.match(fc, /xfade=/, 'crossfade still present');
});
