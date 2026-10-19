import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import socialRouter from "./social.js";

/**
 * The webhooks list says whether TikTok goes straight through Zernio for this
 * caller. Settings used to say TikTok needed Make, so when Make failed the
 * operator could not tell whether TikTok had stopped too. Zernio is
 * operator-only, so a regular user is never told TikTok is handled for them.
 */

const saved = { key: process.env.ZERNIO_API_KEY, account: process.env.ZERNIO_TIKTOK_ACCOUNT_ID };

function app({ isSuperAdmin, isOwner = isSuperAdmin }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-webhooks-"));
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir: dataDir, isSuperAdmin, isOwner }; next(); });
  a.use("/api/social", socialRouter);
  return a;
}

function setZernio(key, account) {
  if (key === undefined) delete process.env.ZERNIO_API_KEY; else process.env.ZERNIO_API_KEY = key;
  if (account === undefined) delete process.env.ZERNIO_TIKTOK_ACCOUNT_ID; else process.env.ZERNIO_TIKTOK_ACCOUNT_ID = account;
}

afterEach(() => setZernio(saved.key, saved.account));

describe("GET /api/social/webhooks tiktokDirect", () => {
  test("true for the operator when Zernio is set up", async () => {
    setZernio("key", "acct");
    const res = await request(app({ isSuperAdmin: true })).get("/api/social/webhooks");
    assert.equal(res.status, 200);
    assert.equal(res.body.tiktokDirect, true);
  });

  test("false for a regular user even when Zernio is set up", async () => {
    setZernio("key", "acct");
    const res = await request(app({ isSuperAdmin: false })).get("/api/social/webhooks");
    assert.equal(res.body.tiktokDirect, false);
  });

  test("false for a super-admin who is not the owner: env Zernio is the owner's TikTok", async () => {
    setZernio("key", "acct");
    const res = await request(app({ isSuperAdmin: true, isOwner: false })).get("/api/social/webhooks");
    assert.equal(res.body.tiktokDirect, false);
    const status = await request(app({ isSuperAdmin: true, isOwner: false })).get("/api/social/auto-publish-status");
    assert.ok(!status.body.destinations.includes("zernio"));
    assert.equal(status.body.isOwner, false);
  });

  test("false for the operator when Zernio is not set up", async () => {
    setZernio("key", " ");
    const res = await request(app({ isSuperAdmin: true })).get("/api/social/webhooks");
    assert.equal(res.body.tiktokDirect, false);
  });
});
