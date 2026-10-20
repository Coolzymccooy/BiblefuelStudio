import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * GET /config handed every signed-in user the operator's env
 * YOUTUBE_CLIENT_SECRET, because readSocialStore fills it into every store.
 */

const OPERATOR_SECRET = "operator-oauth-client-secret";
process.env.YOUTUBE_CLIENT_ID = "operator-client-id";
process.env.YOUTUBE_CLIENT_SECRET = OPERATOR_SECRET;

const socialRouter = (await import("./social.js")).default;
const { readSocialStore, writeSocialStore } = await import("../lib/socialStore.js");

const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_SECRET;
});

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-secrets-"));
  roots.push(dataDir);
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "regular-user", dataDir, outputDir: dataDir, isSuperAdmin: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir };
}

describe("GET /config never sends secrets", () => {
  test("a regular user does not receive the operator's YouTube client secret", async () => {
    const { a } = app();
    const res = await request(a).get("/api/social/config").expect(200);
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(OPERATOR_SECRET));
    assert.equal(res.body.direct.youtube.hasClientSecret, true);
  });

  test("the user's own tokens are not sent back either", async () => {
    const { a, dataDir } = app();
    writeSocialStore(dataDir, { ...readSocialStore(dataDir), direct: { youtube: { refreshToken: "my-refresh-token" }, instagram: { accessToken: "my-ig-token", userId: "me" }, tiktok: {} } });
    const res = await request(a).get("/api/social/config").expect(200);
    assert.doesNotMatch(JSON.stringify(res.body), /my-refresh-token|my-ig-token/);
    assert.equal(res.body.direct.youtube.hasRefreshToken, true);
    assert.equal(res.body.direct.instagram.userId, "me");
  });
});

describe("POST /config keeps secrets the page never had", () => {
  test("Save all with blank secrets keeps the stored ones", async () => {
    const { a, dataDir } = app();
    writeSocialStore(dataDir, { ...readSocialStore(dataDir), direct: { youtube: { refreshToken: "my-refresh-token", channelTitle: "Mine" }, instagram: { accessToken: "my-ig-token", userId: "me" }, tiktok: {} } });
    await request(a).post("/api/social/config").send({
      webhooks: [], schedules: [],
      direct: { youtube: { clientId: "", clientSecret: "", refreshToken: "" }, instagram: { accessToken: "", userId: "me" }, tiktok: { accessToken: "", openId: "" } },
    }).expect(200);
    const after = readSocialStore(dataDir).direct;
    assert.equal(after.youtube.refreshToken, "my-refresh-token");
    assert.equal(after.youtube.channelTitle, "Mine");
    assert.equal(after.instagram.accessToken, "my-ig-token");
  });

  test("a secret typed into the page is saved", async () => {
    const { a, dataDir } = app();
    await request(a).post("/api/social/config").send({ webhooks: [], schedules: [], direct: { instagram: { accessToken: "new-ig-token", userId: "me" } } }).expect(200);
    assert.equal(readSocialStore(dataDir).direct.instagram.accessToken, "new-ig-token");
  });
});
