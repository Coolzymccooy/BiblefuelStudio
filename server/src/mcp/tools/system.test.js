import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";

const USERS = [{ id: "u_user", email: "user@example.com", role: "user", emailVerified: true }];

const testApp = await startTestApp({ users: USERS });
const { port } = testApp;

const clients = [];
async function connect(bearer) {
  const client = await mcpClient(port, bearer);
  clients.push(client);
  return client;
}

after(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

test("tools/list includes whoami and capabilities with their titles", async () => {
  const client = await connect(testApp.keyFor("u_user"));
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.whoami?.title, "Who am I");
  assert.equal(byName.capabilities?.title, "Server capabilities");
});

test("whoami reports the user, plan, quota, caps and the key", async () => {
  const client = await connect(testApp.keyFor("u_user", "test"));
  const result = await client.callTool({ name: "whoami", arguments: {} });
  assert.notEqual(result.isError, true);
  const data = result.structuredContent;
  assert.equal(data.user.id, "u_user");
  assert.equal(data.user.email, "user@example.com");
  assert.equal(data.user.isSuperAdmin, false);
  assert.equal(data.user.emailVerified, true);
  assert.equal(data.plan, "free");
  assert.equal(typeof data.quota.scripts.limit, "number");
  assert.equal(data.caps.renders.limit, 10);
  assert.deepEqual(data.accountCaps.renders, { used: 0, limit: 10, remaining: 10 });
  assert.deepEqual(Object.keys(data.accountCaps).sort(), Object.keys(data.caps).sort());
  assert.equal(data.key.name, "test");
  assert.equal(data.key.publishAllowed, false);
  assert.equal(typeof data.key.id, "string");
});

test("capabilities reports the server, boolean features, music and AI video", async () => {
  const client = await connect(testApp.keyFor("u_user"));
  const result = await client.callTool({ name: "capabilities", arguments: {} });
  assert.notEqual(result.isError, true);
  const data = result.structuredContent;
  assert.equal(data.server.node, process.version);
  assert.equal(typeof data.features, "object");
  const values = Object.values(data.features);
  assert.ok(values.length > 0);
  assert.ok(values.every((v) => typeof v === "boolean"));
  assert.equal(typeof data.music.vocalRemoval, "boolean");
  assert.equal("ok" in data.music, false);
  assert.equal(typeof data.aiVideo.enabled, "boolean");
  assert.equal("ok" in data.aiVideo, false);
});
