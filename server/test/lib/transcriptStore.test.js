import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTranscripts, listTranscripts, upsertTranscript, deleteTranscript } from '../../src/lib/transcriptStore.js';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tx-store-')); }
const W = [{ text: 'hello', start: 0, end: 0.5 }];

test('upsert creates a record with id/timestamps/label/lineCount', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['Hello world'], now: '2026-06-06T00:00:00.000Z' });
  assert.ok(rec.id);
  assert.equal(rec.userId, 'u1');
  assert.equal(rec.sourceFile, 'a.mp3');
  assert.equal(rec.label, 'Hello world');
  assert.equal(rec.lineCount, 1);
  assert.equal(rec.createdAt, '2026-06-06T00:00:00.000Z');
  assert.equal(rec.updatedAt, '2026-06-06T00:00:00.000Z');
  assert.equal(readTranscripts(dir).length, 1);
});

test('upsert by sourceFile updates in place, preserves createdAt, moves to front', () => {
  const dir = mkDir();
  upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['v1'], now: '2026-06-06T00:00:00.000Z' });
  upsertTranscript(dir, 'u1', { sourceFile: 'b.mp3', words: W, editedLines: ['other'], now: '2026-06-06T00:01:00.000Z' });
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['v2'], now: '2026-06-06T00:02:00.000Z' });
  const all = readTranscripts(dir);
  assert.equal(all.length, 2, 'no duplicate entry for a.mp3');
  assert.equal(all[0].sourceFile, 'a.mp3', 'updated entry moved to front');
  assert.equal(rec.editedLines[0], 'v2');
  assert.equal(rec.createdAt, '2026-06-06T00:00:00.000Z', 'createdAt preserved');
  assert.equal(rec.updatedAt, '2026-06-06T00:02:00.000Z', 'updatedAt bumped');
});

test('sourceFile is reduced to a basename (no path traversal in key)', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: '/abs/../../x/a.mp3', words: W, editedLines: [], now: '2026-06-06T00:00:00.000Z' });
  assert.equal(rec.sourceFile, 'a.mp3');
});

test('list filters by userId and caps at 50', () => {
  const dir = mkDir();
  for (let i = 0; i < 55; i++) upsertTranscript(dir, 'u1', { sourceFile: `f${i}.mp3`, words: W, editedLines: [], now: `2026-06-06T00:${String(i).padStart(2, '0')}:00.000Z` });
  upsertTranscript(dir, 'u2', { sourceFile: 'other.mp3', words: W, editedLines: [], now: '2026-06-06T01:00:00.000Z' });
  const u1 = listTranscripts(dir, 'u1', 100);
  assert.equal(u1.length, 50, 'capped at 50');
  assert.ok(u1.every((t) => t.userId === 'u1'), 'only u1 records');
});

test('delete removes by id+userId, returns boolean', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: [], now: '2026-06-06T00:00:00.000Z' });
  assert.equal(deleteTranscript(dir, 'u2', rec.id), false, 'wrong user cannot delete');
  assert.equal(deleteTranscript(dir, 'u1', rec.id), true);
  assert.equal(readTranscripts(dir).length, 0);
});

test('corrupt file reads as empty list (never throws)', () => {
  const dir = mkDir();
  fs.writeFileSync(path.join(dir, 'transcripts.json'), '{ not json', 'utf-8');
  assert.deepEqual(readTranscripts(dir), []);
});
