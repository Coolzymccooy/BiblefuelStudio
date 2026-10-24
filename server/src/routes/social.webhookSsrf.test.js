/**
 * Webhook URLs are user-supplied and the server POSTs to them, so they are
 * vetted on save AND at delivery (DNS can change after saving): loopback,
 * private and metadata addresses are refused, and a public hook may not
 * redirect the POST inward. A fixture on this machine counts every request.
 */
import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import socialRouter, { _setLookupImpl, _resetLookupImpl } from "./social.js";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";

const hits = new Map();
let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    if (req.url === "/bounce") res.writeHead(302, { location: "/inner" }).end();
    else res.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  // No host: listen dual-stack so "localhost" reaches it as ::1 or 127.0.0.1.
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => { _resetLookupImpl(); hits.clear(); });

const saved = { key: process.env.ZERNIO_API_KEY, account: process.env.ZERNIO_TIKTOK_ACCOUNT_ID };
before(() => { delete process.env.ZERNIO_API_KEY; delete process.env.ZERNIO_TIKTOK_ACCOUNT_ID; });
after(() => {
  if (saved.key !== undefined) process.env.ZERNIO_API_KEY = saved.key;
  if (saved.account !== undefined) process.env.ZERNIO_TIKTOK_ACCOUNT_ID = saved.account;
});

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-wh-ssrf-"));
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir: dataDir, isSuperAdmin: false, isOwner: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir };
}

const totalHits = () => [...hits.values()].reduce((n, v) => n + v, 0);
const publicLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("POST /api/social/webhooks vets the URL on save", () => {
  test("private, loopback and metadata URLs are refused with 400 URL_PRIVATE and not stored", async () => {
    const { a, dataDir } = app();
    for (const url of ["http://169.254.169.254/latest/meta-data/", `http://127.0.0.1:${port}/hook`, "http://10.0.0.4/hook", "http://[::1]/hook"]) {
      const res = await request(a).post("/api/social/webhooks").send({ name: "Make", url });
      assert.equal(res.status, 400, url);
      assert.match(res.body.error, /^URL_PRIVATE: /, url);
    }
    assert.deepEqual(readSocialStore(dataDir).webhooks || [], []);
  });

  test("a name that resolves to a private address is refused", async () => {
    const { a } = app();
    _setLookupImpl(async () => ({ address: "172.20.0.3", family: 4 }));
    const res = await request(a).post("/api/social/webhooks").send({ name: "Make", url: "https://hook.internal.example/x" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^URL_PRIVATE: /);
  });

  test("a non-http scheme is refused with 400 URL_SCHEME", async () => {
    const { a } = app();
    const res = await request(a).post("/api/social/webhooks").send({ name: "Make", url: "ftp://hook.example.com/x" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /^URL_SCHEME: /);
  });

  test("a public hook is saved", async () => {
    const { a, dataDir } = app();
    _setLookupImpl(publicLookup);
    const res = await request(a).post("/api/social/webhooks").send({ name: "Make", url: "https://hook.eu1.make.com/abc" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(readSocialStore(dataDir).webhooks[0].url, "https://hook.eu1.make.com/abc");
  });
});

describe("webhook delivery re-vets the URL", () => {
  function storeHook(dataDir, url) {
    writeSocialStore(dataDir, { webhooks: [{ id: "wh1", name: "Make", url, enabled: true }] });
  }

  test("the test endpoint skips a stored private hook with a warning and sends nothing", async (t) => {
    const { a, dataDir } = app();
    storeHook(dataDir, `http://127.0.0.1:${port}/hook`);
    const warn = t.mock.method(console, "warn", () => {});
    const res = await request(a).post("/api/social/webhooks/wh1/test");
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /^URL_PRIVATE: /);
    assert.equal(totalHits(), 0);
    assert.ok(warn.mock.calls.some((c) => /webhook/i.test(String(c.arguments[0]))));
    assert.equal(readSocialStore(dataDir).webhooks[0].failureCount, 1);
  });

  test("posting to a stored private hook is refused and sends nothing", async (t) => {
    const { a, dataDir } = app();
    storeHook(dataDir, `http://127.0.0.1:${port}/hook`);
    t.mock.method(console, "warn", () => {});
    const res = await request(a).post("/api/social/post")
      .send({ destination: "webhook", caption: "hi", videoUrl: "https://cdn.example.com/v.mp4" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /URL_PRIVATE/);
    assert.equal(totalHits(), 0);
  });

  test("posting to a caller-supplied private webhookUrl is refused and sends nothing", async (t) => {
    const { a } = app();
    t.mock.method(console, "warn", () => {});
    const res = await request(a).post("/api/social/post").send({
      destination: "webhook", caption: "hi", videoUrl: "https://cdn.example.com/v.mp4",
      webhookUrl: `http://127.0.0.1:${port}/hook`,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /URL_PRIVATE/);
    assert.equal(totalHits(), 0);
  });

  test("a hook that vets as public may not redirect the POST onward", async () => {
    // The stub lookup calls "localhost" public, so the request reaches the
    // fixture; its 302 must not be followed to /inner.
    const { a, dataDir } = app();
    _setLookupImpl(publicLookup);
    storeHook(dataDir, `http://localhost:${port}/bounce`);
    const res = await request(a).post("/api/social/webhooks/wh1/test");
    assert.equal(res.body.ok, false);
    assert.equal(hits.get("/bounce"), 1);
    assert.equal(hits.get("/inner") || 0, 0);

    const post = await request(a).post("/api/social/post")
      .send({ destination: "webhook", caption: "hi", videoUrl: "https://cdn.example.com/v.mp4" });
    assert.equal(post.status, 400);
    assert.equal(hits.get("/bounce"), 2);
    assert.equal(hits.get("/inner") || 0, 0);
  });
});
