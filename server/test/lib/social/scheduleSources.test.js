import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleOwnerCtx, listScheduleSources } from "../../../src/lib/social/scheduleSources.js";
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

import os from "node:os";
import fs from "node:fs";

test("listScheduleSources returns the root owner plus every users/<id> with a social.json", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sched-src-"));
  fs.writeFileSync(path.join(base, "social.json"), JSON.stringify({ schedules: [] }));
  fs.mkdirSync(path.join(base, "users", "u_alice"), { recursive: true });
  fs.writeFileSync(path.join(base, "users", "u_alice", "social.json"), JSON.stringify({ schedules: [] }));
  fs.mkdirSync(path.join(base, "users", "u_bob"), { recursive: true });
  fs.writeFileSync(path.join(base, "users", "u_bob", "social.json"), JSON.stringify({ schedules: [] }));
  fs.mkdirSync(path.join(base, "users", "u_empty"), { recursive: true }); // no social.json → skipped

  const sources = listScheduleSources(base);
  const byId = Object.fromEntries(sources.map((s) => [String(s.ownerId), s]));

  assert.equal(sources.length, 3);
  assert.equal(byId["null"].isSuperAdmin, true);
  assert.equal(byId["u_alice"].isSuperAdmin, false);
  assert.equal(byId["u_bob"].isSuperAdmin, false);
  assert.ok(!("u_empty" in byId));

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
