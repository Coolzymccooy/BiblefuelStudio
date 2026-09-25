import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';

// The issues router pulls its store via getIssuesStore(), which lazily
// constructs against DATA_DIR. We override DATA_DIR via env BEFORE importing
// the router so the test runs in a tmp dir.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-route-'));
process.env.DATA_DIR = TEST_DIR;

const issuesRouter = (await import('../../src/routes/issues.js')).default;

function mkApp({ ctx } = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  app.use('/api/issues', issuesRouter);
  return app;
}

// 1x1 transparent PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function post(app, body) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/issues').send(body);
}

test('POST /api/issues accepts a valid PNG attachment + persists file', async () => {
  const userId = 'u-attach-1';
  const dataDir = path.join(TEST_DIR, 'users', userId);
  fs.mkdirSync(dataDir, { recursive: true });
  const app = mkApp({ ctx: { userId, email: 'u@x.y', dataDir, isSuperAdmin: false } });

  const res = await post(app, {
    title: 'screenshot test',
    body: 'see attached',
    attachments: [{ originalName: 'pic.png', mimeType: 'image/png', dataBase64: PNG_BASE64 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const attachDir = path.join(dataDir, 'issue-attachments');
  const files = fs.readdirSync(attachDir);
  assert.equal(files.length, 1);
  assert.match(files[0], /\.png$/);
});

test('POST /api/issues rejects unsupported attachment MIME', async () => {
  const userId = 'u-attach-2';
  const dataDir = path.join(TEST_DIR, 'users', userId);
  fs.mkdirSync(dataDir, { recursive: true });
  const app = mkApp({ ctx: { userId, email: 'u@x.y', dataDir, isSuperAdmin: false } });

  const res = await post(app, {
    title: 'bad type',
    body: 'should fail',
    attachments: [{ originalName: 'evil.exe', mimeType: 'application/x-msdownload', dataBase64: PNG_BASE64 }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ATTACHMENT');
});

test('POST /api/issues caps attachments at 3 (zod max)', async () => {
  const userId = 'u-attach-3';
  const dataDir = path.join(TEST_DIR, 'users', userId);
  fs.mkdirSync(dataDir, { recursive: true });
  const app = mkApp({ ctx: { userId, email: 'u@x.y', dataDir, isSuperAdmin: false } });

  const att = { originalName: 'p.png', mimeType: 'image/png', dataBase64: PNG_BASE64 };
  const res = await post(app, {
    title: 'too many',
    body: 'body',
    attachments: [att, att, att, att],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'VALIDATION');
});

test('GET /api/issues/attachments/:filename rejects path traversal', async () => {
  const userId = 'u-attach-4';
  const dataDir = path.join(TEST_DIR, 'users', userId);
  fs.mkdirSync(dataDir, { recursive: true });
  const app = mkApp({ ctx: { userId, email: 'u@x.y', dataDir, isSuperAdmin: false } });

  const { default: supertest } = await import('supertest');
  const traversals = ['../foo', '..\\foo', 'a/b', 'a\\b', '.../...//etc'];
  for (const t of traversals) {
    const res = await supertest(app).get(`/api/issues/attachments/${encodeURIComponent(t)}`);
    assert.equal(res.status, 404, `path "${t}" should 404`);
  }
});

test('GET /api/issues/attachments/:filename serves the owner their file', async () => {
  const userId = 'u-attach-5';
  const dataDir = path.join(TEST_DIR, 'users', userId);
  fs.mkdirSync(dataDir, { recursive: true });
  const app = mkApp({ ctx: { userId, email: 'u@x.y', dataDir, isSuperAdmin: false } });

  // Upload first.
  const uploadRes = await post(app, {
    title: 'self serve',
    body: 'body',
    attachments: [{ originalName: 'p.png', mimeType: 'image/png', dataBase64: PNG_BASE64 }],
  });
  assert.equal(uploadRes.status, 200);

  // Discover the saved filename via the disk listing (route doesn't return it).
  const saved = fs.readdirSync(path.join(dataDir, 'issue-attachments'))[0];

  const { default: supertest } = await import('supertest');
  const getRes = await supertest(app).get(`/api/issues/attachments/${saved}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers['content-type'], 'image/png');
});

test('GET /api/issues/attachments/:filename 404s for non-owner non-admin', async () => {
  const ownerId = 'u-attach-6-owner';
  const ownerDir = path.join(TEST_DIR, 'users', ownerId);
  fs.mkdirSync(ownerDir, { recursive: true });
  const ownerApp = mkApp({ ctx: { userId: ownerId, email: 'owner@x.y', dataDir: ownerDir, isSuperAdmin: false } });

  await post(ownerApp, {
    title: 'private',
    body: 'body',
    attachments: [{ originalName: 'p.png', mimeType: 'image/png', dataBase64: PNG_BASE64 }],
  });
  const saved = fs.readdirSync(path.join(ownerDir, 'issue-attachments'))[0];

  // Now hit it as a different user — should 404.
  const otherId = 'u-attach-6-other';
  const otherDir = path.join(TEST_DIR, 'users', otherId);
  fs.mkdirSync(otherDir, { recursive: true });
  const otherApp = mkApp({ ctx: { userId: otherId, email: 'other@x.y', dataDir: otherDir, isSuperAdmin: false } });

  const { default: supertest } = await import('supertest');
  const res = await supertest(otherApp).get(`/api/issues/attachments/${saved}`);
  assert.equal(res.status, 404);
});
