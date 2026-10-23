import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "api-test-secret";

const { createApi, ApiError } = await import("./api.js");

const USER = { sub: "u_1", email: "one@example.com", role: "user", emailVerified: true };
const seen = [];

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  seen.push({ method: req.method, url: req.originalUrl, auth: req.headers.authorization, body: req.body });
  next();
});
app.post("/api/echo", (req, res) => res.json({ ok: true, got: req.body }));
app.get("/api/quota", (_req, res) =>
  res.status(429).json({
    ok: false,
    error: "QUOTA_EXCEEDED",
    bucket: "render",
    hint: "Upgrade to Premium, or come back tomorrow.",
  }),
);
app.get("/api/forbidden", (_req, res) => res.status(403).json({ ok: false, error: "That project is not yours." }));

let server;
let baseUrl;

before(async () => {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
});

test("call sends a 60-second internal token and returns the body", async () => {
  const api = createApi({ user: USER, baseUrl });
  const body = await api.call("POST", "/api/echo", { body: { title: "Psalm 23" }, query: { draft: 1, skip: undefined } });
  assert.deepEqual(body, { ok: true, got: { title: "Psalm 23" } });

  const last = seen.at(-1);
  assert.equal(last.method, "POST");
  assert.equal(last.url, "/api/echo?draft=1");
  assert.match(last.auth, /^Bearer /);
  const claims = jwt.verify(last.auth.slice(7), "api-test-secret");
  assert.equal(claims.sub, "u_1");
  assert.equal(claims.email, "one@example.com");
  assert.equal(claims.via, "mcp");
  assert.equal(claims.emailVerified, true);
  assert.equal(claims.exp - claims.iat, 60);
});

test("QUOTA_EXCEEDED becomes ApiError with code and hint", async () => {
  const api = createApi({ user: USER, baseUrl });
  await assert.rejects(api.call("GET", "/api/quota"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 429);
    assert.equal(err.code, "QUOTA_EXCEEDED");
    assert.equal(err.hint, "Upgrade to Premium, or come back tomorrow.");
    assert.equal(err.message, "Upgrade to Premium, or come back tomorrow.");
    return true;
  });
});

test("an unknown error body becomes HTTP_<status>", async () => {
  const api = createApi({ user: USER, baseUrl });
  await assert.rejects(api.call("GET", "/api/forbidden"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 403);
    assert.equal(err.code, "HTTP_403");
    assert.equal(err.message, "That project is not yours.");
    assert.equal(err.hint, null);
    return true;
  });

  await assert.rejects(api.call("GET", "/api/missing"), (err) => {
    assert.equal(err.code, "HTTP_404");
    assert.equal(err.status, 404);
    return true;
  });
});
