import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import queueTools from "./queue.js";

const USER = { id: "u_queue", email: "queue@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

const [queueItems] = queueTools;
const ITEM = { title: "Hope", hook: "When it hurts", verse: "The LORD is near", reference: "Psalm 34:18", reflection: "He stays.", cta: "Share it", hashtags: ["#hope"] };

test("one queue tool on /api/queue, free", () => {
  assert.deepEqual(queueTools.map((t) => t.name), ["queue_items"]);
  assert.deepEqual(queueItems.routes, ["/api/queue"]);
  assert.equal(queueItems.caps, undefined);
  assert.equal(queueItems.requires, undefined);
  assert.equal(queueItems.publish, undefined);
  assert.match(queueItems.description, /clear/);
});

test("list, add, remove and clear go to their routes", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/queue": { ok: true, items: [{ id: "q1", ...ITEM }] },
    "POST /api/queue/add": (_m, _p, opts) => ({ ok: true, item: { id: "q2", status: "draft", ...opts.body } }),
    "DELETE /api/queue/q1": { ok: true },
    "POST /api/queue/clear": { ok: true },
  });
  const listed = await queueItems.handler(ctx, { action: "list" });
  assert.deepEqual(listed.structuredContent, { items: [{ id: "q1", ...ITEM }] });
  const added = await queueItems.handler(ctx, { action: "add", item: ITEM });
  assert.deepEqual(calls[1].opts.body, ITEM);
  assert.equal(added.structuredContent.item.id, "q2");
  const removed = await queueItems.handler(ctx, { action: "remove", id: "q1" });
  assert.deepEqual(removed.structuredContent, { id: "q1", removed: true });
  const cleared = await queueItems.handler(ctx, { action: "clear" });
  assert.deepEqual(cleared.structuredContent, { cleared: true });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/queue", "POST /api/queue/add", "DELETE /api/queue/q1", "POST /api/queue/clear"]);
});

test("add needs an item and remove needs an id", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  assert.equal((await queueItems.handler(ctx, { action: "add" })).structuredContent.error, "BAD_INPUT");
  assert.equal((await queueItems.handler(ctx, { action: "remove" })).structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("an item mirrors the route's validator", () => {
  const schema = queueItems.inputSchema.item;
  assert.equal(schema.safeParse(ITEM).success, true);
  assert.equal(schema.safeParse({ ...ITEM, title: "x" }).success, false);
  assert.equal(schema.safeParse({ ...ITEM, hook: undefined }).success, false);
});

test("a real queue round trip through the client", async () => {
  const added = await client.callTool({ name: "queue_items", arguments: { action: "add", item: ITEM } });
  assert.ok(!added.isError, JSON.stringify(added.structuredContent));
  const id = added.structuredContent.item.id;
  const listed = await client.callTool({ name: "queue_items", arguments: { action: "list" } });
  assert.ok(listed.structuredContent.items.some((i) => i.id === id));
  const removed = await client.callTool({ name: "queue_items", arguments: { action: "remove", id } });
  assert.deepEqual(removed.structuredContent, { id, removed: true });
  const missing = await client.callTool({ name: "queue_items", arguments: { action: "remove", id } });
  assert.equal(missing.isError, true);
  await client.callTool({ name: "queue_items", arguments: { action: "add", item: ITEM } });
  await client.callTool({ name: "queue_items", arguments: { action: "clear" } });
  const empty = await client.callTool({ name: "queue_items", arguments: { action: "list" } });
  assert.deepEqual(empty.structuredContent.items, []);
});
