import { test, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-auth-"));
process.env.DATA_DIR = dir;

const USERS = [
  { id: "u_1", email: "one@example.com", role: "user", emailVerified: true },
  { id: "u_2", email: "two@example.com", role: "admin", emailVerified: false },
];
const usersFile = path.join(dir, "users.json");
const keysFile = path.join(dir, "agent-keys.json");

const store = await import("../lib/agentKeys/store.js");
const auth = await import("../auth.js");
const { requireAgentKeyOrJwt, refuseAgentCalls } = await import("./agentAuth.js");

const app = express();
app.get("/p", requireAgentKeyOrJwt, (req, res) => res.json({ user: req.user, key: req.agentKey }));
app.delete("/me", auth.requireAuth, refuseAgentCalls, (_req, res) => res.json({ ok: true }));
app.delete("/anon", refuseAgentCalls, (_req, res) => res.json({ ok: true }));
app.delete("/agent-me", requireAgentKeyOrJwt, refuseAgentCalls, (_req, res) => res.json({ ok: true }));
app.get("/app-only", auth.requireAuth, (_req, res) => res.json({ ok: true }));

beforeEach(() => {
  fs.writeFileSync(usersFile, JSON.stringify({ users: USERS }, null, 2));
  fs.rmSync(keysFile, { force: true });
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a live agent key authenticates and exposes the public key record", async () => {
  const { key, plain } = store.createKey("u_2", "Claude Desktop");
  const res = await request(app).get("/p").set("Authorization", `Bearer ${plain}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, {
    sub: "u_2",
    email: "two@example.com",
    role: "admin",
    emailVerified: false,
    via: "agent-key",
  });
  assert.equal(res.body.key.id, key.id);
  assert.equal(res.body.key.userId, "u_2");
  assert.equal("hash" in res.body.key, false);
});

test("a revoked key is 401 AGENT_KEY_INVALID", async () => {
  const { key, plain } = store.createKey("u_1", "Old");
  assert.equal(store.revokeKey("u_1", key.id), true);
  const res = await request(app).get("/p").set("Authorization", `Bearer ${plain}`);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "AGENT_KEY_INVALID" });
});

test("an unknown bfk_ key is 401 AGENT_KEY_INVALID", async () => {
  const res = await request(app).get("/p").set("Authorization", "Bearer bfk_nope");
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "AGENT_KEY_INVALID" });
});

test("a corrupt key store fails closed with 401 AGENT_KEY_INVALID", async () => {
  const { plain } = store.createKey("u_1", "Good");
  fs.writeFileSync(keysFile, "{ not json");
  const warn = mock.method(console, "warn", () => {});
  let res;
  try {
    res = await request(app).get("/p").set("Authorization", `Bearer ${plain}`);
  } finally {
    warn.mock.restore();
  }
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], "[MCP] key lookup failed:");
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "AGENT_KEY_INVALID" });
});

test("an app JWT authenticates with agentKey null", async () => {
  const token = auth.signToken({ id: "u_1", email: "one@example.com", role: "user", emailVerified: true });
  const res = await request(app).get("/p").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.sub, "u_1");
  assert.equal(res.body.key, null);
});

test("a bad JWT is 401 Invalid token", async () => {
  const res = await request(app).get("/p").set("Authorization", "Bearer not.a.jwt");
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "Invalid token" });
});

test("a missing header is 401 Missing Bearer token", async () => {
  const res = await request(app).get("/p");
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "Missing Bearer token" });
});

test("query token is refused", async () => {
  const token = auth.signToken({ id: "u_1", email: "one@example.com", role: "user" });
  const res = await request(app).get(`/p?token=${token}`);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "Missing Bearer token" });
});

test("an internal token is refused by refuseAgentCalls on DELETE /me", async () => {
  const user = { id: "u_1", email: "one@example.com", role: "user", emailVerified: true };
  const internal = auth.signInternalToken({ sub: user.id, email: user.email, role: user.role, emailVerified: true });
  const refused = await request(app).delete("/me").set("Authorization", `Bearer ${internal}`);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, { ok: false, error: "AGENT_FORBIDDEN" });

  const normal = await request(app).delete("/me").set("Authorization", `Bearer ${auth.signToken(user)}`);
  assert.equal(normal.status, 200);
});

test("refuseAgentCalls passes through when req.user is absent", async () => {
  const res = await request(app).delete("/anon");
  assert.equal(res.status, 200);
});

test("signInternalToken expires in 60 seconds and carries via=mcp", () => {
  const token = auth.signInternalToken({ sub: "u_1", email: "one@example.com", role: "user", emailVerified: true });
  const decoded = jwt.decode(token);
  assert.equal(decoded.exp - decoded.iat, 60);
  assert.equal(decoded.via, "mcp");
  assert.equal(decoded.sub, "u_1");
  assert.equal(decoded.email, "one@example.com");
  assert.equal(decoded.role, "user");
  assert.equal(decoded.emailVerified, true);
});

test("an internal (via) token is refused at the MCP auth with 401 AGENT_KEY_INVALID", async () => {
  const internal = auth.signInternalToken({ sub: "u_1", email: "one@example.com", role: "user", emailVerified: true });
  const res = await request(app).get("/p").set("Authorization", `Bearer ${internal}`);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { ok: false, error: "AGENT_KEY_INVALID", message: "Invalid token" });
});

test("refuseAgentCalls refuses a request authenticated by an agent key", async () => {
  const { plain } = store.createKey("u_1", "Refused");
  const res = await request(app).delete("/agent-me").set("Authorization", `Bearer ${plain}`);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { ok: false, error: "AGENT_FORBIDDEN" });
});

test("requireAuth refuses a bfk_ agent key bearer", async () => {
  const { plain } = store.createKey("u_1", "Not a login");
  const res = await request(app).get("/app-only").set("Authorization", `Bearer ${plain}`);
  assert.equal(res.status, 401);
});
