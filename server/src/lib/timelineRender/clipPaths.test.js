import test from 'node:test';
import assert from 'node:assert/strict';
import { clipMediaPath, clipsWithMedia } from './clipPaths.js';

// The client's model stores media on the ASSET; a clip references it by
// assetId. The renderer only ever read clip.path, so every clip added through
// the UI was silently discarded - images and motion backgrounds never appeared
// in the output.
const plan = {
  assets: {
    a1: { id: 'a1', path: '/outputs/bg.jpg', kind: 'image' },
    a2: { id: 'a2', path: '/outputs/clip.mp4', proxyPath: '/outputs/clip-proxy.mp4', proxyStatus: 'ready' },
    a3: { id: 'a3' },
  },
  tracks: [
    { kind: 'broll', clips: [
      { id: 'c1', assetId: 'a1' },
      { id: 'c2', assetId: 'a2' },
      { id: 'c3', assetId: 'a3' },
      { id: 'c4', path: '/outputs/legacy.mp4' },
    ] },
  ],
};

test('reads the path off the referenced asset', () => {
  assert.equal(clipMediaPath({ assetId: 'a1' }, plan), '/outputs/bg.jpg');
});

test('a path ON the clip still wins, for older plans', () => {
  assert.equal(clipMediaPath({ path: '/outputs/legacy.mp4', assetId: 'a1' }, plan), '/outputs/legacy.mp4');
});

test('uses the ORIGINAL, never the proxy, even when the proxy is ready', () => {
  // Proxies are video-only: they exist for fast scrubbing in the editor.
  // Rendering from one dropped the audio track, and the graph then failed on
  // [0:a] with "matches no streams" - the render produced nothing usable.
  assert.equal(clipMediaPath({ assetId: 'a2' }, plan), '/outputs/clip.mp4');
});

test('falls back to the proxy only when there is no original', () => {
  const p = { assets: { x: { proxyPath: '/o/a-p.mp4', proxyStatus: 'ready' } }, tracks: [] };
  assert.equal(clipMediaPath({ assetId: 'x' }, p), '/o/a-p.mp4');
});

test('an asset with no media yields nothing', () => {
  assert.equal(clipMediaPath({ assetId: 'a3' }, plan), null);
});

test('an unknown assetId yields nothing rather than throwing', () => {
  assert.equal(clipMediaPath({ assetId: 'nope' }, plan), null);
});

test('clipsWithMedia keeps every clip that resolves', () => {
  const out = clipsWithMedia(plan, 'broll');
  assert.equal(out.length, 3);           // c1, c2, c4 - c3 has no media
  assert.equal(out[0].resolvedMediaPath, '/outputs/bg.jpg');
});

test('clipsWithMedia is empty for a missing track', () => {
  assert.deepEqual(clipsWithMedia(plan, 'captions'), []);
});
