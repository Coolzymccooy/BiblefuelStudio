import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carried from slice 2: a series enqueues one campaign_auto_post job per part, so each part is one
// plan render. The whole series used to count as one render (the router-level quota("render")).

const root = fs.mkdtempSync(path.join(os.tmpdir(), "series-quota-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: seriesRouter, _setSeriesDepsForTests } = await import("../../src/routes/series.js");
const { QUOTAS } = await import("../../src/middleware/quota.js");
const { readUsage, incrementUsage } = await import("../../src/lib/usageStore.js");

const enqueued = [];
const VERSES = [1, 2, 3].map((verse) => ({ book: "Psalms", chapter: 23, verse, text: `Verse ${verse} of the psalm, read slowly and with care.` }));
const STUBS = {
  fetchVerses: async () => VERSES,
  // Every test user may start a campaign unless a test says otherwise.
  precondition: () => null,
  enqueue: async (payload) => {
    enqueued.push(payload);
    return { id: `job_${enqueued.length}` };
  },
};
_setSeriesDepsForTests(STUBS);

after(() => {
  _setSeriesDepsForTests(null);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const LIMIT = QUOTAS.free.render;
const BODY = { reference: "Psalm 23:1-3", versesPerPart: 1, durationSec: 30 };

function freeUser(name, used = 0) {
  const dataDir = path.join(root, "users", name);
  fs.mkdirSync(dataDir, { recursive: true });
  if (used) incrementUsage(dataDir, "render", used);
  return { userId: name, dataDir, plan: "free", outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
}

function appFor(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; req.user = { sub: ctx.userId }; next(); });
  app.use("/api/series", seriesRouter);
  return app;
}

test("a preview is free: it builds the plan and spends no render quota", async () => {
  const ctx = freeUser("u_preview", LIMIT);
  const res = await request(appFor(ctx)).post("/api/series/preview").send(BODY);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.plan.totalParts, 3);
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT);
});

test("generating a series spends one plan render per part", async () => {
  const ctx = freeUser("u_generate");
  enqueued.length = 0;
  const res = await request(appFor(ctx)).post("/api/series/generate").send(BODY);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.jobIds.length, 3);
  assert.equal(enqueued.length, 3);
  assert.equal(readUsage(ctx.dataDir).counts.render, 3);
});

test("a series with more parts than the renders left is refused whole: nothing is enqueued or spent", async () => {
  const ctx = freeUser("u_short", LIMIT - 2);
  enqueued.length = 0;
  const res = await request(appFor(ctx)).post("/api/series/generate").send(BODY);
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "QUOTA_EXCEEDED");
  assert.equal(res.body.needed, 3);
  assert.equal(enqueued.length, 0);
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT - 2);
});

test("index.js mounts /api/series without a router-level render quota (the route spends it per part)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(here, "../../index.js"), "utf-8");
  const mount = source.split(/\r?\n/).find((line) => line.startsWith('app.use("/api/series"'));
  assert.ok(mount, "/api/series is mounted");
  assert.doesNotMatch(mount, /quota\(/);
});

test("H1: with the real enqueue, a free user with an empty Library is refused 400 and spends no render", async () => {
  _setSeriesDepsForTests({ fetchVerses: STUBS.fetchVerses });
  try {
    const ctx = freeUser("u_empty_library");
    const res = await request(appFor(ctx)).post("/api/series/generate").send(BODY);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least one background in the Library/);
    assert.equal(readUsage(ctx.dataDir).counts.render, 0);
  } finally {
    _setSeriesDepsForTests(STUBS);
  }
});

test("H1: a failure before the first part is queued gives the series' renders back", async () => {
  _setSeriesDepsForTests({ ...STUBS, enqueue: async () => { throw new Error("queue unavailable"); } });
  try {
    const ctx = freeUser("u_enqueue_fails", 1);
    const res = await request(appFor(ctx)).post("/api/series/generate").send(BODY);
    assert.equal(res.status, 400);
    assert.equal(readUsage(ctx.dataDir).counts.render, 1);
  } finally {
    _setSeriesDepsForTests(STUBS);
  }
});
