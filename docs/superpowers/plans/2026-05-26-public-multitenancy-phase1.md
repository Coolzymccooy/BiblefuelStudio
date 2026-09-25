# Phase 1 Public Multi-Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: [2026-05-26-public-multitenancy-design.md](../specs/2026-05-26-public-multitenancy-design.md).

**Goal:** Refactor Biblefuel Studio's server to support per-user data isolation behind a `MULTITENANT=true` env flag, while keeping the super-admin's runtime behaviour observationally identical to current master.

**Architecture:** Add two middlewares (`withUserScope`, `featureGate`) mounted after `requireAuth`. Stores accept an explicit `dataDir` parameter instead of importing global constants. Super-admin (matched by `SUPER_ADMIN_EMAIL` or `SUPER_ADMIN_USER_ID`) resolves to the existing `DATA_DIR`; other users resolve to `DATA_DIR/users/<userId>/`.

**Tech Stack:** Node 18+ ESM, Express 4, `node:test`, Zod (already present).

**Verification at end:** `grep -rn "DATA_DIR\|OUTPUT_DIR" server/src/routes server/src/lib | grep -v paths.js | grep -v userScope.js | grep -v "//"` returns zero hits; `npm test` passes; with `MULTITENANT=false`, super-admin still hits legacy files.

---

## Task 1: Extend test script to discover all `test/**/*.test.js`

**Files:** Modify `server/package.json`

- [ ] **Step 1.1:** Change the `test` script to discover any `test/**/*.test.js`.

```json
"test": "node --test \"test/**/*.test.js\""
```

- [ ] **Step 1.2:** Sanity check — existing voice tests still run.

Run: `cd server && npm test`
Expected: all `test/voice/*.test.js` files pass.

- [ ] **Step 1.3:** Commit.

```bash
git add server/package.json
git commit -m "chore(test): broaden npm test glob to test/**/*.test.js"
```

---

## Task 2: `userPlan.js` — pure plan-resolution helper

**Files:** Create `server/src/lib/userPlan.js`, Create `server/test/middleware/userPlan.test.js`

- [ ] **Step 2.1:** Write the failing test.

```js
// server/test/middleware/userPlan.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPlanForUser, isSuperAdmin } from "../../src/lib/userPlan.js";

test("isSuperAdmin: email match (case-insensitive)", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = "Admin@Example.com";
  try {
    assert.equal(isSuperAdmin({ email: "admin@example.com" }), true);
    assert.equal(isSuperAdmin({ email: "other@example.com" }), false);
  } finally {
    if (prev === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prev;
  }
});

test("isSuperAdmin: user_id fallback", () => {
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  const prevI = process.env.SUPER_ADMIN_USER_ID;
  delete process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_USER_ID = "u_123";
  try {
    assert.equal(isSuperAdmin({ sub: "u_123", email: "" }), true);
    assert.equal(isSuperAdmin({ sub: "u_999", email: "" }), false);
  } finally {
    if (prevE !== undefined) process.env.SUPER_ADMIN_EMAIL = prevE;
    if (prevI === undefined) delete process.env.SUPER_ADMIN_USER_ID;
    else process.env.SUPER_ADMIN_USER_ID = prevI;
  }
});

test("isSuperAdmin: no env vars set => false", () => {
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  const prevI = process.env.SUPER_ADMIN_USER_ID;
  delete process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_USER_ID;
  try {
    assert.equal(isSuperAdmin({ sub: "u_1", email: "x@y" }), false);
  } finally {
    if (prevE !== undefined) process.env.SUPER_ADMIN_EMAIL = prevE;
    if (prevI !== undefined) process.env.SUPER_ADMIN_USER_ID = prevI;
  }
});

test("getPlanForUser: super-admin email => super_admin", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
  try {
    assert.equal(getPlanForUser({ email: "admin@example.com" }), "super_admin");
  } finally {
    if (prev === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prev;
  }
});

test("getPlanForUser: regular user => free", () => {
  const prev = process.env.SUPER_ADMIN_EMAIL;
  delete process.env.SUPER_ADMIN_EMAIL;
  try {
    assert.equal(getPlanForUser({ email: "user@example.com" }), "free");
  } finally {
    if (prev !== undefined) process.env.SUPER_ADMIN_EMAIL = prev;
  }
});
```

- [ ] **Step 2.2:** Run test, expect failure.

Run: `cd server && npm test`
Expected: import resolves to nothing — failure.

- [ ] **Step 2.3:** Implement `userPlan.js`.

```js
// server/src/lib/userPlan.js

/**
 * @typedef {Object} JwtUser
 * @property {string} sub
 * @property {string} [email]
 * @property {string} [role]
 */

/**
 * @param {JwtUser} user
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  const adminEmail = String(process.env.SUPER_ADMIN_EMAIL || "").toLowerCase().trim();
  const adminId    = String(process.env.SUPER_ADMIN_USER_ID || "").trim();
  if (adminId && String(user.sub || "") === adminId) return true;
  if (adminEmail && String(user.email || "").toLowerCase() === adminEmail) return true;
  return false;
}

/**
 * Hard-coded plan resolution for Phase 1.
 * Phase 5 (billing) will replace this with a lookup against a per-user record.
 *
 * @param {JwtUser} user
 * @returns {'super_admin'|'free'|'premium'}
 */
export function getPlanForUser(user) {
  if (isSuperAdmin(user)) return "super_admin";
  return "free";
}
```

- [ ] **Step 2.4:** Run test, expect pass.

Run: `cd server && npm test`
Expected: all userPlan tests pass.

- [ ] **Step 2.5:** Commit.

```bash
git add server/src/lib/userPlan.js server/test/middleware/userPlan.test.js
git commit -m "feat(multitenant): userPlan helper — super-admin detection + plan tier"
```

---

## Task 3: `paths.js` — add `dataDirFor(user)` + `outputDirFor(user)` helpers

**Files:** Modify `server/src/lib/paths.js`

- [ ] **Step 3.1:** Append helpers to `paths.js`.

```js
// Append to server/src/lib/paths.js

import fs from "fs";
import { isSuperAdmin } from "./userPlan.js";

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. Super-admin => DATA_DIR (legacy). Others => DATA_DIR/users/<sub>/
 */
export function dataDirFor(user) {
  if (isSuperAdmin(user)) return DATA_DIR;
  const sub = String(user?.sub || "").trim();
  if (!sub) throw new Error("dataDirFor: user.sub required");
  return path.join(DATA_DIR, "users", sub);
}

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. Super-admin => OUTPUT_DIR (legacy). Others => DATA_DIR/users/<sub>/outputs/
 */
export function outputDirFor(user) {
  if (isSuperAdmin(user)) return OUTPUT_DIR;
  return path.join(dataDirFor(user), "outputs");
}

/**
 * Idempotently create the dirs.
 * @param {{sub:string, email?:string}} user
 */
export function ensureUserDirs(user) {
  const d = dataDirFor(user);
  const o = outputDirFor(user);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(o)) fs.mkdirSync(o, { recursive: true });
  return { dataDir: d, outputDir: o };
}
```

Also add `import fs from "fs";` at the top if not already present.

- [ ] **Step 3.2:** No new tests for `paths.js` directly — covered indirectly by userScope tests.

- [ ] **Step 3.3:** Commit.

```bash
git add server/src/lib/paths.js
git commit -m "feat(multitenant): dataDirFor/outputDirFor/ensureUserDirs helpers"
```

---

## Task 4: `userScope.js` middleware

**Files:** Create `server/src/middleware/userScope.js`, Create `server/test/middleware/userScope.test.js`

- [ ] **Step 4.1:** Write failing test.

```js
// server/test/middleware/userScope.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { withUserScope } from "../../src/middleware/userScope.js";
import { DATA_DIR, OUTPUT_DIR } from "../../src/lib/paths.js";

function makeReqRes(user) {
  const req = { user };
  let nextCalled = false;
  let statusCode = null;
  let payload = null;
  const next = () => { nextCalled = true; };
  const res = {
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
  };
  return { req, res, next, get nextCalled() { return nextCalled; },
           get statusCode() { return statusCode; }, get payload() { return payload; } };
}

test("withUserScope: MULTITENANT=false => legacy ctx with DATA_DIR for everyone", () => {
  const prevMT = process.env.MULTITENANT;
  process.env.MULTITENANT = "false";
  try {
    const ctx = makeReqRes({ sub: "u_random", email: "anyone@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.outputDir, OUTPUT_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.plan, "super_admin");
  } finally {
    if (prevMT === undefined) delete process.env.MULTITENANT;
    else process.env.MULTITENANT = prevMT;
  }
});

test("withUserScope: MULTITENANT=true, super-admin email => DATA_DIR (legacy)", () => {
  const prevMT = process.env.MULTITENANT;
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  process.env.MULTITENANT = "true";
  process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
  try {
    const ctx = makeReqRes({ sub: "u_admin", email: "admin@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.outputDir, OUTPUT_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.plan, "super_admin");
  } finally {
    if (prevMT === undefined) delete process.env.MULTITENANT;
    else process.env.MULTITENANT = prevMT;
    if (prevE === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prevE;
  }
});

test("withUserScope: MULTITENANT=true, regular user => per-user dir", () => {
  const prevMT = process.env.MULTITENANT;
  const prevE = process.env.SUPER_ADMIN_EMAIL;
  process.env.MULTITENANT = "true";
  process.env.SUPER_ADMIN_EMAIL = "admin@example.com";
  try {
    const ctx = makeReqRes({ sub: "u_alice", email: "alice@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_alice"));
    assert.equal(ctx.req.ctx.outputDir, path.join(DATA_DIR, "users", "u_alice", "outputs"));
    assert.equal(ctx.req.ctx.isSuperAdmin, false);
    assert.equal(ctx.req.ctx.plan, "free");
  } finally {
    if (prevMT === undefined) delete process.env.MULTITENANT;
    else process.env.MULTITENANT = prevMT;
    if (prevE === undefined) delete process.env.SUPER_ADMIN_EMAIL;
    else process.env.SUPER_ADMIN_EMAIL = prevE;
  }
});

test("withUserScope: no req.user => 401", () => {
  const ctx = makeReqRes(undefined);
  withUserScope(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 401);
});
```

- [ ] **Step 4.2:** Run test, expect failure.

Run: `cd server && npm test`
Expected: import resolves to nothing.

- [ ] **Step 4.3:** Implement middleware.

```js
// server/src/middleware/userScope.js
import { DATA_DIR, OUTPUT_DIR, ensureUserDirs } from "../lib/paths.js";
import { isSuperAdmin, getPlanForUser } from "../lib/userPlan.js";

export function withUserScope(req, res, next) {
  const user = req.user;
  if (!user || !user.sub) {
    return res.status(401).json({ ok: false, error: "Missing user context" });
  }

  const multitenant = String(process.env.MULTITENANT || "").toLowerCase() === "true";

  if (!multitenant) {
    // Legacy path — observationally identical to pre-refactor master.
    req.ctx = {
      userId: user.sub,
      email: user.email || "",
      role: "super_admin",
      plan: "super_admin",
      dataDir: DATA_DIR,
      outputDir: OUTPUT_DIR,
      isSuperAdmin: true,
    };
    return next();
  }

  const admin = isSuperAdmin(user);
  const { dataDir, outputDir } = admin
    ? { dataDir: DATA_DIR, outputDir: OUTPUT_DIR }
    : ensureUserDirs(user);

  req.ctx = {
    userId: user.sub,
    email: user.email || "",
    role: admin ? "super_admin" : "user",
    plan: getPlanForUser(user),
    dataDir,
    outputDir,
    isSuperAdmin: admin,
  };
  next();
}
```

- [ ] **Step 4.4:** Run test, expect pass.

Run: `cd server && npm test`
Expected: all 4 userScope tests pass.

- [ ] **Step 4.5:** Commit.

```bash
git add server/src/middleware/userScope.js server/test/middleware/userScope.test.js
git commit -m "feat(multitenant): withUserScope middleware + tests"
```

---

## Task 5: `featureGate.js` middleware

**Files:** Create `server/src/middleware/featureGate.js`, Create `server/test/middleware/featureGate.test.js`

- [ ] **Step 5.1:** Write failing test.

```js
// server/test/middleware/featureGate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { featureGate, PLAN_CAPABILITIES } from "../../src/middleware/featureGate.js";

function makeReqRes(plan) {
  const req = { ctx: { plan } };
  let nextCalled = false;
  let statusCode = null;
  let payload = null;
  const next = () => { nextCalled = true; };
  const res = {
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
  };
  return { req, res, next, get nextCalled() { return nextCalled; },
           get statusCode() { return statusCode; }, get payload() { return payload; } };
}

test("featureGate: super_admin passes every capability", () => {
  const mw = featureGate("gumroad");
  const ctx = makeReqRes("super_admin");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: free + gumroad => 403 FEATURE_LOCKED", () => {
  const mw = featureGate("gumroad");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 403);
  assert.equal(ctx.payload.error, "FEATURE_LOCKED");
  assert.equal(ctx.payload.capability, "gumroad");
});

test("featureGate: free + tts.elevenlabs => 403", () => {
  const mw = featureGate("tts.elevenlabs");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.statusCode, 403);
});

test("featureGate: free + tts.edge => next", () => {
  const mw = featureGate("tts.edge");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: premium + tts.elevenlabs => next", () => {
  const mw = featureGate("tts.elevenlabs");
  const ctx = makeReqRes("premium");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: missing ctx => 401", () => {
  const mw = featureGate("anything");
  const req = {};
  let statusCode = null;
  const res = { status(c){ statusCode = c; return this; }, json(){ return this; } };
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
});

test("PLAN_CAPABILITIES: gumroad is super_admin only", () => {
  assert.equal(PLAN_CAPABILITIES.super_admin.has("*"), true);
  assert.equal(PLAN_CAPABILITIES.premium.has("gumroad"), false);
  assert.equal(PLAN_CAPABILITIES.free.has("gumroad"), false);
});
```

- [ ] **Step 5.2:** Run test, expect failure.

Run: `cd server && npm test`

- [ ] **Step 5.3:** Implement.

```js
// server/src/middleware/featureGate.js

export const PLAN_CAPABILITIES = Object.freeze({
  super_admin: new Set(["*"]),
  premium: new Set([
    "scripts", "tts.edge", "tts.chatterbox", "tts.elevenlabs",
    "voice.clone", "render", "library", "series", "bible", "social.connect",
  ]),
  free: new Set([
    "scripts", "tts.edge", "tts.chatterbox",
    "render", "library", "series", "bible", "social.connect",
  ]),
});

/**
 * @param {string} capability  e.g. "tts.elevenlabs", "gumroad"
 */
export function featureGate(capability) {
  return function gate(req, res, next) {
    const plan = req?.ctx?.plan;
    if (!plan) {
      return res.status(401).json({ ok: false, error: "Missing user context" });
    }
    const caps = PLAN_CAPABILITIES[plan] || new Set();
    if (caps.has("*") || caps.has(capability)) return next();
    return res.status(403).json({
      ok: false,
      error: "FEATURE_LOCKED",
      capability,
      plan,
    });
  };
}
```

- [ ] **Step 5.4:** Run tests, expect pass.

Run: `cd server && npm test`

- [ ] **Step 5.5:** Commit.

```bash
git add server/src/middleware/featureGate.js server/test/middleware/featureGate.test.js
git commit -m "feat(multitenant): featureGate middleware + capability matrix"
```

---

## Task 6: Refactor `library.js` to accept `dataDir`

**Files:** Modify `server/src/lib/library.js`

- [ ] **Step 6.1:** Replace module-level `LIBRARY_FILE` resolution with per-call `libraryFilePath(dataDir)`. Functions take `dataDir` as first arg.

Replace the whole file with:

```js
// server/src/lib/library.js
import fs from "fs";
import path from "path";

function libraryFilePath(dataDir) {
  if (!dataDir) throw new Error("library: dataDir required");
  return path.join(dataDir, "library.json");
}

function ensure(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const f = libraryFilePath(dataDir);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ items: [] }, null, 2));
}

export function readLibrary(dataDir) {
  ensure(dataDir);
  try {
    return JSON.parse(fs.readFileSync(libraryFilePath(dataDir), "utf-8"));
  } catch {
    return { items: [] };
  }
}

export function writeLibrary(dataDir, data) {
  ensure(dataDir);
  fs.writeFileSync(libraryFilePath(dataDir), JSON.stringify(data, null, 2));
}

export function addToLibrary(dataDir, item) {
  const lib = readLibrary(dataDir);
  const now = new Date().toISOString();
  const idx = lib.items.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const existing = lib.items[idx];
    const merged = { ...existing, ...item, id: item.id,
                     savedAt: existing.savedAt || now, updatedAt: now };
    lib.items.splice(idx, 1);
    lib.items.unshift(merged);
    writeLibrary(dataDir, lib);
    return merged;
  }
  const created = { ...item, savedAt: now, updatedAt: now };
  lib.items.unshift(created);
  writeLibrary(dataDir, lib);
  return created;
}

export function removeFromLibrary(dataDir, id) {
  const lib = readLibrary(dataDir);
  lib.items = lib.items.filter((x) => x.id !== id);
  writeLibrary(dataDir, lib);
}
```

- [ ] **Step 6.2:** Update all callers to pass `req.ctx.dataDir`.

Run: `grep -rn "readLibrary\|writeLibrary\|addToLibrary\|removeFromLibrary" server/src --include="*.js"`

For each match (except the definitions in `library.js`), prepend `req.ctx.dataDir` as the first argument. Likely callers: `server/src/routes/library.js`, possibly others.

- [ ] **Step 6.3:** Commit.

```bash
git add server/src/lib/library.js server/src/routes/library.js
git commit -m "refactor(multitenant): library store takes dataDir parameter"
```

---

## Task 7: Refactor `store.js` (queue) to accept `dataDir`

**Files:** Modify `server/src/lib/store.js`

- [ ] **Step 7.1:** Replace with `dataDir`-parameterised version.

```js
// server/src/lib/store.js
import fs from "fs";
import path from "path";

function queuePath(dataDir) {
  if (!dataDir) throw new Error("queue: dataDir required");
  return path.join(dataDir, "queue.json");
}
function logPath(dataDir) {
  return path.join(dataDir, "debug.log");
}

function log(dataDir, msg) {
  try {
    fs.appendFileSync(logPath(dataDir), `${new Date().toISOString()} - ${msg}\n`);
  } catch { /* best-effort */ }
}

function ensure(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const f = queuePath(dataDir);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, JSON.stringify({ items: [] }, null, 2));
    log(dataDir, "Created queue.json");
  }
}

export function readQueue(dataDir) {
  ensure(dataDir);
  const data = JSON.parse(fs.readFileSync(queuePath(dataDir), "utf-8"));
  return data;
}

export function writeQueue(dataDir, data) {
  ensure(dataDir);
  fs.writeFileSync(queuePath(dataDir), JSON.stringify(data, null, 2));
}

export function appendQueueItem(dataDir, item) {
  const q = readQueue(dataDir);
  q.items.unshift(item);
  writeQueue(dataDir, q);
  return item;
}

export function deleteQueueItem(dataDir, id) {
  const q = readQueue(dataDir);
  const before = q.items.length;
  q.items = q.items.filter((it) => it.id !== id);
  if (q.items.length !== before) {
    writeQueue(dataDir, q);
    return true;
  }
  return false;
}

export function clearQueue(dataDir) {
  writeQueue(dataDir, { items: [] });
  return true;
}
```

- [ ] **Step 7.2:** Update callers.

Run: `grep -rn "readQueue\|writeQueue\|appendQueueItem\|deleteQueueItem\|clearQueue" server/src --include="*.js"`

Update each caller to pass `req.ctx.dataDir`.

- [ ] **Step 7.3:** Commit.

```bash
git add server/src/lib/store.js server/src/routes/queue.js
git commit -m "refactor(multitenant): queue store takes dataDir parameter"
```

---

## Task 8: Refactor `seriesStore.js` to accept `dataDir`

**Files:** Modify `server/src/lib/series/seriesStore.js`

- [ ] **Step 8.1:** Replace module-level FILE/TMP with per-call paths; export functions taking `dataDir`.

```js
// server/src/lib/series/seriesStore.js
import fs from "fs";
import path from "path";

const MAX_RECENT = 200;

function filePath(dataDir) {
  if (!dataDir) throw new Error("series: dataDir required");
  return path.join(dataDir, "series.json");
}
function tmpPath(dataDir) {
  return path.join(dataDir, "series.json.tmp");
}

function ensureDir(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function readSeries(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.series) ? parsed.series : [];
  } catch {
    return [];
  }
}

export function appendSeries(dataDir, record) {
  ensureDir(dataDir);
  const current = readSeries(dataDir);
  const next = [record, ...current].slice(0, MAX_RECENT);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ series: next }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
  return record;
}

export function listSeriesForUser(dataDir, userId, limit = 50) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return [];
  return readSeries(dataDir)
    .filter((s) => String(s?.userId || "") === safeUserId)
    .slice(0, limit);
}
```

- [ ] **Step 8.2:** Update callers.

Run: `grep -rn "readSeries\|appendSeries\|listSeriesForUser" server/src --include="*.js"`

Update each to pass `req.ctx.dataDir` first.

- [ ] **Step 8.3:** Commit.

```bash
git add server/src/lib/series/seriesStore.js server/src/routes/series.js
git commit -m "refactor(multitenant): series store takes dataDir parameter"
```

---

## Task 9: Refactor `socialStore.js` to accept `dataDir`

**Files:** Modify `server/src/lib/socialStore.js`

- [ ] **Step 9.1:** Change `getStorePath()` → `getStorePath(dataDir)`. `readSocialStore(dataDir)`, `writeSocialStore(dataDir, next)`.

```js
// Replace getStorePath, readSocialStore, writeSocialStore in server/src/lib/socialStore.js

function getStorePath(dataDir) {
  if (!dataDir) throw new Error("social: dataDir required");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "social.json");
}

export function readSocialStore(dataDir) {
  try {
    const file = getStorePath(dataDir);
    const youtubeFallback = mergeYouTubeConfig({});
    if (!fs.existsSync(file)) {
      return {
        buffer: { accessToken: "", profileIds: [] },
        webhooks: [],
        direct: { youtube: youtubeFallback, instagram: {}, tiktok: {} },
        schedules: [],
      };
    }
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    return {
      buffer: {
        accessToken: data?.buffer?.accessToken || "",
        profileIds: Array.isArray(data?.buffer?.profileIds) ? data.buffer.profileIds : [],
      },
      webhooks: Array.isArray(data?.webhooks) ? data.webhooks : [],
      direct: {
        youtube: mergeYouTubeConfig(data?.direct?.youtube || {}),
        instagram: data?.direct?.instagram || {},
        tiktok: data?.direct?.tiktok || {},
      },
      schedules: Array.isArray(data?.schedules) ? data.schedules.map(normalizeSchedule) : [],
    };
  } catch {
    return {
      buffer: { accessToken: "", profileIds: [] },
      webhooks: [],
      direct: { youtube: mergeYouTubeConfig({}), instagram: {}, tiktok: {} },
      schedules: [],
    };
  }
}

export function writeSocialStore(dataDir, next) {
  const file = getStorePath(dataDir);
  // ... existing payload-shaping code unchanged ...
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}
```

(Leave the `normalizeSchedule`, `mergeYouTubeConfig`, `firstNonEmpty`, `getYouTubeEnvDefaults` helpers untouched.)

- [ ] **Step 9.2:** Update callers in `server/src/routes/social.js`. Every `readSocialStore()` becomes `readSocialStore(req.ctx.dataDir)`; every `writeSocialStore(next)` becomes `writeSocialStore(req.ctx.dataDir, next)`.

- [ ] **Step 9.3:** **Cron map keying** — in `social.js`, the existing `scheduleTasks = new Map()` keyed by `schedule.id`. Change all uses to key by `${req.ctx.userId}::${schedule.id}` so users' schedules cannot collide.

Find every occurrence:

```bash
grep -n "scheduleTasks" server/src/routes/social.js
```

For every `scheduleTasks.get(id)`, `scheduleTasks.set(id, ...)`, `scheduleTasks.delete(id)`, replace `id` with `\`${req.ctx.userId}::${id}\``.

- [ ] **Step 9.4:** **Boot-time schedule rehydration** — find the existing code that loops `readSocialStore().schedules` on boot and re-registers cron jobs. Wrap it so it iterates *every* user dir (super-admin's DATA_DIR + every `DATA_DIR/users/*/`) and rehydrates each. Use a synthetic `user` shape `{ sub: <userId>, email: "" }` when computing `dataDir`. Skip this if no such bootstrap exists; check with: `grep -n "node-cron\|cron.schedule" server/src/routes/social.js`.

- [ ] **Step 9.5:** Commit.

```bash
git add server/src/lib/socialStore.js server/src/routes/social.js
git commit -m "refactor(multitenant): social store takes dataDir + per-user cron keying"
```

---

## Task 10: Inline ElevenLabs capability check in `tts.js`

**Files:** Modify `server/src/routes/tts.js`

- [ ] **Step 10.1:** Identify the ElevenLabs branch.

Run: `grep -n -i "elevenlabs\|provider" server/src/routes/tts.js | head -30`

- [ ] **Step 10.2:** Where ElevenLabs is selected (e.g. `if (provider === 'elevenlabs')` or similar), insert at the very top of that branch:

```js
if (!req.ctx || (req.ctx.plan !== "super_admin" && req.ctx.plan !== "premium")) {
  return res.status(403).json({
    ok: false,
    error: "FEATURE_LOCKED",
    capability: "tts.elevenlabs",
    plan: req.ctx?.plan || "unknown",
  });
}
```

- [ ] **Step 10.3:** Also check `server/src/lib/ttsOrchestrator.js` for any default ElevenLabs fallback — if it can return ElevenLabs without an explicit user choice, gate that too. (Edge/Chatterbox fallbacks remain unrestricted.)

- [ ] **Step 10.4:** Commit.

```bash
git add server/src/routes/tts.js server/src/lib/ttsOrchestrator.js
git commit -m "feat(multitenant): gate ElevenLabs to super-admin + premium only"
```

---

## Task 11: Refactor `render.js` to write to `req.ctx.outputDir`

**Files:** Modify `server/src/routes/render.js`

- [ ] **Step 11.1:** `grep -n "OUTPUT_DIR" server/src/routes/render.js`. For every write target (final mp4, intermediate audio etc.), replace `OUTPUT_DIR` with `req.ctx.outputDir`. Reads from arbitrary paths (e.g. user-uploaded sources) stay unchanged.

- [ ] **Step 11.2:** Same for `server/src/routes/jobs.js`, `server/src/routes/audio.js`, `server/src/routes/audio_advanced.js`, `server/src/routes/media.js` — any place that *writes* artefacts. Run the same grep on each.

- [ ] **Step 11.3:** **Static serving** — in `server/index.js`, the line `app.use("/outputs", express.static(outputDir))` serves the *global* OUTPUT_DIR. Per-user outputs at `DATA_DIR/users/<id>/outputs/` are NOT reachable via this route. For Phase 1 this is acceptable for super-admin (their outputDir IS the static one); regular users serving outputs is Phase 2/3 work. Leave a `TODO` comment referencing this spec but do NOT add per-user static serving in Phase 1.

- [ ] **Step 11.4:** Commit.

```bash
git add server/src/routes/render.js server/src/routes/jobs.js server/src/routes/audio.js server/src/routes/audio_advanced.js server/src/routes/media.js server/index.js
git commit -m "refactor(multitenant): write outputs to req.ctx.outputDir"
```

---

## Task 12: Wire middleware in `index.js`

**Files:** Modify `server/index.js`

- [ ] **Step 12.1:** Import middleware.

At the top of `index.js`:

```js
import { withUserScope } from "./src/middleware/userScope.js";
import { featureGate } from "./src/middleware/featureGate.js";
```

- [ ] **Step 12.2:** Insert `withUserScope` between `requireAuth` and each router. Update every `app.use("/api/...", requireAuth, router)` to `app.use("/api/...", requireAuth, withUserScope, router)`. Exception: `/api/auth` stays as-is (no auth).

- [ ] **Step 12.3:** Add `featureGate("gumroad")` to the Gumroad mount.

```js
app.use("/api/gumroad", requireAuth, withUserScope, featureGate("gumroad"), gumroadRouter);
```

- [ ] **Step 12.4:** Tighten CORS for credentialed multi-tenant safety.

Find:
```js
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
```

Replace with:

```js
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin && corsOrigin !== "*" ? corsOrigin.split(",").map((s) => s.trim()) : "*",
  credentials: !!corsOrigin && corsOrigin !== "*",
}));
```

- [ ] **Step 12.5:** Commit.

```bash
git add server/index.js
git commit -m "feat(multitenant): mount withUserScope + featureGate; tighten CORS"
```

---

## Task 13: Verification grep + full test run

- [ ] **Step 13.1:** Verification grep must return zero non-comment hits outside `paths.js` and `userScope.js`.

Run:
```bash
grep -rn "DATA_DIR\|OUTPUT_DIR" server/src/routes server/src/lib \
  | grep -v "server/src/lib/paths.js" \
  | grep -v "server/src/middleware/userScope.js" \
  | grep -v "^[^:]*:[[:space:]]*//"
```

If any line surfaces a real (non-comment) hit, fix it.

- [ ] **Step 13.2:** Run all tests.

Run: `cd server && npm test`
Expected: all tests pass (existing voice tests + new middleware tests).

- [ ] **Step 13.3:** Document `MULTITENANT` + `SUPER_ADMIN_EMAIL` in `server/.env.example` if present (or create the entries — do NOT touch `server/.env` which contains real secrets).

```bash
ls server/.env.example
```

If exists, append:
```
# Phase 1 public multi-tenancy (Phase 1 spec)
MULTITENANT=false
SUPER_ADMIN_EMAIL=coolshegz@gmail.com
# SUPER_ADMIN_USER_ID=  (optional fallback if email ever changes)
```

- [ ] **Step 13.4:** Commit.

```bash
git add server/.env.example
git commit -m "docs(multitenant): env example for MULTITENANT + SUPER_ADMIN_EMAIL"
```

---

## Task 14: Manual smoke (informational — no checkbox)

These checks are for the operator to run before deploying. Not blocking the implementation plan's completion.

- With `MULTITENANT=false` (default), boot the server, hit `/api/library`, `/api/series`, `/api/social/config`, `/api/render` as super-admin. Behaviour MUST be identical to pre-refactor.
- With `MULTITENANT=true` and `SUPER_ADMIN_EMAIL=coolshegz@gmail.com`, same checks. Behaviour MUST also be identical (super-admin still hits legacy files).
- Optionally create a second user, log in as them, verify their data is empty and lives under `server/data/users/<id>/`.

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — middleware (T4, T5), super-admin resolution (T2, T4), capability matrix (T5, T10, T12), file refactors (T6-T11), index wiring (T12), verification (T13).

**Placeholders:** None — every step has either concrete code or a concrete grep/command.

**Type/name consistency:** `req.ctx.dataDir`, `req.ctx.outputDir`, `req.ctx.plan`, `req.ctx.userId`, `req.ctx.isSuperAdmin` used consistently. `isSuperAdmin` / `getPlanForUser` / `featureGate` / `withUserScope` / `PLAN_CAPABILITIES` / `ensureUserDirs` / `dataDirFor` / `outputDirFor` defined in earlier tasks before being used.

**Out-of-scope deferrals explicit:** Per-user static `/outputs/...` serving deferred with TODO (Task 11.3). Gumroad multi-tenant deferred (gated off, Task 12.3). ElevenLabs free-tier gating in `ttsOrchestrator` if exposed implicitly (Task 10.3).
