import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../test/helpers/mcpTestApp.js";

// R37: when the app refuses a call (a 4xx answer), the daily caps that call spent are given back,
// on the key and on the account. A 5xx or a network failure keeps them (the work may have started),
// and an import attempt always counts (R32).

const USERS = [{ id: "u_refund", email: "refund@example.com", role: "user", emailVerified: true }];

const testApp = await startTestApp({ users: USERS });
const store = await import("../lib/agentKeys/store.js");
const caps = await import("../lib/agentKeys/caps.js");
const activity = await import("../lib/agentKeys/activity.js");
const registry = await import("./registry.js");
const { ApiError } = await import("./api.js");
const { ok } = await import("./toolResult.js");

const MISSING_JOB = "/api/jobs/job_does_not_exist";
const text = { text: z.string().optional() };

const def = (name, extra) => ({ name, title: name, description: name, inputSchema: text, ...extra });

const CATALOGUE = [
  def("declared_404", { caps: { renders: 1, publishes: 1 }, handler: (ctx) => ctx.api.call("GET", MISSING_JOB) }),
  def("charged_then_404", {
    handler: async (ctx) => (await ctx.chargeCap({ renders: 1, images: 2 })) || ctx.api.call("GET", MISSING_JOB),
  }),
  def("declared_500", {
    caps: { renders: 1 },
    handler: async () => {
      throw new ApiError({ status: 500, code: "HTTP_500", message: "boom" });
    },
  }),
  def("network_failure", {
    caps: { renders: 1 },
    handler: async () => {
      throw new TypeError("fetch failed");
    },
  }),
  def("import_404", { caps: { imports: 1, renders: 1 }, handler: (ctx) => ctx.api.call("GET", MISSING_JOB) }),
  def("joined_publish", {
    handler: async (ctx) => {
      const refused = await ctx.chargeCap({ publishes: 1 });
      if (refused) return refused;
      await ctx.refundCap({ publishes: 5 });
      return ok({ joined: true });
    },
  }),
  def("ok_render", { caps: { renders: 1 }, handler: async () => ok({ done: true }) }),
];
registry._setCatalogueForTests(CATALOGUE);

const clients = [];

/** A fresh key (so its counters start at zero) and a client on it. */
async function freshKey(name) {
  const made = store.createKey("u_refund", name);
  const client = await mcpClient(testApp.port, made.plain);
  clients.push(client);
  return { key: made.key, client };
}

const keyCounts = (key) => caps.readKeyUsage(key.id).counts;
const userCounts = () => caps.readUserUsage("u_refund").counts;

after(async () => {
  registry._setCatalogueForTests(null);
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

test("a route 4xx gives back the declared caps on the key and the account", async () => {
  const { key, client } = await freshKey("declared 404");
  const before = userCounts();
  const result = await client.callTool({ name: "declared_404", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 404);
  assert.equal(keyCounts(key).renders, 0);
  assert.equal(keyCounts(key).publishes, 0);
  assert.equal(userCounts().renders, before.renders);
  assert.equal(userCounts().publishes, before.publishes);
  const [entry] = activity.readActivity({ keyId: key.id });
  assert.deepEqual(entry.caps, {});
});

test("a route 4xx gives back what the handler charged itself", async () => {
  const { key, client } = await freshKey("handler 404");
  const before = userCounts();
  const result = await client.callTool({ name: "charged_then_404", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(keyCounts(key).renders, 0);
  assert.equal(keyCounts(key).images, 0);
  assert.equal(userCounts().renders, before.renders);
  assert.equal(userCounts().images, before.images);
});

test("a 5xx keeps the charge (the work may have started)", async () => {
  const { key, client } = await freshKey("server 500");
  const before = userCounts();
  const result = await client.callTool({ name: "declared_500", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(keyCounts(key).renders, 1);
  assert.equal(userCounts().renders, before.renders + 1);
});

test("a network failure keeps the charge", async () => {
  const { key, client } = await freshKey("network");
  const before = userCounts();
  const result = await client.callTool({ name: "network_failure", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "INTERNAL");
  assert.equal(keyCounts(key).renders, 1);
  assert.equal(userCounts().renders, before.renders + 1);
});

test("an import always counts, even when the route refuses; other buckets are given back", async () => {
  const { key, client } = await freshKey("import 404");
  const before = userCounts();
  const result = await client.callTool({ name: "import_404", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(keyCounts(key).imports, 1);
  assert.equal(keyCounts(key).renders, 0);
  assert.equal(userCounts().imports, before.imports + 1);
  assert.equal(userCounts().renders, before.renders);
  const [entry] = activity.readActivity({ keyId: key.id });
  assert.deepEqual(entry.caps, { imports: 1 });
});

test("ctx.refundCap gives back at most what this call charged", async () => {
  const { key, client } = await freshKey("joined");
  await client.callTool({ name: "ok_render", arguments: {} });
  await caps.chargeAll(key.id, { ...key, userId: "u_refund" }, { publishes: 1 });
  const before = userCounts();
  const result = await client.callTool({ name: "joined_publish", arguments: {} });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(keyCounts(key).publishes, 1);
  assert.equal(keyCounts(key).renders, 1);
  assert.equal(userCounts().publishes, before.publishes);
});

test("a call that succeeds keeps its charge", async () => {
  const { key, client } = await freshKey("ok");
  const result = await client.callTool({ name: "ok_render", arguments: {} });
  assert.notEqual(result.isError, true);
  assert.equal(keyCounts(key).renders, 1);
});
