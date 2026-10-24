import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Ruling R27 (#107): the routes that connect, configure or disconnect a
 * social integration are for the person in the app, never for an agent.
 * Agents reach routes with an internal token whose `via` is "mcp"; those get
 * 403 AGENT_FORBIDDEN before the handler runs. A normal session is untouched.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-agent-refusal-"));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = "social-agent-refusal-secret";
for (const name of ["ZERNIO_API_KEY", "ZERNIO_TIKTOK_ACCOUNT_ID", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"]) {
  delete process.env[name];
}

const { requireAuth, signToken, signInternalToken } = await import("../auth.js");
const { default: socialRouter } = await import("./social.js");

const USER = { id: "u_social", email: "social@example.com", role: "user", emailVerified: true };

const app = express();
app.use(express.json());
app.use("/api/social", requireAuth, (req, _res, next) => {
  req.ctx = { userId: USER.id, email: USER.email, dataDir, outputDir: dataDir, isSuperAdmin: false, isOwner: false };
  next();
}, socialRouter);

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// Bodies are the smallest that keep a normal session away from any network call.
const GUARDED = [
  ["post", "/tiktok/own-key", { apiKey: "" }],
  ["get", "/tiktok/own-accounts"],
  ["post", "/tiktok/own-account", { accountId: "a1" }],
  ["post", "/tiktok/own-key/remove"],
  ["post", "/tiktok/connect"],
  ["post", "/tiktok/disconnect"],
  ["post", "/config", {}],
  ["post", "/buffer/profiles", {}],
  ["post", "/webhooks", { name: "" }],
  ["delete", "/webhooks/wh_1"],
  ["post", "/webhooks/wh_1/test"],
  ["get", "/youtube/connect"],
  ["post", "/youtube/disconnect"],
];

function call(method, route, body, token) {
  const req = request(app)[method](`/api/social${route}`).set("Authorization", `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

const agentToken = () =>
  signInternalToken({ sub: USER.id, email: USER.email, role: USER.role, emailVerified: true });

describe("social integration routes refuse agents", () => {
  for (const [method, route, body] of GUARDED) {
    test(`${method.toUpperCase()} ${route}: via mcp gets 403 AGENT_FORBIDDEN`, async () => {
      const res = await call(method, route, body, agentToken());
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, { ok: false, error: "AGENT_FORBIDDEN" });
    });

    test(`${method.toUpperCase()} ${route}: a normal session is not refused`, async () => {
      const res = await call(method, route, body, signToken(USER));
      assert.notEqual(res.body?.error, "AGENT_FORBIDDEN");
      assert.notEqual(res.status, 401);
    });
  }

  test("a read an agent may use still works with via mcp", async () => {
    const res = await call("get", "/youtube/status", undefined, agentToken());
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});
