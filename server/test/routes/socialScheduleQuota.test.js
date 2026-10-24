import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// R38: a scheduled auto_generate run makes and renders a fresh video, so it spends one unit of the
// schedule owner's plan render quota, like the Auto-Publish button. Out of quota, the run is skipped
// and a warning logged; nothing is enqueued.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-quota-"));
process.env.DATA_DIR = dataDir;
process.env.OUTPUT_DIR = path.join(dataDir, "outputs");
process.env.JWT_SECRET = "schedule-quota-secret";
fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({ users: [{ id: "u_free", email: "free@example.com", role: "user" }] }));

const { runScheduledPost } = await import("../../src/routes/social.js");
const { incrementUsage, readUsage } = await import("../../src/lib/usageStore.js");
const { scheduleOwnerCtx } = await import("../../src/lib/social/scheduleSources.js");

const freeCtx = scheduleOwnerCtx({ ownerId: "u_free", isSuperAdmin: false });
const rootCtx = scheduleOwnerCtx({ ownerId: null, isSuperAdmin: true });
const SCHEDULE = { id: "s_auto", enabled: true, type: "auto_generate", destination: "webhook" };

let enqueued;
let warnings;
const originalWarn = console.warn;
const deps = {
  enqueueCampaignAutoPost: async (payload, ctx) => {
    enqueued.push({ payload, ctx });
    return { id: "job_auto" };
  },
  dispatchPost: async () => ({ ok: true }),
};

beforeEach(() => {
  enqueued = [];
  warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  fs.rmSync(freeCtx.dataDir, { recursive: true, force: true });
  fs.mkdirSync(freeCtx.dataDir, { recursive: true });
});

after(() => {
  console.warn = originalWarn;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const renderUsed = (dir) => Number(readUsage(dir).counts.render || 0);

test("an auto_generate run spends one of the owner's plan renders and is enqueued", async () => {
  await runScheduledPost(SCHEDULE, freeCtx, deps);
  assert.equal(enqueued.length, 1);
  assert.equal(renderUsed(freeCtx.dataDir), 1);
});

test("an auto_generate run with the owner's renders used up is skipped and logged", async () => {
  incrementUsage(freeCtx.dataDir, "render", 5);
  await runScheduledPost(SCHEDULE, freeCtx, deps);
  assert.deepEqual(enqueued, []);
  assert.equal(renderUsed(freeCtx.dataDir), 5);
  assert.ok(warnings.some((w) => w.includes("s_auto") && /render quota/i.test(w)), warnings.join("\n"));
});

test("the root store's schedules belong to the operator, whose renders are unlimited", async () => {
  incrementUsage(rootCtx.dataDir, "render", 50);
  await runScheduledPost(SCHEDULE, rootCtx, deps);
  assert.equal(enqueued.length, 1);
  assert.equal(renderUsed(rootCtx.dataDir), 50);
});

test("a replay run spends no render quota", async () => {
  incrementUsage(freeCtx.dataDir, "render", 5);
  const replay = { id: "s_replay", enabled: true, type: "replay", destination: "webhook", caption: "c", videoUrl: "http://x/v.mp4" };
  let dispatched = 0;
  await runScheduledPost(replay, freeCtx, { ...deps, dispatchPost: async () => { dispatched += 1; return { ok: true }; } });
  assert.equal(dispatched, 1);
  assert.equal(renderUsed(freeCtx.dataDir), 5);
});
