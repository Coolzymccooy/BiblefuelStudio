import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";

// GET /api/admin/agent-activity: the super-admin view of every agent call
// (spec "Activity log"). The admin router is mounted behind requireAuth,
// refuseAgentCalls and requireSuperAdmin in index.js; this file tests the route itself.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-agent-activity-"));
process.env.DATA_DIR = dir;
const activityDir = path.join(dir, "agent-activity");

const activity = await import("../../src/lib/agentKeys/activity.js");
const { createAdminRouter } = await import("../../src/routes/admin.js");

const app = express();
app.use((req, _res, next) => {
  req.ctx = { userId: "u_admin", email: "admin@example.com", isSuperAdmin: true };
  next();
});
app.use("/api/admin", createAdminRouter({}));

function entry(over = {}) {
  return {
    keyId: "k_1",
    keyName: "Hermes",
    userId: "u_1",
    email: "one@example.com",
    tool: "whoami",
    input: {},
    ok: true,
    error: null,
    ms: 10,
    job: null,
    caps: {},
    ...over,
  };
}

function logAt(iso, over) {
  activity._setClock(() => new Date(iso));
  activity.logActivity(entry(over));
}

const get = (query = "") => request(app).get(`/api/admin/agent-activity${query}`);

beforeEach(() => {
  fs.rmSync(activityDir, { recursive: true, force: true });
  activity._setClock(() => new Date("2026-10-24T12:00:00.000Z"));
});

after(() => {
  activity._setClock(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed() {
  logAt("2026-10-10T08:00:00.000Z", { tool: "old_tool" });
  logAt("2026-10-18T08:00:00.000Z", { tool: "render_story" });
  logAt("2026-10-23T08:00:00.000Z", { tool: "render_story", ok: false, error: "MCP_CAP_REACHED: cap" });
  logAt("2026-10-24T09:00:00.000Z", { tool: "whoami", userId: "u_2", email: "two@example.com", keyId: "k_2" });
  activity._setClock(() => new Date("2026-10-24T12:00:00.000Z"));
}

test("defaults to the last 7 days, newest first, with counts and total", async () => {
  seed();
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 3);
  assert.deepEqual(res.body.rows.map((r) => r.tool), ["whoami", "render_story", "render_story"]);
  assert.deepEqual(res.body.counts.byTool, {
    whoami: { calls: 1, errors: 0 },
    render_story: { calls: 2, errors: 1 },
  });
  assert.deepEqual(res.body.counts.byUser, {
    "two@example.com": { calls: 1, errors: 0 },
    "one@example.com": { calls: 2, errors: 1 },
  });
});

test("filters by date range, user, key, tool and outcome", async () => {
  seed();
  const range = await get("?from=2026-10-01&to=2026-10-31");
  assert.equal(range.body.total, 4);

  assert.deepEqual((await get("?userId=u_2")).body.rows.map((r) => r.tool), ["whoami"]);
  assert.deepEqual((await get("?keyId=k_2")).body.rows.map((r) => r.tool), ["whoami"]);
  assert.equal((await get("?tool=render_story")).body.total, 2);

  const failed = await get("?ok=false");
  assert.equal(failed.body.total, 1);
  assert.equal(failed.body.rows[0].error, "MCP_CAP_REACHED: cap");
  assert.deepEqual(failed.body.counts.byTool, { render_story: { calls: 1, errors: 1 } });
  assert.equal((await get("?ok=true")).body.total, 2);
});

test("limit trims the rows but not the counts; default 200, max 1000", async () => {
  for (let i = 0; i < 5; i += 1) logAt(`2026-10-24T0${i}:00:00.000Z`, { tool: "whoami" });
  activity._setClock(() => new Date("2026-10-24T12:00:00.000Z"));
  const res = await get("?limit=2");
  assert.equal(res.body.rows.length, 2);
  assert.equal(res.body.total, 5);
  assert.equal(res.body.counts.byTool.whoami.calls, 5);
  assert.equal((await get("?limit=5000")).body.rows.length, 5);
  assert.equal((await get("?limit=nope")).body.rows.length, 5);
});

test("bad input is a 400 with a hint", async () => {
  const cases = [
    ["?from=2026-13-01", "BAD_DATE"],
    ["?to=yesterday", "BAD_DATE"],
    ["?from=2026-10-20&to=2026-10-01", "BAD_RANGE"],
    ["?from=2026-09-01&to=2026-10-24", "RANGE_TOO_LONG"],
    ["?ok=maybe", "BAD_OK"],
  ];
  for (const [query, code] of cases) {
    const res = await get(query);
    assert.equal(res.status, 400, query);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, code, query);
    assert.equal(typeof res.body.hint, "string");
  }
  // 31 days inclusive is the most allowed.
  assert.equal((await get("?from=2026-09-24&to=2026-10-24")).status, 200);
});

test("format=csv answers the filtered rows as a CSV with formula cells defused", async () => {
  seed();
  logAt("2026-10-24T10:00:00.000Z", { tool: "=cmd", keyName: "@evil", ok: false, error: "-1+1" });
  activity._setClock(() => new Date("2026-10-24T12:00:00.000Z"));
  const res = await get("?format=csv&ok=false");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/csv; charset=utf-8/);
  assert.equal(res.headers["content-disposition"], 'attachment; filename="agent-activity-all.csv"');
  const lines = res.text.trim().split("\n");
  assert.equal(lines[0], "ts,keyId,keyName,userId,email,tool,ok,error,ms,jobKind,jobId");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes(",'@evil,"), lines[1]);
  assert.ok(lines[1].includes(",'=cmd,false,'-1+1,"), lines[1]);
  assert.ok(lines[2].includes(",render_story,false,"), lines[2]);
});
