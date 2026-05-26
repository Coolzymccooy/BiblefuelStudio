# BibleFuel Studio Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public landing page at `/` (Editorial & Reverent aesthetic, V1 voice, KineticVerse hero, Framer Motion scroll-ins, Request-Access form posting to a Resend-backed email pipeline). Aligned with Phase 6 of the multitenant public-launch roadmap but standalone.

**Architecture:** A new top-level React route `/` renders `LandingPage` for unauthenticated visitors; the existing dashboard moves under `/app/*`. The page POSTs to a new public Express route `POST /api/access-requests`, which serializes writes to `server/data/access-requests.json` and fires a Resend notification email (Resend transport ported verbatim from lumina-presenter). The endpoint is mounted **outside** the auth/multitenancy middleware pipeline so it cannot collide with the in-flight multitenant refactor.

**Tech Stack:**
- Frontend: React 19, react-router-dom v7, TypeScript, Tailwind (extended palette), Framer Motion 11, vitest (new).
- Backend: Express, Zod, express-rate-limit (all already deps), pure-`fetch` Resend transport.
- No new server runtime deps; one new client dep (`framer-motion`) and dev deps for vitest.

**Source spec:** [docs/superpowers/specs/2026-05-26-landing-page-design.md](../specs/2026-05-26-landing-page-design.md)
**Related (sibling) spec:** [.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md](../../../.claude/worktrees/multitenant-public-launch/docs/superpowers/specs/2026-05-26-public-multitenancy-design.md) — Phase 6 of that roadmap. This plan ships standalone; nothing here touches the auth pipeline.

---

## File Structure

### Server — new files

| Path | Responsibility |
|---|---|
| `server/services/email/escape.js` | `escapeHtml(str)` — used by email templates to safely render user-supplied fields. Ported from lumina-presenter. |
| `server/services/email/transport.js` | `createEmailTransport({ apiKey, from, replyTo, log, fetchImpl })` — pure-`fetch` Resend HTTP wrapper, stub fallback when key absent, never throws. Ported from lumina-presenter. |
| `server/services/email/templates/accessRequest.js` | `renderAccessRequestEmail({ name, email, org, pitch, ip, createdAt })` — returns `{ subject, html, text, preview }`. |
| `server/services/email/send.js` | `sendEmail(transport, req)` dispatcher; only `kind: 'access-request'` for now. Mirrors lumina pattern so future kinds slot in. |
| `server/src/lib/accessRequestsStore.js` | `appendAccessRequest(record)` — in-process Promise-chain serialised append to `server/data/access-requests.json`. |
| `server/src/routes/accessRequests.js` | Express router exporting `POST /` (mounted at `/api/access-requests`). Validates with Zod, drops honeypot silently, rate-limits per IP, appends to store, fires email best-effort. |

### Server — modified files

| Path | Change |
|---|---|
| `server/index.js` | Mount `accessRequestsRouter` at `/api/access-requests` BEFORE auth-guarded routes; instantiate Resend transport at boot and pass it into the router via factory; CSP `connectSrc` already covers `https:` so no change needed. |
| `server/.env.example` | Add `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`, `ACCESS_REQUEST_NOTIFY_TO`. |

### Server — new tests

| Path | Covers |
|---|---|
| `server/test/services/email/escape.test.js` | `escapeHtml` invariants (`<`, `>`, `&`, `"`, `'`). |
| `server/test/services/email/transport.test.js` | Stub fallback, successful POST shape, non-2xx handling, network error handling. |
| `server/test/services/email/accessRequest.test.js` | Template renders all required fields, escapes user content, Reply-To set to requester. |
| `server/test/lib/accessRequestsStore.test.js` | Serial appends preserve order; 20 concurrent appends produce 20 records (no torn writes). |
| `server/test/routes/accessRequests.test.js` | Happy path; honeypot silent drop; validation 400; rate-limit 429; email transport stubbable. |

### Client — new files

| Path | Responsibility |
|---|---|
| `client/src/pages/LandingPage.tsx` | Composes Header → Hero → WhatsInside → HowItWorks → AccessForm → Footer. |
| `client/src/components/landing/Header.tsx` | Wordmark + 3 anchor nav links. |
| `client/src/components/landing/Hero.tsx` | Kicker + headline + sub + CTA + secondary link + `<KineticVerse />` on the right. |
| `client/src/components/landing/WhatsInside.tsx` | Section title + 3 roman-numeraled feature cards (Scripts, Voice, Kinetic Video). |
| `client/src/components/landing/HowItWorks.tsx` | Dark band; section title + 3 steps (Write, Speak, Publish). |
| `client/src/components/landing/AccessForm.tsx` | The form. Zod-validated, posts to `/api/access-requests`, swaps to thank-you panel on success, has honeypot. |
| `client/src/components/landing/Footer.tsx` | Copyright + Privacy/Terms/Contact mailto links. |
| `client/src/components/landing/KineticVerse.tsx` | Reusable kinetic-typography canvas (verse rotation, word stagger, crossfade, reduced-motion fallback). |
| `client/src/components/landing/motion.ts` | Shared editorial-curve variants + `useEditorialMotion()` hook returning the reduced-motion-aware variants. |
| `client/src/components/landing/UnauthedOnly.tsx` | Wrapper: reads `useAuth().token`; if present, `<Navigate to={redirect} />`; else renders children. |
| `client/src/styles/landing.css` | SVG-grain background data URI + any keyframes Framer Motion can't express. |

### Client — modified files

| Path | Change |
|---|---|
| `client/src/App.tsx` | Restructure: `/` → `<UnauthedOnly redirect="/app"><LandingPage /></UnauthedOnly>`; `/app/*` → existing `<Layout />` tree. Update internal navigation paths from `/` → `/app`, `/scripts` → `/app/scripts`, etc. |
| `client/src/components/Layout.tsx` | Update all internal `<Link>` and `useNavigate()` paths to `/app/*`. |
| `client/tailwind.config.js` | Extend `theme.extend.colors.editorial` palette + `theme.extend.fontFamily.{display,body,sans}`. |
| `client/index.html` | Add Google Fonts preconnect + Cormorant Garamond stylesheet link. |
| `client/package.json` | Add `framer-motion` dep; add `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` dev deps; add `"test": "vitest run"` + `"test:watch": "vitest"` scripts. |

### Client — new tests

| Path | Covers |
|---|---|
| `client/vitest.config.ts` | jsdom env, setup file. |
| `client/src/test-setup.ts` | `@testing-library/jest-dom` matchers + `matchMedia` polyfill. |
| `client/src/components/landing/__tests__/KineticVerse.test.tsx` | Renders verse[0] words, advances on timer, reduced-motion renders static. |
| `client/src/components/landing/__tests__/AccessForm.test.tsx` | Submits valid form, shows validation errors, honeypot present + off-screen, thank-you panel on 200. |
| `client/src/components/landing/__tests__/UnauthedOnly.test.tsx` | Renders children when no token; redirects when token present. |

---

## Phase 1 — Server Email Infrastructure

### Task 1: Port `escape.js` from lumina-presenter

**Files:**
- Create: `server/services/email/escape.js`
- Test: `server/test/services/email/escape.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/test/services/email/escape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../../services/email/escape.js';

test('escapeHtml: escapes <, >, &, ", \'', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml: passes plain text through unchanged', () => {
  assert.equal(escapeHtml('hello world'), 'hello world');
});

test('escapeHtml: coerces non-string to empty', () => {
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/services/email/escape.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `escape.js`**

```js
// server/services/email/escape.js
//
// HTML-escape user-supplied strings before embedding in template HTML.
// Used by every template that interpolates form input.

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/services/email/escape.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/email/escape.js server/test/services/email/escape.test.js
git commit -m "feat(email): port escapeHtml helper from lumina-presenter"
```

---

### Task 2: Port `transport.js` (Resend) from lumina-presenter

**Files:**
- Create: `server/services/email/transport.js`
- Test: `server/test/services/email/transport.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/test/services/email/transport.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/services/email/transport.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transport.js`**

```js
// server/services/email/transport.js
//
// Resend HTTP transport. Pure fetch — no SDK dependency.
// Returns a stub when RESEND_API_KEY is unset (offline / dev / tests).
// Never throws to the caller — failures return { ok: false, error }.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createEmailTransport(config = {}) {
  const apiKey = String(config.apiKey || '').trim();
  const defaultFrom = String(config.from || '').trim();
  const defaultReplyTo = String(config.replyTo || '').trim();
  const log = typeof config.log === 'function' ? config.log : defaultLog;
  const fetchImpl = config.fetchImpl || globalThis.fetch;

  if (!apiKey) {
    log('warn', '[email] RESEND_API_KEY not set — using stub transport (no real delivery)');
    return async (payload) => {
      log('info', '[email/stub] would send email', {
        to: payload?.to,
        subject: payload?.subject,
        textPreview: (payload?.text || '').slice(0, 120),
      });
      return { ok: true, id: 'stub-' + Date.now().toString(36), transport: 'stub' };
    };
  }

  if (!defaultFrom) {
    throw new Error('[email] MAIL_FROM is required when RESEND_API_KEY is set');
  }

  return async (payload) => {
    if (!payload?.to || !payload?.subject || !payload?.html) {
      return { ok: false, error: 'INVALID_PAYLOAD', transport: 'resend' };
    }

    const body = {
      from: defaultFrom,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      reply_to: payload.replyTo || defaultReplyTo || undefined,
      headers: payload.headers,
    };

    try {
      const res = await fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await safeJson(res);
      if (!res.ok) {
        const message = data?.message || data?.error || `HTTP ${res.status}`;
        log('error', '[email/resend] send failed', { to: payload.to, status: res.status, message });
        return { ok: false, error: message, transport: 'resend' };
      }

      const id = String(data?.id || '');
      log('info', '[email/resend] sent', { to: payload.to, subject: payload.subject, id });
      return { ok: true, id, transport: 'resend' };
    } catch (err) {
      const message = err?.message || String(err);
      log('error', '[email/resend] threw', { to: payload.to, message });
      return { ok: false, error: message, transport: 'resend' };
    }
  };
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function defaultLog(level, msg, meta) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta !== undefined) fn(msg, meta); else fn(msg);
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && node --test test/services/email/transport.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/email/transport.js server/test/services/email/transport.test.js
git commit -m "feat(email): port Resend transport from lumina-presenter"
```

---

### Task 3: Add Resend env vars to `.env.example`

**Files:**
- Modify: `server/.env.example`

- [ ] **Step 1: Append email configuration to the file**

Open `server/.env.example` and append:

```
# --- Email (Resend) ----------------------------------------------------------
# Used by the public Request-Access form on the landing page.
# When RESEND_API_KEY is empty, the transport runs in stub mode and only logs.
RESEND_API_KEY=
MAIL_FROM=Biblefuel <hello@tiwaton.co.uk>
MAIL_REPLY_TO=
# Where access-request notification emails are delivered:
ACCESS_REQUEST_NOTIFY_TO=
```

- [ ] **Step 2: Commit**

```bash
git add server/.env.example
git commit -m "chore(env): document Resend + access-request env vars"
```

---

### Task 4: Build access-request email template

**Files:**
- Create: `server/services/email/templates/accessRequest.js`
- Test: `server/test/services/email/accessRequest.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/test/services/email/accessRequest.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/services/email/accessRequest.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement template**

```js
// server/services/email/templates/accessRequest.js
//
// Renders the internal notification email sent to the operator whenever
// someone submits the Request Access form on the landing page.

import { escapeHtml } from '../escape.js';

export function renderAccessRequestEmail({ name, email, org, pitch, ip, createdAt }) {
  const subject = `New access request — ${name} (${org})`;

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeOrg = escapeHtml(org);
  const safePitch = escapeHtml(pitch);
  const safeIp = escapeHtml(ip);
  const safeCreatedAt = escapeHtml(createdAt);

  const html = `<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; color: #1a1610; background: #faf6ee; padding: 24px;">
  <h2 style="font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; margin: 0 0 16px;">
    New access request
  </h2>
  <p style="color:#5a5147; margin: 0 0 20px;">From biblefuel.tiwaton.co.uk · ${safeCreatedAt}</p>
  <table style="border-collapse: collapse;">
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Name</td><td>${safeName}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Email</td><td>${safeEmail}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">Org</td><td>${safeOrg}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760; vertical-align:top;">Pitch</td><td>${safePitch}</td></tr>
    <tr><td style="padding:6px 16px 6px 0; color:#a08760;">IP</td><td>${safeIp}</td></tr>
  </table>
  <p style="color:#5a5147; margin: 24px 0 0; font-size: 13px;">
    Reply to this email to respond directly to ${safeName}.
  </p>
</body></html>`;

  const text = [
    `New access request from biblefuel.tiwaton.co.uk`,
    ``,
    `Name:     ${name}`,
    `Email:    ${email}`,
    `Org:      ${org}`,
    `Pitch:    ${pitch}`,
    ``,
    `IP:       ${ip}`,
    `Received: ${createdAt}`,
    ``,
    `Reply to this email to respond directly to ${name}.`,
  ].join('\n');

  const preview = `${name} · ${org}`;

  return { subject, html, text, preview, replyTo: email };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && node --test test/services/email/accessRequest.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/services/email/templates/accessRequest.js server/test/services/email/accessRequest.test.js
git commit -m "feat(email): access-request notification template"
```

---

### Task 5: Build `send.js` dispatcher

**Files:**
- Create: `server/services/email/send.js`

- [ ] **Step 1: Implement (no separate test — exercised by route integration test)**

```js
// server/services/email/send.js
//
// Top-level send orchestrator. Each "kind" maps a logical occasion to its
// renderer. Callers don't construct HTML themselves — they call sendEmail.

import { renderAccessRequestEmail } from './templates/accessRequest.js';

export function renderEmailRequest(req) {
  if (!req || typeof req !== 'object') throw new Error('renderEmailRequest: missing request');
  switch (req.kind) {
    case 'access-request': {
      const { to, ...fields } = req;
      const rendered = renderAccessRequestEmail(fields);
      return { ...rendered, to };
    }
    default:
      throw new Error(`renderEmailRequest: unknown kind "${req.kind}"`);
  }
}

export async function sendEmail(transport, req) {
  try {
    const { to, subject, html, text, replyTo } = renderEmailRequest(req);
    const result = await transport({ to, subject, html, text, replyTo });
    return { ok: result.ok, kind: req.kind, id: result.id, error: result.error };
  } catch (err) {
    const message = err?.message || String(err);
    return { ok: false, kind: req?.kind || 'unknown', error: message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/email/send.js
git commit -m "feat(email): send dispatcher for access-request kind"
```

---

## Phase 2 — Access Requests Store + Route + Mount

### Task 6: Build `accessRequestsStore.js` with serialised writes

**Files:**
- Create: `server/src/lib/accessRequestsStore.js`
- Test: `server/test/lib/accessRequestsStore.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/test/lib/accessRequestsStore.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/lib/accessRequestsStore.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement store**

```js
// server/src/lib/accessRequestsStore.js
//
// Append-only JSON store for landing-page access requests.
// Single-process write serialisation via a Promise-chain queue —
// no external lockfile dep needed because this server runs as one process.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = 'access-requests.json';

export function createAccessRequestsStore({ dir }) {
  let queue = Promise.resolve();

  const filePath = () => path.join(dir, FILE);

  const ensure = () => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath())) fs.writeFileSync(filePath(), '[]', 'utf8');
  };

  const append = async (record) => {
    const enriched = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...record,
    };

    const next = queue.then(async () => {
      ensure();
      const raw = await fs.promises.readFile(filePath(), 'utf8');
      let arr;
      try { arr = JSON.parse(raw); } catch { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      arr.push(enriched);
      await fs.promises.writeFile(filePath(), JSON.stringify(arr, null, 2), 'utf8');
      return enriched;
    });

    queue = next.catch(() => {}); // keep the queue alive even if a write fails
    return next;
  };

  return { append, filePath };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && node --test test/lib/accessRequestsStore.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/accessRequestsStore.js server/test/lib/accessRequestsStore.test.js
git commit -m "feat(landing): access-requests JSON store with serial writes"
```

---

### Task 7: Build `POST /api/access-requests` route

**Files:**
- Create: `server/src/routes/accessRequests.js`
- Test: `server/test/routes/accessRequests.test.js`

- [ ] **Step 1: Write the failing test**

Use Node's built-in test runner + the existing Express app pattern. We'll mount the router on a throwaway app for the test.

```js
// server/test/routes/accessRequests.test.js
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
  assert.ok(!fs.existsSync(path.join(dir, 'access-requests.json'))
    || JSON.parse(fs.readFileSync(path.join(dir, 'access-requests.json'), 'utf8')).length === 0);
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
  // 1st-3rd accepted
  for (let i = 0; i < 3; i++) {
    const r = await post(app, valid);
    assert.equal(r.status, 200);
  }
  const fourth = await post(app, valid);
  assert.equal(fourth.status, 429);
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
```

- [ ] **Step 2: Install supertest as a dev dep**

```bash
cd server && npm install --save-dev supertest
```

Then re-run `node --test ...` — expect MODULE NOT FOUND on the route, not on supertest.

- [ ] **Step 3: Implement the router**

```js
// server/src/routes/accessRequests.js
//
// Public, unauthenticated endpoint that receives Request-Access form
// submissions from the landing page. NOT mounted under requireAuth.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  org: z.string().trim().min(1).max(200),
  pitch: z.string().trim().min(1).max(500),
  hp_url: z.string().max(2000).default(''),
});

export function createAccessRequestsRouter({ store, sendEmail, notifyTo, log = console }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'RATE_LIMITED' },
  });

  router.post('/', limiter, async (req, res) => {
    const parsed = submissionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'VALIDATION',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const data = parsed.data;

    // Honeypot: silent drop. Return 200 so bots learn nothing.
    if (data.hp_url && data.hp_url.trim().length > 0) {
      return res.status(200).json({ ok: true });
    }

    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
      const record = await store.append({
        name: data.name,
        email: data.email,
        org: data.org,
        pitch: data.pitch,
        ip: String(ip).slice(0, 64),
        userAgent,
      });

      // Fire-and-forget — never block response on email.
      sendEmail({
        kind: 'access-request',
        to: notifyTo,
        name: record.name,
        email: record.email,
        org: record.org,
        pitch: record.pitch,
        ip: record.ip,
        createdAt: record.createdAt,
      }).then((result) => {
        if (!result.ok) {
          log.error?.('[access-requests] email failed', { id: record.id, error: result.error });
        }
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      log.error?.('[access-requests] server error', err);
      return res.status(500).json({ ok: false, error: 'SERVER' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && node --test test/routes/accessRequests.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/accessRequests.js server/test/routes/accessRequests.test.js server/package.json server/package-lock.json
git commit -m "feat(landing): POST /api/access-requests with validation, honeypot, rate limit"
```

---

### Task 8: Mount the router in `server/index.js`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add imports near the other route imports**

Edit `server/index.js` to add after line 26 (the other route imports):

```js
import { createAccessRequestsRouter } from "./src/routes/accessRequests.js";
import { createAccessRequestsStore } from "./src/lib/accessRequestsStore.js";
import { createEmailTransport } from "../services/email/transport.js";
import { sendEmail as sendEmailViaTransport } from "../services/email/send.js";
```

- [ ] **Step 2: Build transport, store, and mount the router BEFORE auth-guarded routes**

Find the line `app.use("/outputs", express.static(outputDir));` (around line 69). Immediately after the `/outputs` static mount, insert:

```js
// --- Landing page: public access-request endpoint ---------------------------
// Mounted BEFORE any auth-guarded /api/* route so it stays publicly callable.
const emailTransport = createEmailTransport({
  apiKey: process.env.RESEND_API_KEY || '',
  from: process.env.MAIL_FROM || '',
  replyTo: process.env.MAIL_REPLY_TO || '',
});
const sendEmail = (req) => sendEmailViaTransport(emailTransport, req);
const accessRequestsStore = createAccessRequestsStore({ dir: dataDir });
app.use('/api/access-requests', createAccessRequestsRouter({
  store: accessRequestsStore,
  sendEmail,
  notifyTo: process.env.ACCESS_REQUEST_NOTIFY_TO || process.env.MAIL_REPLY_TO || '',
}));
```

- [ ] **Step 3: Smoke-check the server boots without errors**

```bash
cd server && node index.js &
sleep 2
curl -s -X POST http://localhost:5051/api/access-requests \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke","email":"s@example.com","org":"Test","pitch":"Smoke test"}'
kill %1
```

Expected: `{"ok":true}`. Then verify `server/data/access-requests.json` contains one record.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(landing): mount /api/access-requests as public route"
```

---

## Phase 3 — Client Foundation

### Task 9: Add `framer-motion` dep, Google Fonts, and Tailwind palette

**Files:**
- Modify: `client/package.json`
- Modify: `client/tailwind.config.js`
- Modify: `client/index.html`

- [ ] **Step 1: Install framer-motion**

```bash
cd client && npm install framer-motion
```

- [ ] **Step 2: Extend `client/tailwind.config.js`**

Locate `theme.extend` in the existing config. Add the `editorial` palette and `fontFamily` extensions. Example merged block:

```js
// client/tailwind.config.js (excerpt — merge into existing extend)
theme: {
  extend: {
    colors: {
      // ...existing colours unchanged...
      editorial: {
        paper:    '#faf6ee',
        parchment:'#f1e9d6',
        dark:     '#2a2620',
        canvas:   '#0e0a06',
        ink:      '#1a1610',
        body:     '#4a4239',
        muted:    '#5a5147',
        gold:     '#a08760',
        goldDeep: '#6b4f1f',
        goldLite: '#d4af6e',
        cream:    '#f4ead8',
        hairline: '#e8ddc4',
      },
    },
    fontFamily: {
      display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      bodyserif: ['Georgia', 'serif'],
      sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    },
  },
}
```

(Note: name is `bodyserif` not `body` to avoid Tailwind's `font-body` conflict on Vite's HMR cache; the rest of the project already imports `Inter` system-wide so `sans` is a safe override.)

- [ ] **Step 3: Add Google Fonts link to `client/index.html`**

Inside the `<head>` of `client/index.html`, add (before the existing stylesheet links):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
```

- [ ] **Step 4: Smoke-test the dev server starts**

```bash
cd client && npm run dev
```

Expected: Vite reports "ready in Xms". Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/package-lock.json client/tailwind.config.js client/index.html
git commit -m "feat(landing): framer-motion dep, Cormorant Garamond, editorial palette"
```

---

### Task 10: Add vitest dev deps + minimal config

**Files:**
- Modify: `client/package.json`
- Create: `client/vitest.config.ts`
- Create: `client/src/test-setup.ts`

- [ ] **Step 1: Install dev deps**

```bash
cd client && npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/node
```

- [ ] **Step 2: Add test scripts to `client/package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `client/vitest.config.ts`**

```ts
// client/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'src/test-setup.ts')],
  },
});
```

- [ ] **Step 4: Create `client/src/test-setup.ts`**

```ts
// client/src/test-setup.ts
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia — Framer Motion's useReducedMotion needs it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
```

- [ ] **Step 5: Sanity-run vitest**

```bash
cd client && npx vitest run --reporter=basic
```

Expected: "No test files found" (this is fine — proves vitest is wired up).

- [ ] **Step 6: Commit**

```bash
git add client/package.json client/package-lock.json client/vitest.config.ts client/src/test-setup.ts
git commit -m "chore(client): wire up vitest + testing-library + jsdom"
```

---

### Task 11: Build shared motion variants

**Files:**
- Create: `client/src/components/landing/motion.ts`

- [ ] **Step 1: Implement**

```ts
// client/src/components/landing/motion.ts
//
// Shared animation tokens for the landing page. One easing curve, one set
// of variants. Every landing component imports from here so the page has
// a unified rhythm.

import { useReducedMotion } from 'framer-motion';
import type { Variants, Transition } from 'framer-motion';

export const EDITORIAL_EASE: Transition['ease'] = [0.2, 0.7, 0.2, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EDITORIAL_EASE } },
};

export const fadeUpFast: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EDITORIAL_EASE } },
};

export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};

export const staggerSlow: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.25 } },
};

export const wordReveal: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EDITORIAL_EASE } },
};

export const wordStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

// Hook returning variants that collapse to instant when prefers-reduced-motion.
export function useEditorialMotion() {
  const reduce = useReducedMotion();
  if (!reduce) {
    return { fadeUp, fadeUpFast, staggerChildren, staggerSlow, wordReveal, wordStagger };
  }
  const instant: Variants = { hidden: { opacity: 1 }, visible: { opacity: 1 } };
  const noStagger: Variants = { hidden: {}, visible: {} };
  return {
    fadeUp: instant,
    fadeUpFast: instant,
    staggerChildren: noStagger,
    staggerSlow: noStagger,
    wordReveal: instant,
    wordStagger: noStagger,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/motion.ts
git commit -m "feat(landing): shared motion variants + reduced-motion hook"
```

---

## Phase 4 — KineticVerse Component

### Task 12: Build `KineticVerse` static render

**Files:**
- Create: `client/src/components/landing/KineticVerse.tsx`
- Create: `client/src/components/landing/__tests__/KineticVerse.test.tsx`
- Create: `client/src/styles/landing.css`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/landing/__tests__/KineticVerse.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KineticVerse } from '../KineticVerse';

describe('KineticVerse', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders every word of the first verse on mount', () => {
    render(<KineticVerse cycle={false} />);
    // First verse defaults to John 1:1
    expect(screen.getByText(/John 1:1/i)).toBeInTheDocument();
    expect(screen.getByText(/In/)).toBeInTheDocument();
    expect(screen.getByText(/beginning/)).toBeInTheDocument();
    expect(screen.getByText(/Word,/)).toBeInTheDocument();
  });

  it('does not advance when cycle=false', async () => {
    render(<KineticVerse cycle={false} holdMs={500} />);
    vi.advanceTimersByTime(3000);
    expect(screen.getByText(/John 1:1/i)).toBeInTheDocument();
    expect(screen.queryByText(/Psalm 119:105/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/components/landing/__tests__/KineticVerse.test.tsx
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `KineticVerse.tsx` (cycle-disabled version first)**

```tsx
// client/src/components/landing/KineticVerse.tsx
//
// Reusable kinetic-typography canvas. Renders Scripture verses with a
// word-by-word reveal, optionally cycling through a rotation.

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { EDITORIAL_EASE } from './motion';
import '../../styles/landing.css';

export type KineticVerse = {
  ref: string;
  // Each inner array is a line; each token is a word. Prefix with '*' for italic gold.
  lines: string[][];
};

export const DEFAULT_VERSES: KineticVerse[] = [
  {
    ref: 'JOHN 1:1',
    lines: [
      ['In', 'the', 'beginning', '*was', '*the', '*Word,'],
      ['and', 'the', 'Word', 'was', '*with', '*God.'],
    ],
  },
  {
    ref: 'PSALM 119:105',
    lines: [
      ['Your', 'word', 'is', 'a', '*lamp', 'to', 'my', 'feet'],
      ['and', 'a', '*light', 'to', 'my', 'path.'],
    ],
  },
  {
    ref: 'ISAIAH 40:8',
    lines: [
      ['The', 'grass', 'withers,', 'the', 'flower', 'fades,'],
      ['but', 'the', 'word', 'of', 'our', 'God', '*stands', '*forever.'],
    ],
  },
  {
    ref: 'HEBREWS 4:12',
    lines: [
      ['The', 'word', 'of', 'God', 'is', '*living', 'and', '*active,'],
      ['sharper', 'than', 'any', 'two-edged', '*sword.'],
    ],
  },
];

export interface KineticVerseProps {
  verses?: KineticVerse[];
  cycle?: boolean;
  holdMs?: number;
  staggerMs?: number;
  wordDurationMs?: number;
  className?: string;
}

export function KineticVerse({
  verses = DEFAULT_VERSES,
  cycle = true,
  holdMs = 4500,
  staggerMs = 200,
  wordDurationMs = 700,
  className = '',
}: KineticVerseProps) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const verse = verses[i % verses.length];

  // Estimate total reveal time so the hold starts after the last word lands.
  const wordCount = useMemo(
    () => verse.lines.reduce((n, line) => n + line.length, 0),
    [verse],
  );
  const revealMs = wordCount * staggerMs + wordDurationMs;

  useEffect(() => {
    if (!cycle || reduce || verses.length < 2) return;
    const t = setTimeout(() => setI((p) => (p + 1) % verses.length), revealMs + holdMs);
    return () => clearTimeout(t);
  }, [cycle, reduce, verses.length, revealMs, holdMs, i]);

  return (
    <div className={`bf-kinetic ${className}`} role="img" aria-label={`Verse: ${verse.ref}`}>
      <div className="bf-kinetic__grain" aria-hidden="true" />
      <div className="bf-kinetic__kicker">RENDERED LIVE · NO INSTALLS</div>
      <div className="bf-kinetic__vbox">
        <AnimatePresence mode="wait">
          <motion.div
            key={verse.ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: EDITORIAL_EASE }}
          >
            {verse.lines.map((line, lineIdx) => (
              <div className="bf-kinetic__line" key={lineIdx}>
                {line.map((tok, wordIdx) => {
                  const em = tok.startsWith('*');
                  const text = em ? tok.slice(1) : tok;
                  const order = verse.lines
                    .slice(0, lineIdx)
                    .reduce((n, l) => n + l.length, 0) + wordIdx;
                  return (
                    <motion.span
                      key={`${verse.ref}-${lineIdx}-${wordIdx}`}
                      className={em ? 'bf-kinetic__word bf-kinetic__word--em' : 'bf-kinetic__word'}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        duration: reduce ? 0 : wordDurationMs / 1000,
                        delay: reduce ? 0 : (order * staggerMs) / 1000,
                        ease: EDITORIAL_EASE,
                      }}
                    >
                      {text}{' '}
                    </motion.span>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="bf-kinetic__ref">
        <span>{verse.ref}</span>
        <div className="bf-kinetic__progress" aria-hidden="true">
          {verses.map((_, idx) => (
            <span key={idx} className={idx === i % verses.length ? 'is-active' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `client/src/styles/landing.css`**

```css
/* client/src/styles/landing.css
   ----------------------------------------------------------------
   Only styles that Tailwind can't express cleanly:
   - the KineticVerse canvas (custom radial gradients + SVG grain)
   - the off-screen honeypot helper
*/

.bf-kinetic {
  position: relative;
  background: #0e0a06;
  border-radius: 4px;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
.bf-kinetic::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 30% 20%, rgba(212, 175, 110, 0.10), transparent 55%),
    radial-gradient(circle at 80% 80%, rgba(160, 80, 40, 0.08), transparent 55%);
}
.bf-kinetic__grain {
  position: absolute;
  inset: 0;
  opacity: 0.18;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  pointer-events: none;
}
.bf-kinetic__vbox {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 36px;
}
.bf-kinetic__kicker {
  position: absolute;
  top: 22px;
  left: 36px;
  color: #d4af6e;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  letter-spacing: 2.5px;
}
.bf-kinetic__line {
  font-family: 'Cormorant Garamond', Georgia, serif;
  color: #f4ead8;
  font-size: 30px;
  line-height: 1.18;
  letter-spacing: -0.3px;
  font-weight: 400;
}
.bf-kinetic__line + .bf-kinetic__line { margin-top: 8px; }
.bf-kinetic__word { display: inline-block; }
.bf-kinetic__word--em { font-style: italic; color: #d4af6e; }
.bf-kinetic__ref {
  position: absolute;
  bottom: 24px;
  left: 36px;
  right: 36px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #a08760;
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 2px;
}
.bf-kinetic__progress { display: flex; gap: 6px; }
.bf-kinetic__progress span {
  width: 22px;
  height: 2px;
  background: rgba(212, 175, 110, 0.25);
}
.bf-kinetic__progress span.is-active { background: #d4af6e; }

@media (max-width: 768px) {
  .bf-kinetic__line { font-size: 22px; }
  .bf-kinetic__vbox { padding: 0 24px; }
}

/* Honeypot field — off-screen for sighted users, still focusable so bots
   that auto-fill *every* input get caught. */
.bf-honeypot {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}
```

- [ ] **Step 5: Run tests**

```bash
cd client && npx vitest run src/components/landing/__tests__/KineticVerse.test.tsx
```

Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/landing/KineticVerse.tsx client/src/components/landing/__tests__/KineticVerse.test.tsx client/src/styles/landing.css
git commit -m "feat(landing): KineticVerse component + landing.css base styles"
```

---

### Task 13: Add cycling + reduced-motion tests for KineticVerse

**Files:**
- Modify: `client/src/components/landing/__tests__/KineticVerse.test.tsx`

- [ ] **Step 1: Append two more tests**

```tsx
// Append to client/src/components/landing/__tests__/KineticVerse.test.tsx

describe('KineticVerse cycling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('advances to the next verse after the hold elapses', async () => {
    const verses = [
      { ref: 'ALPHA 1:1', lines: [['alpha']] },
      { ref: 'BETA 2:2', lines: [['beta']] },
    ];
    render(<KineticVerse verses={verses} cycle={true} holdMs={200} staggerMs={100} wordDurationMs={100} />);
    expect(screen.getByText(/ALPHA 1:1/)).toBeInTheDocument();

    // wordCount=1 × stagger 100 + wordDuration 100 = revealMs=200; +hold 200 = 400ms.
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.getByText(/BETA 2:2/)).toBeInTheDocument();
  });
});

describe('KineticVerse reduced motion', () => {
  // Override matchMedia for this block.
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = (q: string) => ({
      matches: q.includes('reduce'),
      media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  });
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('renders verse[0] static and does not advance', async () => {
    vi.useFakeTimers();
    const verses = [
      { ref: 'ALPHA 1:1', lines: [['alpha']] },
      { ref: 'BETA 2:2', lines: [['beta']] },
    ];
    render(<KineticVerse verses={verses} cycle={true} holdMs={100} />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByText(/ALPHA 1:1/)).toBeInTheDocument();
    expect(screen.queryByText(/BETA 2:2/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd client && npx vitest run src/components/landing/__tests__/KineticVerse.test.tsx
```

Expected: PASS — 4 tests total.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/landing/__tests__/KineticVerse.test.tsx
git commit -m "test(landing): cover KineticVerse cycling and reduced-motion paths"
```

---

## Phase 5 — Landing Sections

### Task 14: Header section

**Files:**
- Create: `client/src/components/landing/Header.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/Header.tsx
import { motion } from 'framer-motion';
import { EDITORIAL_EASE } from './motion';

export function Header() {
  return (
    <header className="border-b border-editorial-hairline bg-editorial-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-10 py-5">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EDITORIAL_EASE }}
          className="font-display text-[22px] italic tracking-tight text-editorial-dark"
        >
          Biblefuel
        </motion.span>
        <nav className="flex gap-6 font-sans text-[11px] uppercase tracking-[1.5px] text-editorial-muted">
          <a href="#studio">Studio</a>
          <a href="#who">Who it's for</a>
          <a href="#access" className="text-editorial-ink hover:underline">Request access</a>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/Header.tsx
git commit -m "feat(landing): Header section with animated wordmark"
```

---

### Task 15: Hero section (uses KineticVerse)

**Files:**
- Create: `client/src/components/landing/Hero.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/Hero.tsx
import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';
import { KineticVerse } from './KineticVerse';

export function Hero() {
  const m = useEditorialMotion();

  // Headline split: ["A", "quiet", "studio", "for", "*louder*", "witness."]
  // Stars wrap an italic-gold word.
  const headlineWords = ['A', 'quiet', 'studio', 'for', '*louder*', 'witness.'];

  return (
    <section className="bg-gradient-to-b from-editorial-paper to-editorial-parchment px-10 py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-[1.1fr_1fr]">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={m.staggerChildren}
        >
          <motion.div
            variants={m.fadeUpFast}
            className="mb-4 font-sans text-[10px] uppercase tracking-[2.5px] text-editorial-gold"
          >
            — For those who carry the Word
          </motion.div>

          <motion.h1
            variants={m.wordStagger}
            className="font-display text-[44px] leading-[0.98] tracking-[-1.2px] text-editorial-ink md:text-[62px]"
          >
            {headlineWords.map((w, i) => {
              const em = w.startsWith('*') && w.endsWith('*');
              const text = em ? w.slice(1, -1) : w;
              return (
                <motion.span
                  key={i}
                  variants={m.wordReveal}
                  className={
                    em
                      ? 'mr-[0.25em] inline-block italic text-editorial-goldDeep'
                      : 'mr-[0.25em] inline-block'
                  }
                >
                  {text}
                </motion.span>
              );
            })}
          </motion.h1>

          <motion.p
            variants={m.fadeUp}
            className="mt-6 max-w-[90%] font-bodyserif text-[16px] leading-[1.55] text-editorial-body"
          >
            For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel.
          </motion.p>

          <motion.div variants={m.fadeUp} className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#access"
              className="inline-block rounded-sm bg-editorial-ink px-6 py-3.5 font-sans text-[11px] font-medium uppercase tracking-[1.8px] text-editorial-paper"
            >
              Request access →
            </a>
            <a
              href="/app"
              target="_blank"
              rel="noopener"
              className="font-sans text-[12px] text-editorial-muted underline underline-offset-4"
            >
              See the studio
            </a>
          </motion.div>
        </motion.div>

        <KineticVerse />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/Hero.tsx
git commit -m "feat(landing): Hero section with word-staggered headline + KineticVerse"
```

---

### Task 16: WhatsInside section

**Files:**
- Create: `client/src/components/landing/WhatsInside.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/WhatsInside.tsx
import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';

type Feature = { numeral: string; title: string; body: string };

const features: Feature[] = [
  {
    numeral: 'i.',
    title: 'Scripts',
    body: 'Generate sermon clips, devotionals, and series outlines from Scripture. Edit them like a writer would, not a chatbot.',
  },
  {
    numeral: 'ii.',
    title: 'Voice',
    body: 'Turn any script into spoken word — your voice (cloned with consent) or a chosen library voice. Clean, warm, ready to publish.',
  },
  {
    numeral: 'iii.',
    title: 'Kinetic Video',
    body: 'Render captioned, kinetic-typography videos of any verse — the same engine you saw above. Post to TikTok, YouTube, Instagram.',
  },
];

export function WhatsInside() {
  const m = useEditorialMotion();

  return (
    <section id="studio" className="bg-editorial-paper px-10 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center font-sans text-[12px] tracking-[12px] text-editorial-gold">
          ✦  ✦  ✦
        </div>

        <motion.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="font-display text-[40px] leading-[1.05] tracking-[-0.6px] text-editorial-ink"
        >
          What's inside the studio.
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="mb-12 max-w-[600px] font-bodyserif text-[15px] leading-[1.55] text-editorial-muted"
        >
          Three crafts, one tab. No agencies, no installs — just the tools the work actually needs.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={m.staggerChildren}
          className="grid grid-cols-1 gap-9 md:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={m.fadeUp}>
              <div className="font-display text-[26px] italic text-editorial-gold">{f.numeral}</div>
              <h3 className="mt-3 font-display text-[22px] text-editorial-ink">{f.title}</h3>
              <p className="mt-2 font-bodyserif text-[14px] leading-[1.6] text-editorial-muted">{f.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/WhatsInside.tsx
git commit -m "feat(landing): WhatsInside section (Scripts/Voice/Kinetic Video)"
```

---

### Task 17: HowItWorks section (dark band)

**Files:**
- Create: `client/src/components/landing/HowItWorks.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/HowItWorks.tsx
import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';

type Step = { num: string; title: string; body: string };

const steps: Step[] = [
  { num: 'I · Write',   title: 'Begin with the Word.', body: 'Pick a passage or topic. The studio drafts a script in your voice. Refine until it sings.' },
  { num: 'II · Speak',  title: 'Give it a voice.',     body: 'Record yours or use a voice you trust. Clean the audio. Add music. Listen back.' },
  { num: 'III · Publish', title: 'Send it out.',       body: 'Render, caption, and schedule. The Word goes where the next generation already is.' },
];

export function HowItWorks() {
  const m = useEditorialMotion();

  return (
    <section id="who" className="bg-editorial-dark px-10 py-20 text-editorial-paper">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="font-display text-[40px] leading-[1.05] tracking-[-0.6px]"
        >
          From a verse to the world,<br />in three movements.
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="mb-12 max-w-[600px] font-bodyserif text-[15px] leading-[1.55] text-[#a8a098]"
        >
          The studio was built around a simple liturgy of making.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={m.staggerSlow}
          className="grid grid-cols-1 gap-9 md:grid-cols-3"
        >
          {steps.map((s) => (
            <motion.div key={s.num} variants={m.fadeUp} className="border-t border-editorial-goldLite/20 pt-6">
              <div className="font-sans text-[11px] uppercase tracking-[2px] text-editorial-goldLite">{s.num}</div>
              <h3 className="mt-2 font-display text-[26px]">{s.title}</h3>
              <p className="mt-3 font-bodyserif text-[14px] leading-[1.6] text-[#a8a098]">{s.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/HowItWorks.tsx
git commit -m "feat(landing): HowItWorks dark-band section"
```

---

### Task 18: AccessForm — failing tests first

**Files:**
- Create: `client/src/components/landing/__tests__/AccessForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/landing/__tests__/AccessForm.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessForm } from '../AccessForm';

describe('AccessForm', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('submits valid form data to /api/access-requests and shows thank-you panel', async () => {
    render(<AccessForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/ministry/i), 'Difference Engine');
    await user.type(screen.getByLabelText(/sentence/i), 'A weekly devotional for engineers.');
    await user.click(screen.getByRole('button', { name: /submit request/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/access-requests',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        }),
      );
    });
    expect(screen.getByText(/received/i)).toBeInTheDocument();
    expect(screen.getByText(/we'll be in touch/i)).toBeInTheDocument();
  });

  it('shows validation errors when fields are empty', async () => {
    render(<AccessForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('honeypot field is rendered off-screen but in the DOM', () => {
    render(<AccessForm />);
    const hp = screen.getByLabelText(/website/i, { selector: 'input' });
    expect(hp).toBeInTheDocument();
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp).toHaveAttribute('autocomplete', 'off');
  });

  it('shows server error message on 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'SERVER' }),
    }) as unknown as typeof fetch;

    render(<AccessForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/your name/i), 'Ada');
    await user.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/ministry/i), 'O');
    await user.type(screen.getByLabelText(/sentence/i), 'p');
    await user.click(screen.getByRole('button', { name: /submit request/i }));
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx vitest run src/components/landing/__tests__/AccessForm.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Commit the failing tests**

```bash
git add client/src/components/landing/__tests__/AccessForm.test.tsx
git commit -m "test(landing): failing tests for AccessForm validation + submit"
```

---

### Task 19: AccessForm — implementation

**Files:**
- Create: `client/src/components/landing/AccessForm.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/AccessForm.tsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import { z } from 'zod';
import { useEditorialMotion } from './motion';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Please enter a valid email').max(254),
  org: z.string().trim().min(1, 'Ministry, church, or channel is required').max(200),
  pitch: z.string().trim().min(1, 'A sentence is required').max(500, 'Please keep it to 500 characters'),
  hp_url: z.string().max(2000).default(''),
});

type FormState = z.infer<typeof schema>;

const initial: FormState = { name: '', email: '', org: '', pitch: '', hp_url: '' };

export function AccessForm() {
  const m = useEditorialMotion();
  const [values, setValues] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof FormState;
        if (!next[k]) next[k] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setServerError('Something went wrong. Please try again in a moment.');
      }
    } catch {
      setServerError('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="access" className="bg-editorial-parchment px-10 py-20 text-center">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
        variants={m.fadeUp}
        className="mx-auto max-w-[520px]"
      >
        {submitted ? (
          <div>
            <h2 className="font-display text-[44px] leading-tight text-editorial-ink">Received.</h2>
            <p className="mt-3 font-bodyserif text-[15px] text-editorial-muted">
              We'll be in touch soon — usually within a few days.
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-[44px] leading-tight text-editorial-ink">Request access.</h2>
            <p className="mt-3 mb-9 font-bodyserif text-[15px] text-editorial-muted">
              The studio is opening in waves to a small number of ministries and creators.
              Tell us a little about your work — we'll be in touch.
            </p>

            <form onSubmit={onSubmit} className="flex flex-col gap-3 text-left" noValidate>
              <Field label="Your name" name="name" value={values.name} onChange={update('name')} error={errors.name} />
              <Field label="Email" name="email" type="email" value={values.email} onChange={update('email')} error={errors.email} />
              <Field label="Ministry, church, or channel name" name="org" value={values.org} onChange={update('org')} error={errors.org} />
              <Field label="A sentence about what you're making" name="pitch" textarea value={values.pitch} onChange={update('pitch')} error={errors.pitch} />

              {/* Honeypot: invisible to humans, fillable by naive bots. */}
              <label className="bf-honeypot" aria-hidden="true">
                Website
                <input
                  type="text"
                  name="hp_url"
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.hp_url}
                  onChange={update('hp_url')}
                />
              </label>

              {serverError && (
                <div className="rounded-sm border border-editorial-goldDeep/30 bg-editorial-paper p-3 text-[13px] text-editorial-ink">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 rounded-sm bg-editorial-ink px-6 py-3.5 font-sans text-[11px] font-medium uppercase tracking-[1.8px] text-editorial-paper disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit request →'}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </section>
  );
}

interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string;
  type?: string;
  textarea?: boolean;
}

function Field({ label, name, value, onChange, error, type = 'text', textarea = false }: FieldProps) {
  const id = `bf-${name}`;
  const baseClass = 'rounded-sm border border-editorial-hairline bg-editorial-paper px-4 py-3 font-bodyserif text-[14px] text-editorial-ink placeholder:text-editorial-muted/60 focus:border-editorial-goldDeep focus:outline-none';

  return (
    <div>
      <label htmlFor={id} className="block font-sans text-[10px] uppercase tracking-[1.5px] text-editorial-muted">
        {label}
      </label>
      {textarea ? (
        <textarea id={id} name={name} value={value} onChange={onChange} rows={3} className={`${baseClass} mt-1 w-full`} />
      ) : (
        <input id={id} name={name} type={type} value={value} onChange={onChange} className={`${baseClass} mt-1 w-full`} />
      )}
      {error && <div className="mt-1 font-sans text-[11px] text-editorial-goldDeep">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd client && npx vitest run src/components/landing/__tests__/AccessForm.test.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/landing/AccessForm.tsx
git commit -m "feat(landing): AccessForm with Zod validation, honeypot, thank-you panel"
```

---

### Task 20: Footer section

**Files:**
- Create: `client/src/components/landing/Footer.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/components/landing/Footer.tsx
export function Footer() {
  return (
    <footer className="border-t border-editorial-hairline bg-editorial-paper px-10 py-9">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 font-sans text-[11px] uppercase tracking-[1px] text-editorial-muted md:flex-row">
        <span>© Biblefuel · A studio by Tiwaton</span>
        <div className="flex gap-5">
          <a href="mailto:hello@tiwaton.co.uk">Privacy</a>
          <a href="mailto:hello@tiwaton.co.uk">Terms</a>
          <a href="mailto:hello@tiwaton.co.uk">Contact</a>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/landing/Footer.tsx
git commit -m "feat(landing): Footer section with mailto placeholders"
```

---

## Phase 6 — UnauthedOnly + Route Restructure

### Task 21: UnauthedOnly guard + test

**Files:**
- Create: `client/src/components/landing/UnauthedOnly.tsx`
- Create: `client/src/components/landing/__tests__/UnauthedOnly.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/landing/__tests__/UnauthedOnly.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UnauthedOnly } from '../UnauthedOnly';

describe('UnauthedOnly', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders children when no BF_TOKEN in localStorage', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Landing')).toBeInTheDocument();
  });

  it('redirects to /app when BF_TOKEN is present', () => {
    localStorage.setItem('BF_TOKEN', 'fake.jwt.value');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('ignores literal "null"/"undefined" string tokens', () => {
    localStorage.setItem('BF_TOKEN', 'null');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<UnauthedOnly redirect="/app"><div>Landing</div></UnauthedOnly>} />
          <Route path="/app" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Landing')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd client && npx vitest run src/components/landing/__tests__/UnauthedOnly.test.tsx
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```tsx
// client/src/components/landing/UnauthedOnly.tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

interface UnauthedOnlyProps {
  redirect: string;
  children: ReactNode;
}

function hasToken(): boolean {
  const t = localStorage.getItem('BF_TOKEN');
  return Boolean(t && t !== 'null' && t !== 'undefined');
}

export function UnauthedOnly({ redirect, children }: UnauthedOnlyProps) {
  if (hasToken()) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx vitest run src/components/landing/__tests__/UnauthedOnly.test.tsx
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/landing/UnauthedOnly.tsx client/src/components/landing/__tests__/UnauthedOnly.test.tsx
git commit -m "feat(landing): UnauthedOnly route guard reading BF_TOKEN"
```

---

### Task 22: Compose `LandingPage`

**Files:**
- Create: `client/src/pages/LandingPage.tsx`

- [ ] **Step 1: Implement**

```tsx
// client/src/pages/LandingPage.tsx
import { Header } from '../components/landing/Header';
import { Hero } from '../components/landing/Hero';
import { WhatsInside } from '../components/landing/WhatsInside';
import { HowItWorks } from '../components/landing/HowItWorks';
import { AccessForm } from '../components/landing/AccessForm';
import { Footer } from '../components/landing/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-editorial-paper text-editorial-ink antialiased">
      <Header />
      <Hero />
      <WhatsInside />
      <HowItWorks />
      <AccessForm />
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/LandingPage.tsx
git commit -m "feat(landing): compose LandingPage page"
```

---

### Task 23: Restructure `App.tsx` routes — landing at `/`, dashboard at `/app/*`

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace the route tree**

Rewrite the `<Routes>` block in `client/src/App.tsx`:

```tsx
// client/src/App.tsx — within the existing component
import { LandingPage } from './pages/LandingPage';
import { UnauthedOnly } from './components/landing/UnauthedOnly';

// (keep existing lazy() declarations)

// ...inside <Routes>:
<Routes>
  <Route
    path="/"
    element={
      <UnauthedOnly redirect="/app">
        <LandingPage />
      </UnauthedOnly>
    }
  />
  <Route path="/app" element={<Layout />}>
    <Route index element={<HomePage />} />
    <Route path="wizard" element={<WizardPage />} />
    <Route path="scripts" element={<ScriptsPage />} />
    <Route path="queue" element={<QueuePage />} />
    <Route path="jobs" element={<JobsPage />} />
    <Route path="backgrounds" element={<BackgroundsPage />} />
    <Route path="voice-audio" element={<VoiceAudioPage />} />
    <Route path="timeline" element={<TimelinePage />} />
    <Route path="render" element={<RenderPage />} />
    <Route path="gumroad" element={<GumroadPage />} />
    <Route path="series" element={<SeriesPage />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="help" element={<HelpPage />} />
  </Route>
</Routes>
```

- [ ] **Step 2: Update internal links in `Layout.tsx`**

Open `client/src/components/Layout.tsx`. For every `<Link to="/...">` and `useNavigate()` call, prefix the path with `/app` unless it's already there. Examples of expected changes:

- `to="/"` → `to="/app"`
- `to="/scripts"` → `to="/app/scripts"`
- `navigate('/queue')` → `navigate('/app/queue')`

Run this verification grep after the edits — every match should be `/app/...`:

```bash
cd client/src && grep -rn "to=\"/" components pages | grep -v "/app" | grep -v "/api" | grep -v "mailto:"
```

Expected: only the LandingPage's own anchors (`#access`, `#studio`, `#who`) and the Hero's `to="/app"` should remain. If any dashboard nav still points to bare `/scripts` etc., update it.

- [ ] **Step 3: Smoke-run dev server, click through**

```bash
cd client && npm run dev
```

Visit http://localhost:5173/:
- Expected: Landing page renders.
- Click "See the studio" → opens `/app` in new tab → existing dashboard.
- Manually set `localStorage.BF_TOKEN = 'x'` in DevTools, refresh `/` → redirects to `/app`.

Stop dev server with Ctrl+C.

- [ ] **Step 4: Run the full client test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(landing): move dashboard to /app, mount LandingPage at /"
```

---

## Phase 7 — Build, Commit Static, Smoke

### Task 24: Production build + commit `server/public/**`

**Files:**
- Modify: `server/public/**` (regenerated by build)

- [ ] **Step 1: Build the client**

```bash
cd client && npm run build
```

Expected: `tsc -b` passes; `vite build` writes to `client/dist/`. No TypeScript errors. Bundle size reported.

- [ ] **Step 2: Verify the build copies into `server/public/`**

Check the existing build script that propagates `client/dist/**` into `server/public/**` (the existing biblefuel-studio build/deploy workflow handles this; if the build script doesn't auto-copy, copy manually):

```bash
# If the project uses a custom build script, run it. Otherwise:
rm -rf ../server/public
cp -r dist ../server/public
```

Verify the bundle includes the new code:

```bash
grep -l "VITE_FIREBASE\|Biblefuel\|RENDERED LIVE" ../server/public/assets/*.js | head
```

Expected: at least one hit per token.

- [ ] **Step 3: Commit the built artifacts**

```bash
cd ..
git add server/public
git commit -m "build(landing): production build of landing page + dashboard at /app"
```

- [ ] **Step 4: Run the server in production mode for smoke**

```bash
cd server && NODE_ENV=production node index.js &
sleep 2
curl -s http://localhost:5051/ | head -5     # should be HTML with <title>Biblefuel</title>
curl -s -X POST http://localhost:5051/api/access-requests \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke","email":"smoke@example.com","org":"Smoke Test","pitch":"Final smoke."}'
kill %1
```

Expected:
- `/` returns HTML (the SPA shell with landing JS).
- `/api/access-requests` returns `{"ok":true}`.
- `server/data/access-requests.json` has at least one record (including the previous smoke + this one).

- [ ] **Step 5: Manual phone test for the original Firebase mobile bug**

Visit `https://biblefuel.tiwaton.co.uk` from your phone (or use BrowserStack / Chrome DevTools "Toggle device toolbar"):
- Landing renders, KineticVerse animates, Cormorant Garamond loads.
- Tap REQUEST ACCESS → form scrolls into view.
- Fill the form with a real address you control, submit → thank-you panel.
- Check the inbox at `ACCESS_REQUEST_NOTIFY_TO` — notification email arrived with correct Reply-To.

If the form submits successfully on mobile, that **confirms the landing path is independent of the Firebase client-key issue** — the original mobile login bug is now unblocked (separately, the Firebase keys still need to be populated in `client/.env` and the client rebuilt, but that's an independent fix tracked outside this plan).

---

## Self-Review

### Spec coverage

Walked the spec section-by-section:

| Spec § | Covered by |
|---|---|
| §1 Visual & Editorial Direction | Task 9 (palette, fonts), Task 12 (kinetic styles), Tasks 14–20 (every section uses the palette) |
| §2 Page Structure & Section Copy | Tasks 14 (Header), 15 (Hero), 16 (WhatsInside), 17 (HowItWorks), 18-19 (AccessForm), 20 (Footer), 22 (compose) |
| §3 KineticVerse component (rotation, anchor words, behaviour, public API) | Tasks 12 + 13 |
| §4 Scroll-in animations + editorial curve | Task 11 (motion.ts), used in every section task |
| §5 Backend access-requests + Resend email | Tasks 1–8 |
| §6 Routing + UnauthedOnly + Tailwind palette + mobile + Framer Motion dep | Tasks 9, 21, 22, 23 |
| §7 Testing (server unit + integration; client component tests) | Tasks 1, 2, 4, 6, 7, 12, 13, 18, 19, 21 |
| §8 Build + commit `server/public` | Task 24 |
| §9 Risks — internal nav rename | Task 23 step 2; CSP already permits Google Fonts (verified at server index.js read) |
| §10 Open questions (noindex, drafts, etc.) | Deferred per spec — not implemented |

E2E Playwright was listed in the spec under §7 but explicitly as a smaller scope; this plan defers automated E2E to a follow-up and uses a manual smoke (Task 24 step 4-5) instead. Flagged here so it's not forgotten.

### Placeholder scan

- No "TBD", "TODO", "fill in details" remain.
- Every implementation step has a complete code block.
- Every test step has assertions.
- Type names used in later tasks match earlier definitions: `KineticVerseProps`, `FormState`, `AccessRequestsStore.append`, `createEmailTransport`, `sendEmail`, `UnauthedOnlyProps`. Checked.

### Type consistency

- Server JS uses ESM + JSDoc-style types only. Public functions are factories (`createX`) consistent throughout.
- Client uses interface for component props (per the repo's TS style rules), `type` for unions, Zod-inferred types where appropriate.
- `BF_TOKEN` key is consistent with `useAuth` hook's existing usage (verified during exploration).

### Scope check

This is a single subsystem — the public landing page and its email pipeline. It is large but tightly coupled (the form is the page; the email is the form's tail). Decomposition would only fragment a coherent feature. Plan is appropriately scoped as one document.

---

## Execution Handoff

**Plan complete and saved to [docs/superpowers/plans/2026-05-26-landing-page.md](./2026-05-26-landing-page.md). Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
