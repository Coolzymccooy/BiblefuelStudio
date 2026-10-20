import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isOwnerCtx, DATA_DIR } from "../../src/lib/paths.js";
import { scheduleOwnerCtx } from "../../src/lib/social/scheduleSources.js";

// The operator's own integrations (env Zernio → the operator's TikTok, every
// job in jobs.json) belong to the owner, not to every super-admin.

test("isOwnerCtx: an explicit isOwner wins", () => {
  assert.equal(isOwnerCtx({ isOwner: true, isSuperAdmin: true, dataDir: DATA_DIR }), true);
  assert.equal(isOwnerCtx({ isOwner: false, isSuperAdmin: true, dataDir: DATA_DIR }), false);
});

test("isOwnerCtx: a job saved before isOwner existed is the owner's only when it ran in the main workspace", () => {
  assert.equal(isOwnerCtx({ isSuperAdmin: true, dataDir: DATA_DIR }), true);
  assert.equal(isOwnerCtx({ isSuperAdmin: true, dataDir: path.join(DATA_DIR, "users", "u_other") }), false);
  assert.equal(isOwnerCtx({ isSuperAdmin: false, dataDir: DATA_DIR }), false);
});

test("isOwnerCtx: a missing ctx is never the owner", () => {
  assert.equal(isOwnerCtx(null), false);
  assert.equal(isOwnerCtx(undefined), false);
  assert.equal(isOwnerCtx({}), false);
});

test("scheduleOwnerCtx: the root store's schedules run as the owner; a user folder's never do", () => {
  assert.equal(scheduleOwnerCtx({ ownerId: null, isSuperAdmin: true }).isOwner, true);
  assert.equal(scheduleOwnerCtx({ ownerId: "u_other", isSuperAdmin: false }).isOwner, false);
});
