import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { quota, QUOTAS } from "./quota.js";
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
