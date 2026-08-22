import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyRenderError } from './renderErrors.js';

// The operator was shown a 20-line ffmpeg filtergraph dump ending in
// "Error binding filtergraph inputs/outputs: Invalid argument". That is not an
// error message a person can act on.
const REAL_STDERR = `[fc#0 @ 000001a785e49d00] Stream specifier ':a' in filtergraph description
[0:v]scale=1280:720,setsar=1[base0];[0:a]volume=0.35[basea];
[amixed]alimiter=limit=0.95[a] matches no streams.
Error binding filtergraph inputs/outputs: Invalid argument`;

test('a filtergraph rejection becomes a readable sentence', () => {
  const msg = friendlyRenderError('timeline-render', REAL_STDERR);
  assert.doesNotMatch(msg, /\[0:a\]|filtergraph description|scale=/);
  assert.match(msg, /your files are fine/i);
});

test('it carries a ref tag so the failure can be traced', () => {
  assert.match(friendlyRenderError('timeline-render', REAL_STDERR), /render-filtergraph/);
});

test('"matches no streams" alone is enough to classify it', () => {
  const msg = friendlyRenderError('x', "Stream specifier ':a' matches no streams.");
  assert.match(msg, /render-filtergraph/);
});

test('a missing input still maps to the input error, not filtergraph', () => {
  const msg = friendlyRenderError('x', 'No such file or directory');
  assert.match(msg, /render-input/);
});

test('an unknown failure still returns SOMETHING readable', () => {
  const msg = friendlyRenderError('x', 'something nobody predicted');
  assert.ok(msg.length > 10);
  assert.doesNotMatch(msg, /undefined|null/);
});
