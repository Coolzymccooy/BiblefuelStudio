import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import imagegenRouter, { _setGenerateImpl, _setEnabledImpl, _reset } from '../../src/routes/imagegen.js';

function mkApp(plan = 'free') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgen-'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { dataDir, outputDir: dataDir, userId: 'u1', plan }; next(); });
  app.use('/api/imagegen', imagegenRouter);
  return { app, dataDir };
}
async function http(app) { const { default: supertest } = await import('supertest'); return supertest(app); }

test('happy path: generates N images, increments usage by N', async () => {
  const { app, dataDir } = mkApp();
  _setEnabledImpl(() => true);
  _setGenerateImpl(async ({ partNumber }) => ({ ok: true, path: `/abs/part-${partNumber}.png`, publicUrl: `/outputs/genImg/x/part-${partNumber}.png` }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['line a', 'line b'], count: 2, aspect: 'portrait' });
  assert.equal(res.status, 200);
  assert.equal(res.body.generated, 2);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].kind, 'image');
  const usage = JSON.parse(fs.readFileSync(path.join(dataDir, 'usage.json'), 'utf-8'));
  assert.ok((usage?.counts?.imageGen ?? 0) >= 2, 'usage incremented per image');
  _reset();
});

test('partial failure returns successes + failed count', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  _setGenerateImpl(async ({ partNumber }) => partNumber === 1 ? { ok: true, path: '/a.png', publicUrl: '/outputs/genImg/x/a.png' } : { ok: false, error: 'boom' });
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a', 'b'], count: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.generated, 1);
  assert.equal(res.body.failed, 1);
  _reset();
});

test('zero successes -> 502', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  _setGenerateImpl(async () => ({ ok: false, error: 'boom' }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 502);
  _reset();
});

test('not configured -> 503', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => false);
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 503);
  _reset();
});

test('count is clamped to 4', async () => {
  const { app } = mkApp('premium');
  _setEnabledImpl(() => true);
  _setGenerateImpl(async ({ partNumber }) => ({ ok: true, path: `/p${partNumber}.png`, publicUrl: `/outputs/genImg/x/p${partNumber}.png` }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a','b','c','d','e','f'], count: 10 });
  assert.equal(res.status, 200);
  assert.ok(res.body.generated <= 4, 'never more than 4');
  _reset();
});

test('empty lines -> 400', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: [], count: 2 });
  assert.equal(res.status, 400);
  _reset();
});

test('quota exhausted -> 429', async () => {
  const { app, dataDir } = mkApp('free');
  fs.writeFileSync(path.join(dataDir, 'usage.json'), JSON.stringify({ day: new Date().toISOString().slice(0,10), counts: { imageGen: 5 } }), 'utf-8');
  _setEnabledImpl(() => true);
  _setGenerateImpl(async () => ({ ok: true, path: '/a.png', publicUrl: '/outputs/genImg/x/a.png' }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 429);
  _reset();
});
