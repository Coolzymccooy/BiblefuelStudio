// The login secret must be real in production, and a token in a URL only
// opens the one path it was made for.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { jwtSecretProblem, assertJwtSecret, requireAuth, signToken, signUrlToken } from "../../src/auth.js";

const STRONG = "x".repeat(48);

test("production refuses a missing or default secret, and allows a real one", () => {
  assert.match(jwtSecretProblem({ NODE_ENV: "production" }), /JWT_SECRET is not set/);
  assert.match(jwtSecretProblem({ NODE_ENV: "production", JWT_SECRET: "dev_secret_change_me" }), /default/);
  assert.match(jwtSecretProblem({ NODE_ENV: "production", JWT_SECRET: "   " }), /not set/);
  assert.equal(jwtSecretProblem({ NODE_ENV: "production", JWT_SECRET: STRONG }), null);
  assert.equal(jwtSecretProblem({ NODE_ENV: "development" }), null, "a dev machine may use the default");
  assert.throws(() => assertJwtSecret({ NODE_ENV: "production" }), /JWT_SECRET/);
  assert.doesNotThrow(() => assertJwtSecret({ NODE_ENV: "production", JWT_SECRET: STRONG }));
});

function app() {
  const a = express();
  a.get("/api/render/progress/:id", requireAuth, (req, res) => res.json({ sub: req.user.sub, path: req.user.path ?? null }));
  return a;
}
const user = { id: "u1", email: "u1@example.com", role: "user", emailVerified: true };

test("a login token works in the header but never in the URL", async () => {
  const login = signToken(user);
  assert.equal((await request(app()).get("/api/render/progress/1").set("Authorization", `Bearer ${login}`)).status, 200);
  assert.equal((await request(app()).get(`/api/render/progress/1?token=${login}`)).status, 401);
});

test("a URL token opens only its own path, and is not a login", async () => {
  const urlToken = signUrlToken(user, "/api/render/progress/1");
  const ok = await request(app()).get(`/api/render/progress/1?token=${urlToken}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { sub: "u1", path: null }, "the request sees the user, not the token's scope");
  assert.equal((await request(app()).get(`/api/render/progress/2?token=${urlToken}`)).status, 401, "another path is refused");
  assert.equal((await request(app()).get("/api/render/progress/1").set("Authorization", `Bearer ${urlToken}`)).status, 401, "it is not a login token");
});

test("an expired URL token is refused", async () => {
  const urlToken = signUrlToken(user, "/api/render/progress/1", -10);
  assert.equal((await request(app()).get(`/api/render/progress/1?token=${urlToken}`)).status, 401);
});

test("a login token signed for a URL audience with the login key is still refused in the URL", async () => {
  const forged = jwt.sign({ sub: "u1", path: "/api/render/progress/1" }, process.env.JWT_SECRET || "dev_secret_change_me", { audience: "biblefuel-url" });
  assert.equal((await request(app()).get(`/api/render/progress/1?token=${forged}`)).status, 401);
});

test("index.js checks the secret before it builds the app", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../index.js", import.meta.url), "utf8");
  const check = src.indexOf("assertJwtSecret();");
  assert.ok(check > 0, "the check runs at start-up");
  assert.ok(check < src.indexOf("const app = express();"), "before any route exists");
  assert.match(src.slice(check, check + 120), /process\.exit\(1\)/, "a failed check stops the server");
});
