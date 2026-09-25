import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createAccessRequestsRouter } from '../../src/routes/accessRequests.js';
import { createAccessRequestsStore } from '../../src/lib/accessRequestsStore.js';

function mkApp({ notifyTo = 'ops@example.com' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-route-'));
  const store = createAccessRequestsStore({ dir });
  const sent = [];
  const sendEmailFake = async (req) => { sent.push(req); return { ok: true, id: 'm1', kind: req.kind }; };
  const app = express();
  app.use(express.json());
  app.use('/api/access-requests',
    createAccessRequestsRouter({ store, sendEmail: sendEmailFake, notifyTo }));
  return { app, dir, sent };
}

async function post(app, body, headers = {}) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/access-requests').set(headers).send(body);
}

const valid = {
  name: 'Ada', email: 'ada@example.com', org: 'DEM',
  pitch: 'Devotional for engineers.', hp_url: '',
};

test('happy path: 200, store appended, email sent with replyTo', async () => {
  const { app, dir, sent } = mkApp();
  const res = await post(app, valid);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const all = JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8'));
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'Ada');

  // Email is fire-and-forget — give it a microtask tick to land.
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'access-request');
  assert.equal(sent[0].to, 'ops@example.com');
  assert.equal(sent[0].email, 'ada@example.com');
});

test('honeypot: non-empty hp_url returns 200 but does NOT append or email', async () => {
  const { app, dir, sent } = mkApp();
  const res = await post(app, { ...valid, hp_url: 'http://spam' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  await new Promise((r) => setImmediate(r));
  const empty = !fs.existsSync(path.join(dir, 'access-requests.json'))
    || JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8')).length === 0;
  assert.ok(empty);
  assert.equal(sent.length, 0);
});

test('validation: missing email returns 400 with issues array', async () => {
  const { app } = mkApp();
  const res = await post(app, { ...valid, email: '' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'VALIDATION');
  assert.ok(Array.isArray(res.body.issues));
});

test('validation: oversize pitch returns 400', async () => {
  const { app } = mkApp();
  const res = await post(app, { ...valid, pitch: 'x'.repeat(501) });
  assert.equal(res.status, 400);
});

test('rate limit: 4th submission in window returns 429', async () => {
  const { app } = mkApp();
  // Use distinct emails per submission so the dedupe gate (which now
  // rejects same-email re-submits with 409 ALREADY_PENDING) doesn't fire
  // before the rate limiter has a chance to.
  for (let i = 0; i < 3; i++) {
    const r = await post(app, { ...valid, email: `ada${i}@example.com` });
    assert.equal(r.status, 200);
  }
  const fourth = await post(app, { ...valid, email: 'ada3@example.com' });
  assert.equal(fourth.status, 429);
});

test('dedupe: second submission with same email while first is pending returns 409', async () => {
  const { app } = mkApp();
  const first = await post(app, valid);
  assert.equal(first.status, 200);

  const second = await post(app, { ...valid, pitch: 'Same email again with a new pitch.' });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ALREADY_PENDING');
});

test('dedupe: re-submission allowed after a request is marked denied', async () => {
  const { app, dir } = mkApp();
  const first = await post(app, valid);
  assert.equal(first.status, 200);

  // Mutate the on-disk record to simulate the operator denying it.
  const filePath = path.join(dir, 'access-requests.json');
  const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  records[0].status = 'denied';
  records[0].reviewedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');

  const retry = await post(app, valid);
  assert.equal(retry.status, 200);
});

test('email failure does not break the response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-fail-'));
  const store = createAccessRequestsStore({ dir });
  const sendEmailFake = async () => ({ ok: false, kind: 'access-request', error: 'boom' });
  const app = express();
  app.use(express.json());
  app.use('/api/access-requests',
    createAccessRequestsRouter({ store, sendEmail: sendEmailFake, notifyTo: 'x@y.z' }));

  const { default: supertest } = await import('supertest');
  const res = await supertest(app).post('/api/access-requests').send(valid);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const all = JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8'));
  assert.equal(all.length, 1);
});
