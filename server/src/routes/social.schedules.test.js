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

  // The per-schedule Save button sends { schedule }. Pausing used to come back
  // Enabled after a refresh because nothing reached the server.
  test('saving one schedule as disabled keeps it paused after a reload, and Remove deletes it', async () => {
    const { a } = app();
    const schedule = {
      id: 'sch_sunday', name: 'Sunday', enabled: true, type: 'auto_generate',
      cron: '0 9 * * 0', timezone: 'Europe/London', destination: 'webhook', caption: '', videoUrl: '',
    };
    await request(a).post('/api/social/schedules').send({ schedule }).expect(200);
    await request(a).post('/api/social/schedules').send({ schedule: { ...schedule, enabled: false } }).expect(200);

    const list = await request(a).get('/api/social/schedules').expect(200);
    assert.equal(list.body.schedules.length, 1, 'the same schedule is updated, not added twice');
    assert.equal(list.body.schedules[0].enabled, false);

    await request(a).delete('/api/social/schedules/sch_sunday').expect(200);
    const after = await request(a).get('/api/social/schedules').expect(200);
    assert.deepEqual(after.body.schedules, []);
  });

  // Codex P2 on PR #80: the per-card Save sent no kineticCaptions, and the
  // store defaults a missing value to true, so pausing a schedule switched its
  // captions back on.
  test('saving one schedule without kineticCaptions keeps an existing opt-out', async () => {
    const { a } = app();
    const schedule = {
      id: 'sch_plain', name: 'Plain', enabled: true, type: 'auto_generate',
      cron: '0 9 * * 0', timezone: 'Europe/London', destination: 'webhook', caption: '', videoUrl: '',
    };
    await request(a).post('/api/social/schedules').send({ schedule: { ...schedule, kineticCaptions: false } }).expect(200);
    await request(a).post('/api/social/schedules').send({ schedule: { ...schedule, enabled: false } }).expect(200);
    const list = await request(a).get('/api/social/schedules').expect(200);
    assert.equal(list.body.schedules[0].enabled, false);
    assert.equal(list.body.schedules[0].kineticCaptions, false);
  });

  test('a new auto-generate schedule still gets kinetic captions by default', async () => {
    const { a } = app();
    await request(a).post('/api/social/schedules').send({ schedule: {
      id: 'sch_new', name: 'New', type: 'auto_generate', cron: '0 6 * * *', timezone: 'Europe/London', destination: 'webhook',
    } }).expect(200);
    const list = await request(a).get('/api/social/schedules').expect(200);
    assert.equal(list.body.schedules[0].kineticCaptions, true);
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

describe('social schedules — agent-created marker (R35)', () => {
  const AUTO = { name: 'Agent post', type: 'auto_generate', cron: '0 6 * * *', timezone: 'UTC', destination: 'webhook', enabled: false };

  test('a schedule saved with createdByAgentKeyId keeps it on disk and in the list', async () => {
    const { a, dataDir } = app();
    const res = await request(a).post('/api/social/schedules').send({ schedule: { ...AUTO, createdByAgentKeyId: 'ak_123' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.schedule.createdByAgentKeyId, 'ak_123');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'social.json'), 'utf8'));
    assert.equal(onDisk.schedules[0].createdByAgentKeyId, 'ak_123');
  });

  test('a schedule saved without it has no marker, and re-saving an agent schedule from the app keeps the marker', async () => {
    const { a } = app();
    const plain = await request(a).post('/api/social/schedules').send(AUTO).expect(200);
    assert.equal(Object.hasOwn(plain.body.schedule, 'createdByAgentKeyId'), false);
    const made = await request(a).post('/api/social/schedules').send({ schedule: { ...AUTO, createdByAgentKeyId: 'ak_9' } }).expect(200);
    const resaved = await request(a).post('/api/social/schedules').send({ ...AUTO, id: made.body.schedule.id, name: 'Renamed' }).expect(200);
    assert.equal(resaved.body.schedule.createdByAgentKeyId, 'ak_9');
  });

  test('a marker that is not a plain id is dropped', async () => {
    const { a } = app();
    const res = await request(a).post('/api/social/schedules').send({ schedule: { ...AUTO, createdByAgentKeyId: { $gt: '' } } }).expect(200);
    assert.equal(Object.hasOwn(res.body.schedule, 'createdByAgentKeyId'), false);
  });
});
