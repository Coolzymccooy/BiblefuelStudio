import test from 'node:test';
import assert from 'node:assert/strict';
import * as limits from './backgroundLimits.js';

const { backgroundTooLargeMessage } = limits;

test('names the background using the SAME numbering as the UI badge', () => {
  // The panel labels backgrounds 1..N; the array index is zero-based. The old
  // message leaked the raw index and sent the operator to the wrong thumbnail.
  const msg = backgroundTooLargeMessage(1, '/bg/huge.mp4', 0, 200);
  assert.match(msg, /Background 2/);
});

test('includes the filename so the clip is identifiable', () => {
  const msg = backgroundTooLargeMessage(0, 'https://cdn/x/ocean-4k.mp4?token=1', 0, 200);
  assert.match(msg, /ocean-4k\.mp4\?token=1|ocean-4k\.mp4/);
});

test('reports the actual size when known', () => {
  const msg = backgroundTooLargeMessage(0, '/bg/a.mp4', 314572800, 200);
  assert.match(msg, /300MB/);
});

test('omits the size when it could not be determined', () => {
  const msg = backgroundTooLargeMessage(0, '/bg/a.mp4', 0, 200);
  assert.doesNotMatch(msg, /\(\d+MB\)/);
});

test('tells the operator how to fix it', () => {
  const msg = backgroundTooLargeMessage(0, '/bg/a.mp4', 0, 200);
  assert.match(msg, /Remove it in the Background panel/);
});

test('falls back to a positional name when the path is empty', () => {
  const msg = backgroundTooLargeMessage(2, '', 0, 200);
  assert.match(msg, /background 3|Background 3/);
});

test('no unvetted HEAD helper: remote sizes come from the SSRF-guarded download', () => {
  // remoteContentLength sent a HEAD to any user-supplied URL (including
  // 169.254.169.254) before the vetted download ran. It must not come back.
  assert.equal('remoteContentLength' in limits, false);
});
