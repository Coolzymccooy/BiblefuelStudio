import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import gumroadTools from "./gumroad.js";

const USER = { id: "u_gum_user", email: "gum-user@example.com", role: "user", emailVerified: true };
const ADMIN = { id: "u_gum_admin", email: "gum-admin@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER, ADMIN], superAdminEmail: ADMIN.email });
const userClient = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const adminClient = await mcpClient(testApp.port, testApp.keyFor(ADMIN.id));

after(async () => {
  await userClient.close().catch(() => {});
  await adminClient.close().catch(() => {});
  await testApp.close();
});

const [gumroad] = gumroadTools;
const PACK = { id: "g1", freeTitle: "7 Verses", paidTitle: "30 Days", freeMarkdown: "# Free", paidMarkdown: "# Paid", createdAt: "2026-10-24T08:00:00.000Z" };

test("one gumroad tool, gated by the gumroad feature like its route", () => {
  assert.deepEqual(gumroadTools.map((t) => t.name), ["gumroad"]);
  assert.equal(gumroad.requires, "feature:gumroad");
  assert.deepEqual(gumroad.routes, ["/api/gumroad"]);
  assert.equal(gumroad.caps, undefined);
  assert.equal(gumroad.publish, undefined);
  assert.match(gumroad.description, /zip/);
});

test("generate sends the titles and returns both packs, with the zip as a URL", async () => {
  const { ctx, calls } = fakeMcpCtx({ "POST /api/gumroad/generate": { ok: true, ...PACK } });
  const result = await gumroad.handler(ctx, { action: "generate", freeTitle: "7 Verses", paidTitle: "30 Days" });
  assert.deepEqual(calls[0].opts.body, { freeTitle: "7 Verses", paidTitle: "30 Days" });
  const data = result.structuredContent;
  assert.equal(data.ok, undefined);
  assert.equal(data.id, "g1");
  assert.equal(data.freeMarkdown, "# Free");
  assert.equal(data.paidMarkdown, "# Paid");
  assert.equal(data.zip.url, "http://host.test/api/gumroad/download.zip");
  assert.deepEqual(data.zip.files, ["FREE-LEAD-MAGNET.md", "PAID-30-DAY-DEVOTIONAL.md", "README.txt"]);
});

test("generate without titles lets the route use its defaults", async () => {
  const { ctx, calls } = fakeMcpCtx({ "POST /api/gumroad/generate": { ok: true, ...PACK } });
  await gumroad.handler(ctx, { action: "generate" });
  assert.deepEqual(calls[0].opts.body, {});
});

test("history lists the saved packs, limited", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/gumroad/history": { ok: true, items: [PACK] } });
  const result = await gumroad.handler(ctx, { action: "history", limit: 5 });
  assert.deepEqual(result.structuredContent, { items: [PACK] });
  assert.deepEqual(calls[0].opts.query, { limit: 5 });
});

test("the gumroad tool is hidden from a free user's key and listed for a super admin's", async () => {
  const userNames = (await userClient.listTools()).tools.map((t) => t.name);
  const adminNames = (await adminClient.listTools()).tools.map((t) => t.name);
  assert.ok(!userNames.includes("gumroad"));
  assert.ok(adminNames.includes("gumroad"));
});

test("a real generate and history through the client", async () => {
  const made = await adminClient.callTool({ name: "gumroad", arguments: { action: "generate", freeTitle: "Peace Verses", paidTitle: "Thirty Days" } });
  assert.ok(!made.isError, JSON.stringify(made.structuredContent));
  assert.equal(made.structuredContent.freeTitle, "Peace Verses");
  assert.ok(made.structuredContent.paidMarkdown.length > 100);
  const history = await adminClient.callTool({ name: "gumroad", arguments: { action: "history" } });
  assert.ok(history.structuredContent.items.some((p) => p.freeTitle === "Peace Verses"));
});
