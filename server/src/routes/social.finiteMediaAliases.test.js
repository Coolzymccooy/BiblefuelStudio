import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { denyFiniteSnapshotAliases, createFiniteMediaRouter, finiteMediaReadPath } from '../lib/social/finiteMedia.js';
import { createPerUserOutputFinder } from '../lib/perUserOutputs.js';

test('finite snapshots cannot bypass capabilities through either public output mount', async () => {
  const scratch = process.env.FINITE_TEST_SCRATCH || process.env.TMPDIR || os.tmpdir();
  const root = fs.mkdtempSync(path.join(scratch, 'finite-alias-regression-'));
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'synthetic-media-alias-only-secret';
  let server;
  try {
    const data = path.join(root, 'data'), output = path.join(root, 'outputs');
    fs.mkdirSync(output, { recursive: true });
    const contexts = {
      owner: { userId: 'owner', dataDir: data, outputDir: output },
      tenant: { userId: 'tenant', dataDir: path.join(data, 'users', 'tenant'), outputDir: path.join(data, 'users', 'tenant', 'outputs') },
    };
    const bytes = Buffer.from('synthetic immutable media bytes; URL access control only, not a playability fixture');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const now = Date.now();
    const items = [];
    for (const ctx of Object.values(contexts)) {
      fs.mkdirSync(ctx.outputDir, { recursive: true });
      fs.mkdirSync(ctx.dataDir, { recursive: true });
      const id = crypto.randomUUID(), name = `finite-post-${id}.mp4`;
      const post = { id, ownerId: ctx.userId, destination: 'tiktok', status: 'accepted', mediaSha256: digest, bytes: bytes.length, frozenName: name };
      fs.writeFileSync(path.join(ctx.outputDir, name), bytes);
      fs.writeFileSync(path.join(ctx.dataDir, 'scheduled-posts.json'), JSON.stringify({ posts: [post] }));
      const ordinaryName = `source-video-${crypto.randomUUID()}.mp4`;
      fs.writeFileSync(path.join(ctx.outputDir, ordinaryName), bytes);
      items.push({ ctx, name, ordinaryName, post });
    }
    const app = express();
    // The same shared denial precedes both production serving paths.
    app.use('/outputs', denyFiniteSnapshotAliases);
    app.use('/outputs', express.static(output));
    const find = createPerUserOutputFinder(data);
    app.use('/outputs', (req, res) => {
      const hit = find(decodeURIComponent(req.path));
      return hit ? res.sendFile(hit) : res.status(404).end();
    });
    app.use('/api/finite-media', createFiniteMediaRouter({ Router: express.Router, resolveOwner: id => contexts[id], now: () => now }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const item of items) {
      const valid = finiteMediaReadPath(item.ctx, item.post, now);
      const expired = finiteMediaReadPath(item.ctx, item.post, now - 8 * 86400000);
      const response = await fetch(base + valid);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal((await fetch(base + expired)).status, 404);
      const invalid = valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a');
      assert.equal((await fetch(base + invalid)).status, 404);
      for (const method of ['GET', 'HEAD']) {
        for (const alias of [item.name, item.name.replace('finite', '%66inite'), `%2F${item.name}`, `%5C${item.name}`]) {
          const denied = await fetch(`${base}/outputs/${alias}`, { method });
          assert.equal(denied.status, 404, `${item.ctx.userId} ${method} alias must be denied`);
          assert.equal(denied.headers.get('cache-control'), 'private, no-store');
        }
      }
      const unchanged = await fetch(`${base}/outputs/${item.ordinaryName}`);
      assert.equal(unchanged.status, 200, 'Existing output sharing must remain available');
      assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()), bytes);
      fs.writeFileSync(path.join(item.ctx.outputDir, item.name), Buffer.alloc(bytes.length, 120));
      assert.equal((await fetch(base + valid)).status, 404, 'Capability rejects same-size tampering');
      assert.equal((await fetch(`${base}/outputs/${item.name}`)).status, 404, 'Unsigned path cannot bypass hash check');
    }
    const index = fs.readFileSync(fileURLToPath(new URL('../../index.js', import.meta.url)), 'utf8');
    const guard = index.indexOf('app.use("/outputs", denyFiniteSnapshotAliases)');
    assert.ok(guard >= 0 && guard < index.indexOf('app.use("/outputs", express.static'), 'Global static must be behind denial');
    assert.ok(guard < index.indexOf('const findPerUserOutput ='), 'Tenant fallback must be behind denial');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
