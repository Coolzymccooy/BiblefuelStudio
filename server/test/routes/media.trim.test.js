import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
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
