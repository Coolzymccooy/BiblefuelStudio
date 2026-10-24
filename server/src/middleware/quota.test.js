import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { quota, QUOTAS, consumeQuota, refundQuota } from "./quota.js";
import { readUsage } from "../lib/usageStore.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "quota-mw-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function appFor(dataDir) {
  const app = express();
  app.use((req, _res, next) => { req.ctx = { dataDir, plan: "free", userId: "u_q" }; next(); });
  app.use(quota("render"));
  app.all("/x", (_req, res) => res.json({ ok: true }));
  return app;
}

function freshDir(name) {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

test("a GET passes without reading or incrementing the bucket", async () => {
  const dir = freshDir("get");
  const app = appFor(dir);
  for (let i = 0; i < QUOTAS.free.render + 3; i++) {
    const res = await request(app).get("/x");
    assert.equal(res.status, 200);
  }
  assert.equal(readUsage(dir).counts.render, 0);
});

test("a HEAD passes without incrementing the bucket", async () => {
  const dir = freshDir("head");
  const res = await request(appFor(dir)).head("/x");
  assert.equal(res.status, 200);
  assert.equal(readUsage(dir).counts.render, 0);
});

test("a POST still increments and 429s at the limit", async () => {
  const dir = freshDir("post");
  const app = appFor(dir);
  for (let i = 0; i < QUOTAS.free.render; i++) {
    const res = await request(app).post("/x");
    assert.equal(res.status, 200);
  }
  assert.equal(readUsage(dir).counts.render, QUOTAS.free.render);
  const over = await request(app).post("/x");
  assert.equal(over.status, 429);
  assert.equal(over.body.error, "QUOTA_EXCEEDED");
  // GETs keep working once the bucket is spent (jobs_wait polls must not 429).
  const poll = await request(app).get("/x");
  assert.equal(poll.status, 200);
});

test("consumeQuota can spend several units at once, all or nothing", () => {
  const dir = freshDir("several");
  const ctx = { dataDir: dir, plan: "free" };
  const limit = QUOTAS.free.render;
  assert.deepEqual(consumeQuota(ctx, "render", limit - 1), { ok: true });
  assert.equal(readUsage(dir).counts.render, limit - 1);
  const refused = consumeQuota(ctx, "render", 2);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "QUOTA_EXCEEDED");
  assert.equal(refused.body.needed, 2);
  assert.equal(readUsage(dir).counts.render, limit - 1);
  assert.deepEqual(consumeQuota(ctx, "render", 1), { ok: true });
  assert.equal(readUsage(dir).counts.render, limit);
});

test("a single unit refusal keeps its old body (no needed field)", () => {
  const dir = freshDir("single");
  const ctx = { dataDir: dir, plan: "free" };
  consumeQuota(ctx, "render", QUOTAS.free.render);
  const refused = consumeQuota(ctx, "render");
  assert.equal(refused.ok, false);
  assert.equal(refused.body.needed, undefined);
});

test("refundQuota gives back what was spent, never below zero, and nothing on unlimited plans", () => {
  const dir = freshDir("refund");
  const ctx = { dataDir: dir, plan: "free" };
  consumeQuota(ctx, "render", 3);
  refundQuota(ctx, "render", 2);
  assert.equal(readUsage(dir).counts.render, 1);
  refundQuota(ctx, "render", 5);
  assert.equal(readUsage(dir).counts.render, 0);
  const premiumDir = freshDir("refund-premium");
  refundQuota({ dataDir: premiumDir, plan: "premium" }, "render", 2);
  assert.equal(readUsage(premiumDir).counts.render, 0);
});

test("refundQuota for another day gives nothing back from today's count", () => {
  const dir = freshDir("refund-other-day");
  const ctx = { dataDir: dir, plan: "free" };
  consumeQuota(ctx, "tts", 1);
  refundQuota(ctx, "tts", 1, { day: "2000-01-01" });
  assert.equal(readUsage(dir).counts.tts, 1);
  refundQuota(ctx, "tts", 1, { day: readUsage(dir).day });
  assert.equal(readUsage(dir).counts.tts, 0);
});

test("a refundOnFailure request charged before midnight and failing after it leaves the new day's count alone", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T23:59:59Z") });
  const dir = freshDir("refund-midnight");
  const app = express();
  app.use((req, _res, next) => { req.ctx = { dataDir: dir, plan: "free", userId: "u_q" }; next(); });
  app.use(quota("tts", { refundOnFailure: true }));
  app.post("/x", (_req, res) => {
    t.mock.timers.setTime(Date.parse("2026-10-25T00:00:05Z"));
    consumeQuota({ dataDir: dir, plan: "free" }, "tts"); // another request, charged on the new day
    res.status(502).json({ ok: false });
  });
  await request(app).post("/x").expect(502);
  const usage = readUsage(dir);
  assert.equal(usage.day, "2026-10-25");
  assert.equal(usage.counts.tts, 1);
});
