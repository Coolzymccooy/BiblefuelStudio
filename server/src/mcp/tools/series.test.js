import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import seriesTools from "./series.js";

const USER = { id: "u_series", email: "series@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(seriesTools.map((t) => [t.name, t]));
const UNLIMITED = { ok: true, usage: { plan: "premium", buckets: { render: { used: 0, limit: -1, unlimited: true, remaining: null } } } };
const TWO_LEFT = { ok: true, usage: { plan: "free", buckets: { render: { used: 3, limit: 5, unlimited: false, remaining: 2 } } } };
const PLAN = (parts) => ({ seriesId: "series_x", chapterReference: "Psalm 23", totalParts: parts, segments: Array.from({ length: parts }, (_, i) => ({ partNumber: i + 1, reference: `Psalm 23:${i + 1}` })) });
const CONSENT = { agentKey: { id: "ak_me", publishAllowed: true } };

function ctxWith(responses, { usage = UNLIMITED } = {}) {
  const chargeCalls = [];
  const fake = fakeMcpCtx({ "GET /api/billing/usage": usage, ...responses }, {
    chargeCap: async (bucketOrAmounts, amount) => {
      chargeCalls.push(typeof bucketOrAmounts === "string" ? { [bucketOrAmounts]: amount ?? 1 } : bucketOrAmounts);
      return null;
    },
  });
  return { ...fake, ctx: { ...fake.ctx, ...CONSENT }, chargeCalls };
}

const routesCalled = (calls) => calls.map((c) => `${c.method} ${c.path}`);

// ---- definitions ----

test("the series file declares series_project and series_generate; generate posts, so it needs consent", () => {
  assert.deepEqual(seriesTools.map((t) => t.name), ["series_project", "series_generate"]);
  for (const tool of seriesTools) {
    assert.deepEqual(tool.routes, ["/api/series"], tool.name);
    assert.equal(tool.caps, undefined, tool.name);
    assert.equal(tool.requires, undefined, tool.name);
  }
  assert.equal(byName.series_generate.publish, true);
  assert.equal(byName.series_project.publish, undefined);
  assert.match(byName.series_generate.description, /kind job/);
  assert.match(byName.series_generate.description, /per part/);
  assert.match(byName.series_generate.description, /publishes/);
});

test("series_generate takes no webhook URL (a webhook is a saved id)", () => {
  assert.equal(byName.series_generate.inputSchema.webhookUrl, undefined);
  assert.ok(byName.series_generate.inputSchema.webhookId);
});

// ---- series_project ----

test("list reads the history and preview builds the plan, both free", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/series": { ok: true, series: [{ seriesId: "s1" }] },
    "POST /api/series/preview": { ok: true, plan: PLAN(3) },
  });
  const listed = await byName.series_project.handler(ctx, { action: "list", limit: 5 });
  assert.deepEqual(listed.structuredContent, { series: [{ seriesId: "s1" }] });
  assert.deepEqual(calls[0].opts.query, { limit: 5 });
  const preview = await byName.series_project.handler(ctx, { action: "preview", reference: "Psalm 23", versesPerPart: 1 });
  assert.equal(preview.structuredContent.plan.totalParts, 3);
  assert.deepEqual(calls[1].opts.body, { reference: "Psalm 23", versesPerPart: 1 });
  assert.equal(chargeCalls.length, 0);
});

test("preview needs a reference", async () => {
  const { ctx, calls } = ctxWith({});
  const result = await byName.series_project.handler(ctx, { action: "preview" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

// ---- series_generate ----

test("generate charges a render and a publish per part, atomically, then starts the series", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "POST /api/series/preview": { ok: true, plan: PLAN(3) },
    "POST /api/series/generate": { ok: true, series: { seriesId: "series_x" }, plan: PLAN(3), jobIds: ["job_1", "job_2", "job_3"], imageGen: { requested: false } },
  });
  const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23", destination: "youtube", privacyStatus: "unlisted" });
  assert.deepEqual(chargeCalls, [{ renders: 3, publishes: 3 }]);
  assert.deepEqual(routesCalled(calls), ["POST /api/series/preview", "GET /api/billing/usage", "POST /api/series/generate"]);
  assert.deepEqual(calls[2].opts.body, { reference: "Psalm 23", destination: "youtube", privacyStatus: "unlisted", maxParts: 3 });
  const data = result.structuredContent;
  assert.equal(data.parts, 3);
  assert.equal(data.seriesId, "series_x");
  assert.deepEqual(data.jobs.map((j) => [j.kind, j.id, j.status]), [["job", "job_1", "queued"], ["job", "job_2", "queued"], ["job", "job_3", "queued"]]);
  assert.deepEqual(data.charged, { renders: 3, publishes: 3 });
});

test("generate with useGenImage also charges one image per part, given back when no images were made", async () => {
  const { ctx, chargeCalls, refunds } = ctxWith({
    "POST /api/series/preview": { ok: true, plan: PLAN(2) },
    "POST /api/series/generate": { ok: true, series: {}, plan: PLAN(2), jobIds: ["job_1", "job_2"], imageGen: { requested: false } },
  });
  await byName.series_generate.handler(ctx, { reference: "Psalm 23", useGenImage: true });
  assert.deepEqual(chargeCalls, [{ renders: 2, publishes: 2, images: 2 }]);
  assert.deepEqual(refunds, [{ bucket: "images", amount: 2 }]);
});

test("generate gives back the parts the route did not start", async () => {
  const { ctx, refunds } = ctxWith({
    "POST /api/series/preview": { ok: true, plan: PLAN(3) },
    "POST /api/series/generate": { ok: true, series: {}, plan: PLAN(2), jobIds: ["job_1", "job_2"], imageGen: { requested: false } },
  });
  const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23" });
  assert.deepEqual(refunds, [{ bucket: "renders", amount: 1 }, { bucket: "publishes", amount: 1 }]);
  assert.equal(result.structuredContent.parts, 2);
});

test("generate is refused before any charge when the plan has fewer renders left than parts", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({ "POST /api/series/preview": { ok: true, plan: PLAN(3) } }, { usage: TWO_LEFT });
  const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23" });
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(result.structuredContent.needed, 3);
  assert.equal(chargeCalls.length, 0);
  assert.ok(!routesCalled(calls).includes("POST /api/series/generate"));
});

test("R51: a series longer than the renders or publishes left is refused saying how to fix it", async () => {
  for (const [bucket, env] of [["publishes", "MCP_DAILY_PUBLISHES"], ["renders", "MCP_DAILY_RENDERS"]]) {
    const refusedCtx = fakeMcpCtx({ "GET /api/billing/usage": UNLIMITED, "POST /api/series/preview": { ok: true, plan: PLAN(5) } }, {
      chargeCap: async () => ({
        isError: true,
        content: [{ type: "text", text: `MCP_CAP_REACHED: Daily ${bucket} cap reached for this agent (0 of 3).` }],
        structuredContent: { error: "MCP_CAP_REACHED", message: "x", bucket, scope: "key", used: 0, limit: 3, resetsAt: "2026-10-25T00:00:00.000Z" },
      }),
    });
    const ctx = { ...refusedCtx.ctx, ...CONSENT };
    const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23" });
    const data = result.structuredContent;
    assert.equal(result.isError, true);
    assert.equal(data.error, "MCP_CAP_REACHED");
    assert.equal(data.bucket, bucket);
    assert.equal(data.used, 0);
    assert.equal(data.limit, 3);
    assert.equal(data.needed, 5);
    assert.match(data.message, /^5 parts need 5 renders and 5 publishes; 3 \w+ are left today\. Make fewer parts, or raise MCP_DAILY_RENDERS \/ MCP_DAILY_PUBLISHES\./);
    assert.match(result.content[0].text, new RegExp(env));
    assert.ok(!refusedCtx.calls.some((c) => c.path === "/api/series/generate"));
  }
});

test("generate refuses an unknown or disabled webhook id before any charge", async () => {
  const { ctx, calls, chargeCalls } = ctxWith({
    "GET /api/social/config": { ok: true, webhooks: [{ id: "w1", enabled: false }] },
  });
  const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23", webhookId: "w1" });
  assert.equal(result.structuredContent.error, "WEBHOOK_NOT_FOUND");
  assert.equal(chargeCalls.length, 0);
  assert.deepEqual(routesCalled(calls), ["GET /api/social/config"]);
});

test("generate refuses a plan with no parts, uncharged", async () => {
  const { ctx, chargeCalls } = ctxWith({ "POST /api/series/preview": { ok: true, plan: PLAN(0) } });
  const result = await byName.series_generate.handler(ctx, { reference: "Psalm 23" });
  assert.equal(result.structuredContent.error, "NO_PARTS");
  assert.equal(chargeCalls.length, 0);
});

// ---- through the real MCP client ----

test("the series tools are listed; a real list call works; generate without consent never reaches the route", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("series_project"));
  assert.ok(names.includes("series_generate"));
  const listed = await client.callTool({ name: "series_project", arguments: { action: "list" } });
  assert.ok(!listed.isError, JSON.stringify(listed.structuredContent));
  assert.deepEqual(listed.structuredContent.series, []);
  const refused = await client.callTool({ name: "series_generate", arguments: { reference: "Psalm 23" } });
  assert.equal(refused.structuredContent.error, "PUBLISH_NOT_ALLOWED");
});
