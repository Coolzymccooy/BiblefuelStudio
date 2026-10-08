import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import express from 'express';
import request from 'supertest';
import brandingRouter from './branding.js';
import { brandLogoFor, logoFileFor } from '../lib/branding.js';

const FF = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const hasFfmpeg = spawnSync(FF, ['-version']).status === 0;

let root;
let pngBytes;
let bigPng;

function app(dataDir) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { dataDir, outputDir: dataDir, userId: path.basename(dataDir) }; next(); });
  a.use('/api/branding', brandingRouter);
  return a;
}

function account() {
  return fs.mkdtempSync(path.join(root, 'acct-'));
}

function dims(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file]);
  return String(r.stdout).trim();
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'branding-route-'));
  if (!hasFfmpeg) return;
  const small = path.join(root, 'small.png');
  const big = path.join(root, 'big.png');
  spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=200x100,format=rgba', '-frames:v', '1', small]);
  spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=2000x1000', '-frames:v', '1', big]);
  pngBytes = fs.readFileSync(small);
  bigPng = fs.readFileSync(big);
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe('/api/branding', () => {
  test('a new account has branding off and no logo', async () => {
    const res = await request(app(account())).get('/api/branding');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.branding, {
      enabled: false, position: 'top-right', size: 'medium', opacity: 0.85, hasLogo: false, logoDataUrl: null,
    });
  });

  test('branding cannot be turned on before a logo is uploaded', async () => {
    const res = await request(app(account())).put('/api/branding').send({ enabled: true });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /logo/i);
  });

  test('uploading a logo stores it as a PNG and turns branding on', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const dir = account();
    const res = await request(app(dir)).post('/api/branding/logo').set('Content-Type', 'image/png').send(pngBytes);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.branding.enabled, true);
    assert.equal(res.body.branding.hasLogo, true);
    assert.match(res.body.branding.logoDataUrl, /^data:image\/png;base64,/);
    assert.equal(dims(logoFileFor(dir)), '200,100,rgba', 'small logos keep their size and transparency');
    assert.ok(brandLogoFor(dir), 'renders now pick it up');
    const stray = fs.readdirSync(path.dirname(logoFileFor(dir))).filter((f) => f !== 'logo.png');
    assert.deepEqual(stray, [], 'no upload leftovers');
  });

  test('a large logo is scaled down into a 512px box', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const dir = account();
    const res = await request(app(dir)).post('/api/branding/logo').set('Content-Type', 'image/png').send(bigPng);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(dims(logoFileFor(dir)), '512,256,rgba');
  });

  test('something that is not an image is refused and leaves nothing behind', async () => {
    const dir = account();
    const res = await request(app(dir)).post('/api/branding/logo')
      .set('Content-Type', 'image/png').send(Buffer.from('<svg>'.padEnd(400, ' ')));
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(logoFileFor(dir)), false);
    assert.deepEqual(fs.readdirSync(path.dirname(logoFileFor(dir))), []);
  });

  test('settings can be changed, and only known settings are taken', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const dir = account();
    await request(app(dir)).post('/api/branding/logo').set('Content-Type', 'image/png').send(pngBytes);
    const res = await request(app(dir)).put('/api/branding')
      .send({ position: 'bottom-left', size: 'small', opacity: 0.5, file: '/etc/passwd' });
    assert.equal(res.status, 200);
    assert.equal(res.body.branding.position, 'bottom-left');
    assert.equal(res.body.branding.size, 'small');
    assert.equal(res.body.branding.opacity, 0.5);
    assert.equal(brandLogoFor(dir).file, logoFileFor(dir), 'the logo path is never taken from the request');
  });

  test('removing the logo turns branding off', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const dir = account();
    await request(app(dir)).post('/api/branding/logo').set('Content-Type', 'image/png').send(pngBytes);
    const res = await request(app(dir)).delete('/api/branding/logo');
    assert.equal(res.status, 200);
    assert.equal(res.body.branding.enabled, false);
    assert.equal(res.body.branding.hasLogo, false);
    assert.equal(brandLogoFor(dir), null);
  });

  test('one account\'s logo is invisible to another', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
    const a = account();
    const b = account();
    await request(app(a)).post('/api/branding/logo').set('Content-Type', 'image/png').send(pngBytes);
    const res = await request(app(b)).get('/api/branding');
    assert.equal(res.body.branding.hasLogo, false);
    assert.equal(brandLogoFor(b), null);
  });
});
