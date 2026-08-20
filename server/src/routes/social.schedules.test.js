import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import socialRouter from './social.js';

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-sched-'));
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user', dataDir, outputDir: dataDir };
    next();
  });
  a.use('/api/social', socialRouter);
  return { a, dataDir };
}

describe('social schedules — daily automation', () => {
  test('auto_generate schedule saves without caption/videoUrl', async () => {
    const { a } = app();
    const res = await request(a).post('/api/social/schedules').send({
      name: 'Morning post',
      type: 'auto_generate',
      cron: '0 6 * * *',
      timezone: 'Europe/London',
      destination: 'webhook',
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.schedule.type, 'auto_generate');
  });

  test('auto_generate schedule persists to the store it saved into', async () => {
    const { a, dataDir } = app();
    await request(a).post('/api/social/schedules').send({
      name: 'Night post', type: 'auto_generate', cron: '0 22 * * *',
      timezone: 'Europe/London', destination: 'webhook',
    }).expect(200);

    const list = await request(a).get('/api/social/schedules').expect(200);
    assert.equal(list.body.schedules.length, 1, 'schedule should be readable after save');

    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'social.json'), 'utf8'));
    assert.equal((onDisk.schedules || []).length, 1, 'schedule must be on disk for boot rehydration');
  });

  test('replay schedule without caption/videoUrl is rejected with a helpful error', async () => {
    const { a } = app();
    const res = await request(a).post('/api/social/schedules').send({
      name: 'Auto Post', type: 'replay', cron: '0 */12 * * *',
      timezone: 'UTC', destination: 'webhook', caption: '', videoUrl: '',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /auto-generate/i,
      'error should point the user at auto_generate, not just say the fields are required');
  });
});
