import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTrimRequest } from '../../src/lib/trimValidate.js';

function mkOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trim-val-'));
}

test('accepts a file inside the user output dir with a valid range', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 1, endSec: 5, outputDir });
  assert.equal(r.ok, true);
  assert.equal(r.resolvedPath, fs.realpathSync(file));
});

test('rejects a path outside the user output dir (traversal)', () => {
  const outputDir = mkOutDir();
  const outside = path.join(os.tmpdir(), 'evil.mp3');
  fs.writeFileSync(outside, 'x');
  const r = validateTrimRequest({ inputPath: outside, startSec: 0, endSec: 3, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /outside|not allowed|invalid path/i);
});

test('rejects a missing file', () => {
  const outputDir = mkOutDir();
  const r = validateTrimRequest({ inputPath: path.join(outputDir, 'nope.mp3'), startSec: 0, endSec: 3, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/i);
});

test('rejects endSec <= startSec', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 5, endSec: 5, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /range/i);
});

test('rejects a selection shorter than 0.1s', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 1, endSec: 1.05, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /short|0\.1/i);
});

test('rejects negative startSec', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: -1, endSec: 3, outputDir });
  assert.equal(r.ok, false);
});
