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
