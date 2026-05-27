import { test } from "node:test";
import assert from "node:assert/strict";
import { isJobVisibleTo } from "../../src/routes/jobs.js";

const alice = { userId: "u_alice", isSuperAdmin: false };
const bob = { userId: "u_bob", isSuperAdmin: false };
const admin = { userId: "u_admin", isSuperAdmin: true };

test("isJobVisibleTo: owner sees their own job", () => {
  const job = { id: "j1", ownerId: "u_alice" };
  assert.equal(isJobVisibleTo(job, alice), true);
});

test("isJobVisibleTo: non-owner does NOT see another user's job (regression: jobs.json data leak)", () => {
  const job = { id: "j1", ownerId: "u_alice" };
  assert.equal(isJobVisibleTo(job, bob), false);
});

test("isJobVisibleTo: super-admin sees every job", () => {
  assert.equal(isJobVisibleTo({ id: "j1", ownerId: "u_alice" }, admin), true);
  assert.equal(isJobVisibleTo({ id: "j2", ownerId: "u_bob" }, admin), true);
});

test("isJobVisibleTo: legacy job (no ownerId) is super-admin-only", () => {
  const legacy = { id: "j1" };
  assert.equal(isJobVisibleTo(legacy, alice), false);
  assert.equal(isJobVisibleTo(legacy, bob), false);
  assert.equal(isJobVisibleTo(legacy, admin), true);
});

test("isJobVisibleTo: falls back to job.ctx.userId when ownerId missing", () => {
  // Defensive: older code paths set ctx.userId but not ownerId. Honour both.
  const job = { id: "j1", ctx: { userId: "u_alice" } };
  assert.equal(isJobVisibleTo(job, alice), true);
  assert.equal(isJobVisibleTo(job, bob), false);
});

test("isJobVisibleTo: null/undefined inputs are safe", () => {
  assert.equal(isJobVisibleTo(null, alice), false);
  assert.equal(isJobVisibleTo(undefined, alice), false);
  assert.equal(isJobVisibleTo({ ownerId: "u_alice" }, null), false);
  assert.equal(isJobVisibleTo({ ownerId: "u_alice" }, undefined), false);
});
