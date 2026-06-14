# Per-User Cron Schedule Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the social auto-publish cron scheduler load and run *every* tenant's schedules under that tenant's own scope, so a regular user's scheduled posts actually fire AND render/publish into their own dirs/webhooks — never the operator's.

**Architecture:** Today `refreshScheduleTasks()` reads only the super-admin root `social.json` and `runScheduledPost()` runs with no ctx (falling back to global `DATA_DIR`/`OUTPUT_DIR` + the operator's webhooks). We add (1) a pure helper that derives an execution ctx for a schedule's owner, (2) a filesystem walk that enumerates the root store **plus** every `users/<id>/social.json`, (3) ctx threading through `runScheduledPost` into `enqueueCampaignAutoPost` and `dispatchPost`, and (4) re-keying `scheduleTasks` by `${ownerKey}::${schedule.id}` so tenants' schedule ids never collide. Ownership is determined by **which directory** a store was loaded from, not by matching the schedule against a user — the root store is the super-admin's by location.

**Tech Stack:** Node 24 ESM, `node:test` + `node:assert/strict`, `node-cron`, existing `paths.js` helpers (`DATA_DIR`, `OUTPUT_DIR`, `dataDirFor`, `outputDirFor`), `isSuperAdmin` from `userPlan.js`.

**Spec:** `docs/superpowers/specs/2026-05-26-public-multitenancy-design.md` §6 (Cron / Schedule Isolation) and §7 (the "cron schedules collide across users" risk → key includes userId).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `server/src/lib/social/scheduleSources.js` | **New.** Pure-ish module: derive a per-owner execution ctx (`scheduleOwnerCtx`) and enumerate every schedule source dir (`listScheduleSources`). No `node-cron`, no Express — just fs + path helpers, so it's unit-testable with a temp dir. | Create |
| `server/test/lib/social/scheduleSources.test.js` | Tests for the two pure functions above. | Create |
| `server/src/routes/social.js` | Thread owner ctx through `runScheduledPost`; rewrite `refreshScheduleTasks` to walk all sources and key tasks by owner; de-gate the post-write refresh so regular users' edits re-register. | Modify (`runScheduledPost` ~430-480, `refreshScheduleTasks` ~489-526, `POST /schedules` ~671) |
| `server/test/routes/socialScheduleIsolation.test.js` | Tests that `runScheduledPost` passes the owner ctx to the enqueue/dispatch seam. | Create |

The walk and ctx derivation live in their own module (not in the 900-line `social.js`) so they can be tested without standing up cron timers or Express.

---

### Task 1: Per-owner execution ctx (pure)

**Files:**
- Create: `server/src/lib/social/scheduleSources.js`
- Test: `server/test/lib/social/scheduleSources.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleOwnerCtx } from "../../../src/lib/social/scheduleSources.js";
import { DATA_DIR, OUTPUT_DIR } from "../../../src/lib/paths.js";
import path from "node:path";

test("root owner (super-admin) gets the global dirs and isSuperAdmin=true", () => {
  const ctx = scheduleOwnerCtx({ ownerId: null, isSuperAdmin: true });
  assert.equal(ctx.dataDir, DATA_DIR);
  assert.equal(ctx.outputDir, OUTPUT_DIR);
  assert.equal(ctx.isSuperAdmin, true);
  assert.equal(ctx.userId, null);
});

test("a regular owner gets their per-user dirs and isSuperAdmin=false", () => {
  const ctx = scheduleOwnerCtx({ ownerId: "u_alice", isSuperAdmin: false });
  assert.equal(ctx.userId, "u_alice");
  assert.equal(ctx.dataDir, path.join(DATA_DIR, "users", "u_alice"));
  assert.equal(ctx.outputDir, path.join(DATA_DIR, "users", "u_alice", "outputs"));
  assert.equal(ctx.isSuperAdmin, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/lib/social/scheduleSources.test.js`
Expected: FAIL — `does not provide an export named 'scheduleOwnerCtx'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/lib/social/scheduleSources.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, OUTPUT_DIR, dataDirFor, outputDirFor } from "../paths.js";

/**
 * Execution ctx for a schedule's owner. Ownership is by LOCATION: the root
 * store belongs to the super-admin (global dirs); every users/<id>/ store
 * belongs to that tenant (per-user dirs, never super-admin).
 *
 * @param {{ ownerId: string|null, isSuperAdmin: boolean }} owner
 * @returns {{ userId: string|null, dataDir: string, outputDir: string, isSuperAdmin: boolean }}
 */
export function scheduleOwnerCtx(owner) {
  if (owner?.isSuperAdmin) {
    return { userId: owner.ownerId ?? null, dataDir: DATA_DIR, outputDir: OUTPUT_DIR, isSuperAdmin: true };
  }
  const user = { sub: String(owner?.ownerId || "") };
  return {
    userId: user.sub,
    dataDir: dataDirFor(user),
    outputDir: outputDirFor(user),
    isSuperAdmin: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/lib/social/scheduleSources.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/social/scheduleSources.js server/test/lib/social/scheduleSources.test.js
git commit -m "feat(social): pure scheduleOwnerCtx for per-owner cron scope"
```

---

### Task 2: Enumerate every schedule source dir

**Files:**
- Modify: `server/src/lib/social/scheduleSources.js`
- Test: `server/test/lib/social/scheduleSources.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
import os from "node:os";

test("listScheduleSources returns the root owner plus every users/<id> with a social.json", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sched-src-"));
  // root social.json (super-admin)
  fs.writeFileSync(path.join(base, "social.json"), JSON.stringify({ schedules: [] }));
  // two per-user stores
  fs.mkdirSync(path.join(base, "users", "u_alice"), { recursive: true });
  fs.writeFileSync(path.join(base, "users", "u_alice", "social.json"), JSON.stringify({ schedules: [] }));
  fs.mkdirSync(path.join(base, "users", "u_bob"), { recursive: true });
  fs.writeFileSync(path.join(base, "users", "u_bob", "social.json"), JSON.stringify({ schedules: [] }));
  // a user dir WITHOUT a social.json — must be skipped
  fs.mkdirSync(path.join(base, "users", "u_empty"), { recursive: true });

  const sources = listScheduleSources(base);
  const byId = Object.fromEntries(sources.map((s) => [String(s.ownerId), s]));

  assert.equal(sources.length, 3);
  assert.equal(byId["null"].isSuperAdmin, true);      // root owner keyed by ownerId null
  assert.equal(byId["u_alice"].isSuperAdmin, false);
  assert.equal(byId["u_bob"].isSuperAdmin, false);
  assert.ok(!("u_empty" in byId));                     // no social.json → not a source

  fs.rmSync(base, { recursive: true, force: true });
});

test("listScheduleSources tolerates a missing users/ dir (only root)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sched-src-"));
  fs.writeFileSync(path.join(base, "social.json"), JSON.stringify({ schedules: [] }));
  const sources = listScheduleSources(base);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ownerId, null);
  fs.rmSync(base, { recursive: true, force: true });
});
```

Add `listScheduleSources` to the existing import line:
```js
import { scheduleOwnerCtx, listScheduleSources } from "../../../src/lib/social/scheduleSources.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/lib/social/scheduleSources.test.js`
Expected: FAIL — `listScheduleSources is not a function` / `not provide an export`.

- [ ] **Step 3: Write minimal implementation** (append to `scheduleSources.js`)

```js
/**
 * Enumerate every schedule-source directory: the root store (super-admin)
 * plus each users/<id>/ that has a social.json. Returns owner descriptors —
 * NOT ctx — so the caller decides when to derive dirs via scheduleOwnerCtx.
 *
 * @param {string} [baseDir] defaults to DATA_DIR; injectable for tests.
 * @returns {Array<{ ownerId: string|null, isSuperAdmin: boolean }>}
 */
export function listScheduleSources(baseDir = DATA_DIR) {
  const sources = [];
  // Root store is always a (potential) source and belongs to the super-admin.
  if (fs.existsSync(path.join(baseDir, "social.json"))) {
    sources.push({ ownerId: null, isSuperAdmin: true });
  }
  const usersDir = path.join(baseDir, "users");
  let entries = [];
  try {
    entries = fs.readdirSync(usersDir, { withFileTypes: true });
  } catch {
    return sources; // no users/ dir yet
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const storePath = path.join(usersDir, ent.name, "social.json");
    if (fs.existsSync(storePath)) {
      sources.push({ ownerId: ent.name, isSuperAdmin: false });
    }
  }
  return sources;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/lib/social/scheduleSources.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/social/scheduleSources.js server/test/lib/social/scheduleSources.test.js
git commit -m "feat(social): enumerate root + per-user schedule sources"
```

---

### Task 3: Thread owner ctx through `runScheduledPost`

**Files:**
- Modify: `server/src/routes/social.js` (`runScheduledPost`, ~lines 430-480)
- Test: `server/test/routes/socialScheduleIsolation.test.js`

**Context:** `runScheduledPost(schedule)` currently (a) calls `enqueueCampaignAutoPost(payload)` with no second arg, and (b) builds `reqLike` with no `.ctx` for `dispatchPost`. We add a `ctx` parameter (the object from `scheduleOwnerCtx`) and pass it both places. To make this testable without real cron/fs, we export `runScheduledPost` and inject the enqueue + dispatch functions via an optional `deps` arg (default = the real ones).

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScheduledPost } from "../../src/routes/social.js";

const aliceCtx = { userId: "u_alice", dataDir: "/data/users/u_alice", outputDir: "/data/users/u_alice/outputs", isSuperAdmin: false };

test("auto_generate schedule enqueues with the owner's ctx", async () => {
  let seenCtx = null;
  const deps = {
    enqueueCampaignAutoPost: async (_payload, ctx) => { seenCtx = ctx; return { id: "job_x" }; },
    dispatchPost: async () => ({ ok: true }),
  };
  const schedule = { id: "s1", enabled: true, type: "auto_generate", destination: "webhook" };
  await runScheduledPost(schedule, aliceCtx, deps);
  assert.deepEqual(seenCtx, aliceCtx);
});

test("replay schedule dispatches with a reqLike carrying the owner's ctx", async () => {
  let seenReq = null;
  const deps = {
    enqueueCampaignAutoPost: async () => ({ id: "n/a" }),
    dispatchPost: async (_payload, req) => { seenReq = req; return { ok: true }; },
  };
  const schedule = { id: "s2", enabled: true, type: "replay", destination: "webhook", caption: "hi", videoUrl: "http://x/v.mp4" };
  await runScheduledPost(schedule, aliceCtx, deps);
  assert.equal(seenReq.ctx.dataDir, "/data/users/u_alice");
  assert.equal(seenReq.ctx.userId, "u_alice");
});

test("a disabled schedule does nothing", async () => {
  let called = false;
  const deps = {
    enqueueCampaignAutoPost: async () => { called = true; },
    dispatchPost: async () => { called = true; },
  };
  await runScheduledPost({ id: "s3", enabled: false, type: "replay" }, aliceCtx, deps);
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/routes/socialScheduleIsolation.test.js`
Expected: FAIL — `runScheduledPost` is not exported / wrong arity (ctx ignored).

- [ ] **Step 3: Write minimal implementation**

In `server/src/routes/social.js`, change the signature and body of `runScheduledPost`. Replace the existing `async function runScheduledPost(schedule) {` declaration and its two call sites:

```js
export async function runScheduledPost(schedule, ctx, deps = {}) {
  const enqueue = deps.enqueueCampaignAutoPost
    || (await import("./jobs.js")).enqueueCampaignAutoPost;
  const dispatch = deps.dispatchPost || dispatchPost;
  try {
    if (!schedule?.enabled) return;

    if (String(schedule.type || "replay") === "auto_generate") {
      const job = await enqueue({
        destination: schedule.destination || "webhook",
        webhookId: schedule.webhookId || undefined,
        profileIds: schedule.profileId ? [schedule.profileId] : undefined,
        title: schedule.name,
        privacyStatus: schedule.privacyStatus,
        niche: schedule.niche,
        tone: schedule.tone,
        ctaStyle: schedule.ctaStyle,
        aspect: schedule.aspect,
        durationSec: schedule.durationSec,
        voiceId: schedule.voiceId,
        backgroundQuery: schedule.backgroundQuery,
      }, ctx);
      console.log(`[SOCIAL][CRON] Schedule ${schedule.id} enqueued auto_generate job ${job?.id} (owner=${ctx?.userId ?? "root"})`);
      return;
    }

    const payload = {
      destination: schedule.destination,
      caption: schedule.caption,
      videoUrl: schedule.videoUrl,
      webhookId: schedule.webhookId || undefined,
      profileIds: schedule.profileId ? [schedule.profileId] : undefined,
      title: schedule.name,
      privacyStatus: schedule.privacyStatus,
    };
    const reqLike = { headers: {}, protocol: "https", get: () => "", ctx };
    const result = await dispatch(payload, reqLike);
    console.log(`[SOCIAL][CRON] Schedule ${schedule.id} posted (owner=${ctx?.userId ?? "root"})`, {
      destination: schedule.destination,
      videoUrl: result?.videoUrl || "",
    });
  } catch (e) {
    console.warn(`[SOCIAL][CRON] Schedule ${schedule?.id || "<unknown>"} failed:`, e?.message || e);
  }
}
```

(Removes the old top-of-function `const { enqueueCampaignAutoPost } = await import("./jobs.js");` since `enqueue` now covers it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/routes/socialScheduleIsolation.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/social.js server/test/routes/socialScheduleIsolation.test.js
git commit -m "feat(social): thread owner ctx through runScheduledPost"
```

---

### Task 4: Walk all sources in `refreshScheduleTasks` + re-key by owner + de-gate refresh

**Files:**
- Modify: `server/src/routes/social.js` (`refreshScheduleTasks` ~489-526; `POST /schedules` line ~671)

**Context:** `refreshScheduleTasks` reads only the root store and keys tasks by `schedule.id`. Rewrite it to walk `listScheduleSources()`, and for each source read that store and register each schedule under `${ownerKey}::${schedule.id}` (ownerKey = `ownerId ?? "__root__"`), running it with the owner's ctx. Also remove the `if (req.ctx.isSuperAdmin)` gate on the post-write refresh so a regular user's schedule edit re-registers their tasks. This task is integration glue over already-tested units; verify via the full suite + the manual smoke below.

- [ ] **Step 1: Add imports** at the top of `social.js` (near the other `../lib/...` imports):

```js
import { scheduleOwnerCtx, listScheduleSources } from "../lib/social/scheduleSources.js";
import { readSocialStore as readSocialStoreForDir } from "../lib/socialStore.js"; // if not already imported; reuse existing readSocialStore otherwise
```

(If `readSocialStore` is already imported in this file, skip the alias and use the existing binding — do NOT add a duplicate import.)

- [ ] **Step 2: Replace `refreshScheduleTasks`** with the multi-source walk:

```js
function refreshScheduleTasks() {
  const activeKeys = new Set();

  for (const source of listScheduleSources()) {
    const ctx = scheduleOwnerCtx(source);
    const ownerKey = source.ownerId ?? "__root__";
    const store = readSocialStore(ctx.dataDir);
    const schedules = Array.isArray(store.schedules) ? store.schedules : [];

    for (const s of schedules) {
      const sid = String(s.id || "").trim();
      if (!sid) continue;
      const key = `${ownerKey}::${sid}`;
      activeKeys.add(key);

      const sig = scheduleSignature(s);
      const existing = scheduleTasks.get(key);
      if (existing && existing.signature === sig) continue;
      if (existing) stopScheduleTask(key);

      if (!s.enabled) continue;
      if (!s.cron || !cron.validate(s.cron)) {
        console.warn(`[SOCIAL][CRON] Invalid cron for schedule ${key}: ${s.cron}`);
        continue;
      }

      const task = cron.schedule(
        s.cron,
        async () => { await runScheduledPost(s, ctx); },
        { timezone: s.timezone || "UTC" }
      );
      scheduleTasks.set(key, { task, signature: sig });
      console.log(`[SOCIAL][CRON] Scheduled ${key} (${s.name}) at "${s.cron}" tz=${s.timezone || "UTC"} owner=${ctx.userId ?? "root"}`);
    }
  }

  for (const [key] of scheduleTasks) {
    if (!activeKeys.has(key)) stopScheduleTask(key);
  }
}
```

`stopScheduleTask(key)` already takes the map key — no change needed there; it now receives the composite key.

- [ ] **Step 3: De-gate the post-write refresh.** In `POST /schedules`, change:

```js
    if (req.ctx.isSuperAdmin) refreshScheduleTasks();
```
to:
```js
    refreshScheduleTasks();
```

Also de-gate the same call in `DELETE /schedules/:id` if it is similarly gated (grep `refreshScheduleTasks(` in the file and ensure every schedule-mutating route calls it unconditionally).

- [ ] **Step 4: Run the full server suite**

Run: `cd server && npm test`
Expected: all pass (existing 532 + the new Task 1–3 tests). No test asserts the old single-source behaviour (the old `refreshScheduleTasks` had no test), so nothing should regress.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/social.js
git commit -m "feat(social): per-user cron walk keyed by owner; de-gate refresh"
```

---

### Task 5: Verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full server suite**

Run: `cd server && npm test`
Expected: `pass` count = previous total + 9 new (Task1: 2, Task2: 2, Task3: 3, plus the existing 2 ctx tests already there), `fail 0`.

- [ ] **Step 2: Isolation grep (spec §7 guard)**

Run: `cd server && grep -n "readSocialStore(DATA_DIR)" src/routes/social.js`
Expected: zero hits in `refreshScheduleTasks` (the walk now uses each owner's `ctx.dataDir`). A remaining hit elsewhere (e.g. an unrelated super-admin-only status route) is acceptable only if that route is super-admin scoped.

- [ ] **Step 3: Manual smoke (operator account)**

Start the server. Create a `replay` schedule as the super-admin with a near-future cron. Confirm the log line `Scheduled __root__::<id> ... owner=root` appears and the post fires into the super-admin store as before — i.e. zero behaviour change for the operator.

- [ ] **Step 4: Manual smoke (regular tenant)** _(if a non-admin test account exists)_

As a non-admin user, create an `auto_generate` schedule. Confirm `Scheduled <userId>::<id> ... owner=<userId>` is logged and the produced job's `ownerId` equals that user (visible in their Jobs, not the operator's) and renders under `users/<id>/outputs/`.

---

## Self-Review

**1. Spec coverage (§6):**
- "Map key becomes `${userId}::${schedule.id}`" → Task 4 keys by `${ownerKey}::${sid}` (ownerKey = userId or `__root__` for the operator). ✓
- "Walk every user dir's social.json and re-register" → Task 2 `listScheduleSources` + Task 4 walk. ✓
- "When a user is deleted, stop their tasks" → out of scope (Phase 5 deletion); the `activeKeys` sweep already removes tasks whose source/schedule disappears, which covers the practical case. Noted, not implemented as a deletion hook. ✓ (documented gap)

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step is concrete. ✓

**3. Type consistency:**
- `scheduleOwnerCtx(owner)` returns `{ userId, dataDir, outputDir, isSuperAdmin }`; consumed by `runScheduledPost(schedule, ctx, deps)` and passed to `enqueueCampaignAutoPost(payload, ctx)` (matches the `{ dataDir, outputDir, userId, isSuperAdmin }` shape that `buildCampaignJob` normalizes). ✓
- `listScheduleSources()` returns `{ ownerId, isSuperAdmin }` descriptors; `scheduleOwnerCtx` consumes exactly that shape. ✓
- `reqLike.ctx` carries `dataDir`/`userId`/`isSuperAdmin`; `dispatchPost` reads `req?.ctx?.dataDir`. ✓

**Open dependency:** Task 4 Step 1 assumes `readSocialStore` is already imported in `social.js` (it is — used throughout). The aliased import line is a fallback; remove it if the binding exists. Verified `readSocialStore` is in scope at the existing call sites (e.g. line 493, 551).
