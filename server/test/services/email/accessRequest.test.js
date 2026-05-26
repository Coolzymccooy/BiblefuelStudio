import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAccessRequestEmail } from '../../../services/email/templates/accessRequest.js';

const sample = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  org: 'Difference Engine Ministries',
  pitch: 'A weekly devotional for engineers.',
  ip: '203.0.113.7',
  createdAt: '2026-05-26T10:15:00.000Z',
};

test('accessRequest: subject includes name and org', () => {
  const { subject } = renderAccessRequestEmail(sample);
  assert.match(subject, /Ada Lovelace/);
  assert.match(subject, /Difference Engine Ministries/);
});

test('accessRequest: HTML body contains every field', () => {
  const { html } = renderAccessRequestEmail(sample);
  assert.match(html, /Ada Lovelace/);
  assert.match(html, /ada@example.com/);
  assert.match(html, /Difference Engine Ministries/);
  assert.match(html, /weekly devotional for engineers/);
  assert.match(html, /203\.0\.113\.7/);
});

test('accessRequest: escapes HTML in user fields', () => {
  const malicious = { ...sample, org: '<script>alert(1)</script>' };
  const { html } = renderAccessRequestEmail(malicious);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('accessRequest: replyTo is the requester email', () => {
  const { replyTo } = renderAccessRequestEmail(sample);
  assert.equal(replyTo, 'ada@example.com');
});

test('accessRequest: text body has plain-text version of all fields', () => {
  const { text } = renderAccessRequestEmail(sample);
  assert.match(text, /Ada Lovelace/);
  assert.match(text, /ada@example.com/);
  assert.match(text, /Difference Engine Ministries/);
});

test('accessRequest: subject strips CR/LF to prevent header injection', () => {
  const malicious = { ...sample, name: 'Ada\r\nBcc: attacker@evil.com', org: 'A\nB' };
  const { subject } = renderAccessRequestEmail(malicious);
  assert.ok(!subject.includes('\n'), 'subject should not contain LF');
  assert.ok(!subject.includes('\r'), 'subject should not contain CR');
  // Header injection attempt is neutered: the CRLF is stripped, so the fake header becomes part of the name text
  assert.match(subject, /Ada Bcc: attacker@evil.com/); // newline collapsed to space
  assert.match(subject, /A B/); // newline in org also collapsed
});
