import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import transcriptsRouter from '../../src/routes/transcripts.js';

function mkApp(userId = 'u1') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-route-'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { dataDir, outputDir: dataDir, userId }; next(); });
  app.use('/api/transcripts', transcriptsRouter);
  return { app, dataDir };
}
async function http(app) { const { default: supertest } = await import('supertest'); return supertest(app); }
const W = [{ text: 'hi', start: 0, end: 0.4 }];

test('POST saves and GET lists it', async () => {
  const { app } = mkApp();
  const s = await http(app);
  const save = await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: ['Line one'] });
  assert.equal(save.status, 200);
  assert.equal(save.body.item.sourceFile, 'a.mp3');
  const list = await s.get('/api/transcripts');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].label, 'Line one');
});

test('POST 400 on missing sourceFile / bad words', async () => {
  const { app } = mkApp();
  const s = await http(app);
  assert.equal((await s.post('/api/transcripts').send({ words: W, editedLines: [] })).status, 400);
  assert.equal((await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: 'no', editedLines: [] })).status, 400);
  assert.equal((await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: 'no' })).status, 400);
});

test('DELETE removes by id', async () => {
  const { app } = mkApp();
  const s = await http(app);
  const save = await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: [] });
  const id = save.body.item.id;
  const del = await s.delete(`/api/transcripts/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, true);
  assert.equal((await s.get('/api/transcripts')).body.items.length, 0);
});
