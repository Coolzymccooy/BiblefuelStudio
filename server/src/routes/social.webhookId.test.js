import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { dispatchPost, runScheduledPost, _setLookupImpl, _setUnvettedHostsForTests, _resetLookupImpl } from "./social.js";
import { writeSocialStore } from "../lib/socialStore.js";

// R40: a post that names a webhook (schedule runs, campaign retries, publish_post) goes to that
// webhook only. When it is disabled or removed the post fails; it never falls back to another
// of the user's webhooks. The first enabled webhook is used only when no webhookId was given.

const received = [];
let server;
let hookUrl;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-webhook-id-"));
const ctx = { userId: "u_hooks", dataDir, outputDir: dataDir, isSuperAdmin: false, isOwner: false };
const reqLike = { headers: {}, protocol: "https", get: () => "", ctx };
const VIDEO = "https://media.example.test/outputs/v.mp4";
const saved = { key: process.env.ZERNIO_API_KEY, account: process.env.ZERNIO_TIKTOK_ACCOUNT_ID };

before(async () => {
  delete process.env.ZERNIO_API_KEY;
  delete process.env.ZERNIO_TIKTOK_ACCOUNT_ID;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ path: req.url, body: JSON.parse(body || "{}") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Delivery refuses private addresses (#112 SSRF guard). "hook.test" is not in
  // real DNS: the stub lookup answers the loopback fixture and the test seam
  // lets that one name past the public-address check.
  _setLookupImpl(async () => ({ address: "127.0.0.1", family: 4 }));
  _setUnvettedHostsForTests(["hook.test"]);
  hookUrl = `http://hook.test:${server.address().port}`;
});

after(async () => {
  _resetLookupImpl();
  if (saved.key !== undefined) process.env.ZERNIO_API_KEY = saved.key;
  if (saved.account !== undefined) process.env.ZERNIO_TIKTOK_ACCOUNT_ID = saved.account;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  received.length = 0;
  writeSocialStore(dataDir, {
    webhooks: [
      { id: "wh_off", name: "Off", url: `${hookUrl}/off`, enabled: false },
      { id: "wh_live", name: "Live", url: `${hookUrl}/live`, enabled: true },
    ],
  });
});

const post = (fields) => dispatchPost({ destination: "webhook", caption: "Grace", videoUrl: VIDEO, ...fields }, reqLike);

test("a named enabled webhook gets the post", async () => {
  await post({ webhookId: "wh_live" });
  assert.deepEqual(received.map((r) => r.path), ["/live"]);
});

for (const [label, webhookId] of [["disabled", "wh_off"], ["removed", "wh_gone"]]) {
  test(`a named ${label} webhook fails the post and posts nothing`, async () => {
    await assert.rejects(() => post({ webhookId }), new RegExp(`webhook ${webhookId} is disabled or removed`, "i"));
    assert.deepEqual(received, []);
  });
}

test("with no webhookId the first enabled webhook is used", async () => {
  await post({});
  assert.deepEqual(received.map((r) => r.path), ["/live"]);
});

test("a scheduled run whose webhook was removed posts nothing", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    const schedule = { id: "s_stale", enabled: true, type: "replay", destination: "webhook", webhookId: "wh_gone", caption: "Grace", videoUrl: VIDEO };
    await runScheduledPost(schedule, ctx, { enqueueCampaignAutoPost: async () => ({ id: "n/a" }) });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(received, []);
  assert.ok(warnings.some((w) => w.includes("s_stale") && /disabled or removed/.test(w)), warnings.join("\n"));
});
