import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../test/helpers/mcpTestApp.js";

process.env.MCP_DAILY_RENDERS = "1";

const USERS = [
  { id: "u_user", email: "user@example.com", role: "user", emailVerified: true },
  { id: "u_admin", email: "admin@example.com", role: "user", emailVerified: true },
];

const testApp = await startTestApp({ users: USERS, superAdminEmail: "admin@example.com" });
const { port } = testApp;
const store = await import("../lib/agentKeys/store.js");
const activity = await import("../lib/agentKeys/activity.js");
const registry = await import("./registry.js");
const { ok } = await import("./toolResult.js");

const echoHandler = async (_ctx, input) => ok({ text: input.text });

registry._setCatalogueForTests([
  { name: "echo", title: "Echo", description: "Echoes the text.", inputSchema: { text: z.string() }, handler: echoHandler },
  {
    name: "admin_echo",
    title: "Admin echo",
    description: "Echoes the text for super admins.",
    inputSchema: { text: z.string() },
    requires: "super_admin",
    handler: echoHandler,
  },
  {
    name: "publish_echo",
    title: "Publish echo",
    description: "Pretends to publish.",
    inputSchema: { text: z.string() },
    publish: true,
    handler: echoHandler,
  },
  {
    name: "render_echo",
    title: "Render echo",
    description: "Pretends to render.",
    inputSchema: { text: z.string() },
    caps: { renders: 1 },
    handler: echoHandler,
  },
  {
    name: "my_usage",
    title: "My usage",
    description: "Reads the plan usage through the loopback API.",
    inputSchema: {},
    handler: async (ctx) => {
      const body = await ctx.api.call("GET", "/api/billing/usage");
      return ok({ plan: body.usage.plan, publicBase: ctx.publicBase, baseUrl: ctx.baseUrl });
    },
  },
]);

const clients = [];
async function connect(bearer) {
  const client = await mcpClient(port, bearer);
  clients.push(client);
  return client;
}

function newKey(userId, name = "test") {
  return store.createKey(userId, name);
}

const mcpUrl = `http://127.0.0.1:${port}/api/mcp`;

after(async () => {
  registry._setCatalogueForTests(null);
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

test("initialize + tools/list work with an agent key", async () => {
  const client = await connect(testApp.keyFor("u_user"));
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("echo"));
});

test("tools/call returns structuredContent", async () => {
  const client = await connect(testApp.keyFor("u_user"));
  const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.text, "hi");
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), { text: "hi" });
});

test("no bearer → 401; revoked key gets 401 on the next request", async () => {
  const anon = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(anon.status, 401);

  const { key, plain } = newKey("u_user");
  const client = await connect(plain);
  await client.listTools();
  assert.equal(store.revokeKey("u_user", key.id), true);
  await assert.rejects(client.listTools(), (err) => {
    assert.equal(err.code, 401);
    return true;
  });
});

test("GET and DELETE answer 405 JSON-RPC", async () => {
  const bearer = testApp.keyFor("u_user");
  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(mcpUrl, { method, headers: { Authorization: `Bearer ${bearer}` } });
    assert.equal(res.status, 405, method);
    assert.deepEqual(await res.json(), {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  }
});

test("a super_admin-only tool is hidden from a normal user and visible to the admin", async () => {
  const user = await connect(testApp.keyFor("u_user"));
  const admin = await connect(testApp.keyFor("u_admin"));
  const userNames = (await user.listTools()).tools.map((t) => t.name);
  const adminNames = (await admin.listTools()).tools.map((t) => t.name);
  assert.ok(!userNames.includes("admin_echo"));
  assert.ok(adminNames.includes("admin_echo"));
  assert.ok(adminNames.includes("echo"));
});

test("a publish tool refuses without consent and runs with it", async () => {
  const { key, plain } = newKey("u_user");
  const client = await connect(plain);

  const refused = await client.callTool({ name: "publish_echo", arguments: { text: "go" } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /^PUBLISH_NOT_ALLOWED: /);
  assert.equal(refused.structuredContent.error, "PUBLISH_NOT_ALLOWED");

  store.updateKey("u_user", key.id, { publishAllowed: true });
  const allowed = await client.callTool({ name: "publish_echo", arguments: { text: "go" } });
  assert.notEqual(allowed.isError, true);
  assert.equal(allowed.structuredContent.text, "go");
});

test("a capped tool refuses at the cap with MCP_CAP_REACHED", async () => {
  const client = await connect(newKey("u_user").plain);
  const first = await client.callTool({ name: "render_echo", arguments: { text: "one" } });
  assert.notEqual(first.isError, true);

  const second = await client.callTool({ name: "render_echo", arguments: { text: "two" } });
  assert.equal(second.isError, true);
  assert.match(second.content[0].text, /^MCP_CAP_REACHED: /);
  assert.equal(second.structuredContent.error, "MCP_CAP_REACHED");
  assert.equal(second.structuredContent.bucket, "renders");
  assert.equal(second.structuredContent.used, 1);
  assert.equal(second.structuredContent.limit, 1);
  assert.match(second.structuredContent.resetsAt, /T00:00:00\.000Z$/);
});

test("every call is logged", async () => {
  const { key, plain } = newKey("u_user", "Logger");
  const client = await connect(plain);
  await client.callTool({ name: "echo", arguments: { text: "logged" } });
  await client.callTool({ name: "publish_echo", arguments: { text: "refused" } });

  const entries = activity.readActivity({ keyId: key.id });
  assert.equal(entries.length, 2);
  const byTool = Object.fromEntries(entries.map((e) => [e.tool, e]));
  assert.deepEqual(Object.keys(byTool).sort(), ["echo", "publish_echo"]);
  assert.equal(byTool.echo.ok, true);
  assert.equal(byTool.echo.error, null);
  assert.equal(byTool.echo.keyName, "Logger");
  assert.equal(byTool.echo.userId, "u_user");
  assert.equal(byTool.echo.email, "user@example.com");
  assert.deepEqual(byTool.echo.input, { text: "logged" });
  assert.equal(byTool.publish_echo.ok, false);
  assert.match(byTool.publish_echo.error, /^PUBLISH_NOT_ALLOWED/);
});

test("a tool reaches the app through the loopback API", async () => {
  const client = await connect(testApp.jwtFor("u_user"));
  const result = await client.callTool({ name: "my_usage", arguments: {} });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.plan, "free");
  assert.equal(result.structuredContent.baseUrl, `http://127.0.0.1:${port}`);
  assert.equal(result.structuredContent.publicBase, `http://127.0.0.1:${port}`);
});

test("the guide resource is served as markdown", async () => {
  const client = await connect(testApp.keyFor("u_user"));
  const { contents } = await client.readResource({ uri: "biblefuel://guide" });
  assert.equal(contents[0].mimeType, "text/markdown");
  assert.match(contents[0].text, /^# Connect an agent to BibleFuel/);
});

test("an unknown Host header is refused", async () => {
  const bearer = testApp.keyFor("u_user");
  const http = await import("node:http");
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/mcp", method: "GET", headers: { Host: "evil.example", Authorization: `Bearer ${bearer}` } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("rate limit answers 429 after 120 requests in a minute", async () => {
  const bearer = newKey("u_user", "Busy").plain;
  const headers = { Authorization: `Bearer ${bearer}` };
  for (let i = 0; i < 120; i += 1) {
    const res = await fetch(mcpUrl, { method: "GET", headers });
    assert.equal(res.status, 405, `request ${i + 1}`);
    await res.arrayBuffer();
  }
  const limited = await fetch(mcpUrl, { method: "GET", headers });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { ok: false, error: "RATE_LIMITED" });
});
