import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailTransport } from '../../../services/email/transport.js';

const noopLog = () => {};

test('transport: returns stub when apiKey is empty', async () => {
  const transport = createEmailTransport({ apiKey: '', from: 'x@y.z', log: noopLog });
  const res = await transport({ to: 'a@b.c', subject: 'hi', html: '<p>', text: '' });
  assert.equal(res.ok, true);
  assert.equal(res.transport, 'stub');
});

test('transport: throws when apiKey set but from missing', () => {
  assert.throws(() => createEmailTransport({ apiKey: 'k', from: '', log: noopLog }),
    /MAIL_FROM is required/);
});

test('transport: POSTs to Resend with bearer auth on happy path', async () => {
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({ id: 'abc' }) };
  };
  const transport = createEmailTransport({
    apiKey: 'key123', from: 'A <a@b.c>', log: noopLog, fetchImpl: fakeFetch,
  });
  const res = await transport({ to: 'r@x.y', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' });

  assert.equal(res.ok, true);
  assert.equal(res.id, 'abc');
  assert.equal(res.transport, 'resend');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, 'Bearer key123');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.from, 'A <a@b.c>');
  assert.deepEqual(body.to, ['r@x.y']);
  assert.equal(body.subject, 'Hi');
});

test('transport: returns error on non-2xx', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 422, json: async () => ({ message: 'Unverified domain' }),
  });
  const transport = createEmailTransport({
    apiKey: 'k', from: 'a@b.c', log: noopLog, fetchImpl: fakeFetch,
  });
  const res = await transport({ to: 'r@x.y', subject: 'S', html: '<p>', text: '' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Unverified domain');
});

test('transport: returns error on network throw', async () => {
  const fakeFetch = async () => { throw new Error('econnreset'); };
  const transport = createEmailTransport({
    apiKey: 'k', from: 'a@b.c', log: noopLog, fetchImpl: fakeFetch,
  });
  const res = await transport({ to: 'r@x.y', subject: 'S', html: '<p>', text: '' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'econnreset');
});

test('transport: rejects malformed payload before fetch', async () => {
  let fetchCalled = false;
  const fakeFetch = async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const transport = createEmailTransport({
    apiKey: 'k', from: 'a@b.c', log: noopLog, fetchImpl: fakeFetch,
  });
  const res = await transport({ to: '', subject: '', html: '' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'INVALID_PAYLOAD');
  assert.equal(fetchCalled, false);
});
