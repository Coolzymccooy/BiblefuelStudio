import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { OUTPUT_DIR } from '../lib/paths.js';

// The peaks endpoint takes a file path from the QUERY STRING, so path
// confinement is the thing that most needs a test: without it, a ../.. reads
// any file the server process can reach. The ffmpeg-dependent happy path is
// covered by audioPeaks.test.js (the pure downsampler); these tests pin the
// guards, which are the part that fails dangerously rather than visibly.

let app;
let server;
let baseUrl;
let secretPath;
let currentCtx;
let tenantDir;

before(async () => {
  const { default: timelineRouter } = await import('./timeline.js');
  app = express();
  app.use(express.json());
  // Multi-tenant is the DEFAULT in production, so the tests have to be able to
  // act as an ordinary user, not only as the super-admin whose ctx.outputDir
  // happens to equal the global OUTPUT_DIR. Without this the suite only ever
  // exercised the admin path — which is how the tenant bug below shipped.
  app.use((req, _res, next) => { req.ctx = currentCtx; next(); });
  app.use('/api/timeline', timelineRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A file OUTSIDE the output directory, standing in for anything sensitive
  // on the same disk.
  secretPath = path.join(os.tmpdir(), `peaks-guard-${Date.now()}.txt`);
  fs.writeFileSync(secretPath, 'do not read me');

  // Stands in for DATA_DIR/users/<id>/outputs, where a non-admin's uploads
  // actually live.
  tenantDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peaks-tenant-'));
  currentCtx = { userId: 'admin', outputDir: OUTPUT_DIR };
});

after(() => {
  server?.close();
  try { fs.unlinkSync(secretPath); } catch { /* already gone */ }
  try { fs.rmSync(tenantDir, { recursive: true, force: true }); } catch { /* already gone */ }
});

async function getPeaks(query) {
  const res = await fetch(`${baseUrl}/api/timeline/peaks?${query}`);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/timeline/peaks — guards', () => {
  test('requires a path', async () => {
    const { status, body } = await getPeaks('');
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.match(body.error, /path required/i);
  });

  test('refuses a path outside the output directory', async () => {
    const { status, body } = await getPeaks(`path=${encodeURIComponent(secretPath)}`);
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.match(body.error, /outside the output directory/i);
  });

  test('refuses a traversal escape dressed as an output path', async () => {
    const escape = path.join(OUTPUT_DIR, '..', '..', 'package.json');
    const { status, body } = await getPeaks(`path=${encodeURIComponent(escape)}`);
    assert.equal(status, 400);
    assert.match(body.error, /outside the output directory/i);
  });

  test('refuses a remote URL — there is nothing local to decode', async () => {
    const { status, body } = await getPeaks('path=https%3A%2F%2Fexample.com%2Fa.mp3');
    assert.equal(status, 400);
    assert.match(body.error, /local asset path required/i);
  });

  test('404s for a missing file inside the output directory', async () => {
    const missing = path.join(OUTPUT_DIR, 'definitely-not-here-9f8a7b.mp3');
    const { status, body } = await getPeaks(`path=${encodeURIComponent(missing)}`);
    assert.equal(status, 404);
    assert.match(body.error, /not found/i);
  });

  test('does not leak the resolved absolute path in an error', async () => {
    // Error text reaches the browser; echoing server paths back is free
    // reconnaissance.
    const { body } = await getPeaks(`path=${encodeURIComponent(secretPath)}`);
    assert.ok(!body.error.includes(secretPath), body.error);
  });
});

// Codex caught this on PR #6, and it was real: the endpoint confined requests
// and wrote caches against the module-global OUTPUT_DIR while every sibling
// route in this file uses req.ctx. Multi-tenant is the default, so a non-admin's
// audio — which lives in DATA_DIR/users/<id>/outputs — was rejected as "outside
// the output directory" on an absolute path and resolved into the WRONG global
// directory on its /outputs/ alias. Waveforms loaded for the super-admin only.
describe('GET /api/timeline/peaks — per-tenant output directories', () => {
  test('resolves an /outputs/ alias inside the CALLER own output directory', async () => {
    const name = `tenant-audio-${Date.now()}.txt`;
    fs.writeFileSync(path.join(tenantDir, name), 'not really audio');
    currentCtx = { userId: 'tenant-1', outputDir: tenantDir };

    // Not 400 ("outside the output directory") and not 404 ("asset not found"):
    // the file IS found, so the request gets as far as decoding it, which fails
    // on a text file. Any of those two statuses would mean the tenant's own file
    // was invisible to the endpoint.
    const res = await getPeaks(`path=${encodeURIComponent('/outputs/' + name)}`);
    assert.notEqual(res.status, 404, 'the tenant own file must be found');
    assert.notEqual(res.body.error, 'asset outside the output directory');

    currentCtx = { userId: 'admin', outputDir: OUTPUT_DIR };
  });

  test('accepts an absolute path inside the caller own output directory', async () => {
    const abs = path.join(tenantDir, `tenant-abs-${Date.now()}.txt`);
    fs.writeFileSync(abs, 'not really audio');
    currentCtx = { userId: 'tenant-1', outputDir: tenantDir };

    const res = await getPeaks(`path=${encodeURIComponent(abs)}`);
    assert.notEqual(res.body.error, 'asset outside the output directory');

    currentCtx = { userId: 'admin', outputDir: OUTPUT_DIR };
  });

  test('still refuses a path outside BOTH roots', async () => {
    // Widening the roots must not widen the guard: confinement is the reason
    // this endpoint has tests at all.
    currentCtx = { userId: 'tenant-1', outputDir: tenantDir };
    const res = await getPeaks(`path=${encodeURIComponent(secretPath)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'asset outside the output directory');

    currentCtx = { userId: 'admin', outputDir: OUTPUT_DIR };
  });

  test('a tenant cannot reach another tenant outputs by absolute path', async () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peaks-other-'));
    const victim = path.join(otherDir, 'private.txt');
    fs.writeFileSync(victim, 'another tenant file');
    currentCtx = { userId: 'tenant-1', outputDir: tenantDir };

    const res = await getPeaks(`path=${encodeURIComponent(victim)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'asset outside the output directory');

    currentCtx = { userId: 'admin', outputDir: OUTPUT_DIR };
    fs.rmSync(otherDir, { recursive: true, force: true });
  });
});
