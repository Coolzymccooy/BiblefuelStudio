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

before(async () => {
  const { default: timelineRouter } = await import('./timeline.js');
  app = express();
  app.use(express.json());
  app.use('/api/timeline', timelineRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A file OUTSIDE the output directory, standing in for anything sensitive
  // on the same disk.
  secretPath = path.join(os.tmpdir(), `peaks-guard-${Date.now()}.txt`);
  fs.writeFileSync(secretPath, 'do not read me');
});

after(() => {
  server?.close();
  try { fs.unlinkSync(secretPath); } catch { /* already gone */ }
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
