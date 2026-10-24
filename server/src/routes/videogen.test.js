import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import videogenRouter, { createVideogenRouter } from './videogen.js';
import { readLedger } from '../lib/videoGen/spend.js';

const ENV_KEYS = ['VIDEO_GEN_ENABLED', 'VIDEO_GEN_PROVIDER', 'VEO_API_KEY', 'VIDEO_GEN_MONTHLY_CAP_USD', 'VEO_USD_PER_SECOND'];
const saved = {};

function snapshotEnv() { for (const key of ENV_KEYS) saved[key] = process.env[key]; }
function clearEnv() { for (const key of ENV_KEYS) delete process.env[key]; }
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function app({ router = videogenRouter, isSuperAdmin = true } = {}) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.ctx = { userId: 'test-user', isSuperAdmin };
    next();
  });
  a.use('/api/video-gen', router);
  return a;
}

describe('video-gen route', () => {
  let ledgerDir;
  beforeEach(() => {
    snapshotEnv();
    clearEnv();
    ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veo-ledger-'));
  });
  afterEach(() => {
    restoreEnv();
    fs.rmSync(ledgerDir, { recursive: true, force: true });
  });

  // A Veo stand-in that records each order and answers with `result`.
  function fakeVeo(result) {
    const calls = [];
    const generate = async (req) => {
      calls.push(req);
      if (result instanceof Error) throw result;
      return result;
    };
    return { calls, router: createVideogenRouter({ ledgerDir, generate }) };
  }
  const order = (a, body = { prompt: 'golden worship light rays', durationSec: 8 }) =>
    request(a).post('/api/video-gen/generate').send(body);

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

  test('GET /status reports enabled for a super admin when Veo credentials are configured', async () => {
    process.env.VEO_API_KEY = 'key';
    const res = await request(app()).get('/api/video-gen/status').expect(200);
    assert.deepEqual(res.body, { ok: true, enabled: true });
  });

  test('everyone else sees it switched off, and an order from them is refused before Veo is called', async () => {
    process.env.VEO_API_KEY = 'key';
    const veo = fakeVeo({ ok: true, publicUrl: 'https://x/v.mp4' });
    assert.deepEqual((await request(app({ isSuperAdmin: false })).get('/api/video-gen/status')).body, { ok: true, enabled: false });
    const res = await order(app({ router: veo.router, isSuperAdmin: false }));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'SUPER_ADMIN_ONLY');
    assert.equal(veo.calls.length, 0);
    assert.equal(readLedger(ledgerDir).settledUsd, 0);
  });

  test('a made clip is charged at the estimate on the AI video ledger', async () => {
    process.env.VEO_API_KEY = 'key';
    const veo = fakeVeo({ ok: true, provider: 'veo', publicUrl: 'https://x/v.mp4' });
    const res = await order(app({ router: veo.router }));
    assert.equal(res.status, 200);
    assert.equal(res.body.costUsd, 6, '8 s at the default $0.75 a second');
    const l = readLedger(ledgerDir);
    assert.equal(l.settledUsd, 6);
    assert.equal(l.clips, 1);
    assert.deepEqual(l.reservations, {});
  });

  test('an order that would pass the monthly cap is refused before Veo is called', async () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = '5';
    const veo = fakeVeo({ ok: true, publicUrl: 'https://x/v.mp4' });
    const res = await order(app({ router: veo.router }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'BUDGET');
    assert.match(res.body.error, /AI video spend/);
    assert.equal(veo.calls.length, 0);
  });

  test('a refusal before Google took the order costs nothing', async () => {
    process.env.VEO_API_KEY = 'key';
    const veo = fakeVeo({ ok: false, provider: 'veo', code: 'VEO_HTTP_ERROR', error: 'quota' });
    assert.equal((await order(app({ router: veo.router }))).status, 502);
    const l = readLedger(ledgerDir);
    assert.equal(l.settledUsd, 0);
    assert.deepEqual(l.reservations, {});
  });

  test('a failure after Google took the order is still counted', async () => {
    process.env.VEO_API_KEY = 'key';
    process.env.VEO_USD_PER_SECOND = '0.4';
    for (const result of [{ ok: false, code: 'VEO_TIMEOUT', error: 'slow' }, new Error('socket hang up')]) {
      const veo = fakeVeo(result);
      const res = await order(app({ router: veo.router }), { prompt: 'p', durationSec: 5 });
      assert.ok(res.status >= 500);
    }
    const l = readLedger(ledgerDir);
    assert.equal(l.settledUsd, 4, 'two 5 s orders at $0.40 a second');
    assert.deepEqual(l.reservations, {});
  });

  test('a ledger that cannot be written fails the request, not the server', async () => {
    process.env.VEO_API_KEY = 'key';
    // A file where the ledger folder should be: every ledger write throws.
    const blocked = path.join(ledgerDir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x');
    const router = createVideogenRouter({ ledgerDir: blocked, generate: async () => ({ ok: true }) });
    const res = await order(app({ router }));
    assert.equal(res.status, 500);
    assert.equal(res.body.ok, false);
  });
});
