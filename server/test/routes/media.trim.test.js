import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { spawnSync } from 'node:child_process';
import mediaRouter from '../../src/routes/media.js';

function mkApp() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-trim-'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { outputDir, dataDir: outputDir }; next(); });
  app.use('/api/media', mediaRouter);
  return { app, outputDir };
}

async function post(app, body) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/media/trim').send(body);
}

test('rejects a path outside the user output dir with 400', async () => {
  const { app } = mkApp();
  const outside = path.join(os.tmpdir(), `evil-${Date.now()}.mp3`);
  fs.writeFileSync(outside, 'x');
  const res = await post(app, { inputPath: outside, startSec: 0, endSec: 3 });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('rejects an inverted range with 400', async () => {
  const { app, outputDir } = mkApp();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const res = await post(app, { inputPath: file, startSec: 5, endSec: 2 });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('rejects a missing file with 400', async () => {
  const { app, outputDir } = mkApp();
  const res = await post(app, { inputPath: path.join(outputDir, 'ghost.mp3'), startSec: 0, endSec: 3 });
  assert.equal(res.status, 400);
});

function ffmpegAvailable() {
  try { return spawnSync('ffmpeg', ['-version']).status === 0; } catch { return false; }
}

test('happy path: trims audio to a new shorter file (skips without ffmpeg)', { skip: ffmpegAvailable() ? false : 'ffmpeg not installed' }, async () => {
  const { app, outputDir } = mkApp();
  const src = path.join(outputDir, 'src.mp3');
  const gen = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-ar', '44100', src]);
  assert.equal(gen.status, 0, 'ffmpeg should generate the source mp3');

  const res = await post(app, { inputPath: src, startSec: 1, endSec: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(String(res.body.file), /trimmed-.*\.mp3$/);
  assert.ok(fs.existsSync(res.body.file), 'trimmed file should exist on disk');
  assert.ok(fs.existsSync(src), 'original file should be left in place');
  assert.ok(Number(res.body.durationSec) > 2 && Number(res.body.durationSec) < 4, 'trimmed duration ~3s');
});
