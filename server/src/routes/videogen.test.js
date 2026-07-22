import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import videogenRouter from './videogen.js';

const ENV_KEYS = ['VIDEO_GEN_ENABLED', 'VIDEO_GEN_PROVIDER', 'VEO_API_KEY'];
const saved = {};

function snapshotEnv() { for (const key of ENV_KEYS) saved[key] = process.env[key]; }
function clearEnv() { for (const key of ENV_KEYS) delete process.env[key]; }
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user' };
    next();
  });
  a.use('/api/video-gen', videogenRouter);
  return a;
}

describe('video-gen route', () => {
  beforeEach(() => { snapshotEnv(); clearEnv(); });
  afterEach(() => restoreEnv());

  test('GET /status reports disabled when no provider is configured', async () => {
    const res = await request(app()).get('/api/video-gen/status').expect(200);
    assert.deepEqual(res.body, { ok: true, enabled: false });
  });

  test('POST /generate returns clear NOT_CONFIGURED instead of pretending to create video', async () => {
    const res = await request(app())
      .post('/api/video-gen/generate')
      .send({ prompt: 'golden worship light rays' })
      .expect(503);

    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'NOT_CONFIGURED');
  });

  test('GET /status reports enabled when Veo credentials are configured', async () => {
    process.env.VEO_API_KEY = 'key';
    const res = await request(app()).get('/api/video-gen/status').expect(200);
    assert.deepEqual(res.body, { ok: true, enabled: true });
  });
});
