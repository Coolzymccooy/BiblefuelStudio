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

describe('POST /config — the "Save Schedules" button path', () => {
  test('a schedule saved as auto_generate reloads as auto_generate', async () => {
    const { a } = app();
    await request(a).post('/api/social/config').send({
      schedules: [{
        id: 'sch_1', name: 'Morning', enabled: true, type: 'auto_generate',
        cron: '0 6 * * *', timezone: 'Europe/London', destination: 'webhook',
      }],
    }).expect(200);

    const back = await request(a).get('/api/social/schedules').expect(200);
    assert.equal(back.body.schedules[0].type, 'auto_generate',
      'the UI reloads from here after saving — a dropped type looks like the form resetting itself');
  });

  test('auto_generate content settings survive the save', async () => {
    const { a } = app();
    await request(a).post('/api/social/config').send({
      schedules: [{
        id: 'sch_1', type: 'auto_generate', cron: '0 22 * * *',
        niche: 'faith', tone: 'warm', durationSec: 25,
      }],
    }).expect(200);

    const s = (await request(a).get('/api/social/schedules').expect(200)).body.schedules[0];
    assert.equal(s.niche, 'faith');
    assert.equal(s.tone, 'warm');
    assert.equal(s.durationSec, 25);
  });

  test('three schedules (morning, night, sunday) all persist with their types', async () => {
    const { a } = app();
    await request(a).post('/api/social/config').send({
      schedules: [
        { id: 's1', name: 'Morning', type: 'auto_generate', cron: '0 6 * * *', timezone: 'Europe/London' },
        { id: 's2', name: 'Night', type: 'auto_generate', cron: '0 22 * * *', timezone: 'Europe/London' },
        { id: 's3', name: 'Sunday', type: 'auto_generate', cron: '0 9 * * 0', timezone: 'Europe/London' },
      ],
    }).expect(200);

    const list = (await request(a).get('/api/social/schedules').expect(200)).body.schedules;
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((s) => s.type), ['auto_generate', 'auto_generate', 'auto_generate']);
    assert.deepEqual(list.map((s) => s.cron), ['0 6 * * *', '0 22 * * *', '0 9 * * 0']);
  });

  test('re-saving what was loaded does not mutate it — the cross-device case', async () => {
    const { a } = app();
    await request(a).post('/api/social/config').send({
      schedules: [{ id: 's1', name: 'Night', type: 'auto_generate', cron: '0 22 * * *', timezone: 'Europe/London' }],
    }).expect(200);

    const first = (await request(a).get('/api/social/schedules')).body.schedules;
    // Another device loads, then saves without editing.
    await request(a).post('/api/social/config').send({ schedules: first }).expect(200);
    const second = (await request(a).get('/api/social/schedules')).body.schedules;
    assert.deepEqual(second, first, 'a no-op save from a second device must not change the schedule');
  });
});
