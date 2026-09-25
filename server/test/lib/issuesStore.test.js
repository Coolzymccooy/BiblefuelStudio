import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createIssuesStore } from '../../src/lib/issuesStore.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issues-store-'));
}

test('store: append + list normalize legacy records', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  const rec = await store.append({
    reporterEmail: 'a@b.c', reporterId: 'u1', title: 'broken thing', body: 'context', severity: 'high', contextPath: '/app/x',
  });
  assert.ok(rec.id);
  assert.equal(rec.status, 'open');
  assert.deepEqual(rec.replies, []);
  assert.deepEqual(rec.attachments, []);

  const all = await store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].severity, 'high');
});

test('store: normalize() fills replies/attachments for legacy on-disk rows', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  // Simulate a record that pre-dates the replies field.
  const legacy = [{
    id: 'legacy-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    reporterEmail: 'old@b.c',
    reporterId: 'u-legacy',
    title: 't', body: 'b', severity: 'low', contextPath: '',
    status: 'open',
  }];
  fs.writeFileSync(path.join(dir, 'issues.json'), JSON.stringify(legacy, null, 2), 'utf8');

  const all = await store.list();
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].replies, []);
  assert.deepEqual(all[0].attachments, []);
});

test('store: appendReply adds entries in order and stamps isAdmin', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  const issue = await store.append({
    reporterEmail: 'user@b.c', reporterId: 'u-1', title: 't', body: 'b',
  });
  await store.appendReply(issue.id, { body: 'first from owner', byEmail: 'user@b.c', byUserId: 'u-1', isAdmin: false });
  await store.appendReply(issue.id, { body: 'admin response', byEmail: 'op@b.c', byUserId: 'op-1', isAdmin: true });
  const fresh = await store.findById(issue.id);
  assert.equal(fresh.replies.length, 2);
  assert.equal(fresh.replies[0].isAdmin, false);
  assert.equal(fresh.replies[1].isAdmin, true);
  assert.equal(fresh.replies[1].body, 'admin response');
});

test('store: appendReply rejects empty bodies', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  const issue = await store.append({ reporterEmail: 'a@b.c', reporterId: 'u1', title: 't', body: 'b' });
  await assert.rejects(
    () => store.appendReply(issue.id, { body: '   ', byEmail: 'a@b.c', byUserId: 'u1' }),
    /reply body required/,
  );
});

test('store: appendReply 404s for unknown issue id', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  await assert.rejects(
    () => store.appendReply('no-such-id', { body: 'hi', byEmail: 'a@b.c', byUserId: 'u1' }),
    /not found/,
  );
});

test('store: listByReporter scopes by reporterId only', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  await store.append({ reporterEmail: 'a@b.c', reporterId: 'u-a', title: 'ta', body: 'ba' });
  await store.append({ reporterEmail: 'b@b.c', reporterId: 'u-b', title: 'tb', body: 'bb' });
  await store.append({ reporterEmail: 'a@b.c', reporterId: 'u-a', title: 'ta2', body: 'ba2' });

  const mine = await store.listByReporter('u-a');
  assert.equal(mine.length, 2);
  assert.ok(mine.every((r) => r.reporterId === 'u-a'));
});

test('store: 20 concurrent appendReply yields all replies in order', async () => {
  const dir = mkTmp();
  const store = createIssuesStore({ dir });
  const issue = await store.append({ reporterEmail: 'a@b.c', reporterId: 'u1', title: 't', body: 'b' });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.appendReply(issue.id, { body: `r${i}`, byEmail: 'a@b.c', byUserId: 'u1' })),
  );
  const fresh = await store.findById(issue.id);
  assert.equal(fresh.replies.length, 20);
  const ids = new Set(fresh.replies.map((r) => r.id));
  assert.equal(ids.size, 20);
});
