import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDownloadName } from '../../src/lib/downloadName.js';

test('prefers the dl param over the path fallback', () => {
  assert.equal(safeDownloadName('sermon.mp4', '/outputs/uuid-x.mp4'), 'sermon.mp4');
});

test('falls back to the path basename when dl is empty', () => {
  assert.equal(safeDownloadName('', '/outputs/uuid-x.mp4'), 'uuid-x.mp4');
});

test('strips CR/LF and quotes (header injection)', () => {
  const out = safeDownloadName('a"\r\nSet-Cookie: x=1.mp4', '');
  assert.ok(!/["\r\n]/.test(out), 'no quotes or newlines remain');
  assert.match(out, /\.mp4$/);
});

test('strips slashes and leading dots (path traversal)', () => {
  assert.equal(safeDownloadName('../../etc/passwd', ''), 'etcpasswd');
  assert.ok(!safeDownloadName('...hidden', '').startsWith('.'));
});

test('replaces exotic characters with underscore', () => {
  assert.equal(safeDownloadName('my file (final)!.mp4', ''), 'my_file__final__.mp4');
});

test('caps length at 128 chars', () => {
  const long = `${'a'.repeat(300)}.mp4`;
  assert.equal(safeDownloadName(long, '').length, 128);
});

test('never returns empty', () => {
  assert.equal(safeDownloadName('', ''), 'download');
  assert.equal(safeDownloadName('///', ''), 'download');
});
