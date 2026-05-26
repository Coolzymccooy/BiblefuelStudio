import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAccessRequestsStore } from '../../src/lib/accessRequestsStore.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'access-req-'));
}

test('store: appends a single record and reads it back', async () => {
  const dir = mkTmp();
  const store = createAccessRequestsStore({ dir });
  const rec = { name: 'A', email: 'a@b.c', org: 'O', pitch: 'p' };
  const out = await store.append(rec);
  assert.ok(out.id);
  assert.ok(out.createdAt);

  const all = JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8'));
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'A');
  assert.equal(all[0].id, out.id);
});

test('store: 20 concurrent appends yield 20 unique records', async () => {
  const dir = mkTmp();
  const store = createAccessRequestsStore({ dir });
  const writes = Array.from({ length: 20 }, (_, i) =>
    store.append({ name: `N${i}`, email: `e${i}@x.y`, org: `O${i}`, pitch: `p${i}` })
  );
  const results = await Promise.all(writes);
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 20);

  const all = JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8'));
  assert.equal(all.length, 20);
});

test('store: creates dir if missing', async () => {
  const dir = path.join(mkTmp(), 'nested', 'dir');
  const store = createAccessRequestsStore({ dir });
  await store.append({ name: 'A', email: 'a@b.c', org: 'O', pitch: 'p' });
  assert.ok(fs.existsSync(path.join(dir, 'access-requests.json')));
});
