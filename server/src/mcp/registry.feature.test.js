import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../test/helpers/mcpTestApp.js";

// requires: "feature:<capability>" hides a tool from keys whose user's plan lacks that capability,
// by the same check featureGate(<capability>) makes on the route.

const USER = { id: "u_free", email: "free@example.com", role: "user", emailVerified: true };
const ADMIN = { id: "u_boss", email: "boss@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER, ADMIN], superAdminEmail: ADMIN.email });
const registry = await import("./registry.js");
const { ok } = await import("./toolResult.js");

const tool = (name, requires) => ({ name, title: name, description: name, inputSchema: { text: z.string().optional() }, requires, handler: async () => ok({ name }) });
registry._setCatalogueForTests([
  tool("open_tool"),
  tool("gumroad_only", "feature:gumroad"),
  tool("lyric_only", "feature:lyric.video"),
  tool("unknown_feature", "feature:no-such-thing"),
  tool("odd_requires", "something-else"),
]);

const clients = [];
after(async () => {
  registry._setCatalogueForTests(null);
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

async function namesFor(userId) {
  const client = await mcpClient(testApp.port, testApp.keyFor(userId));
  clients.push(client);
  return (await client.listTools()).tools.map((t) => t.name).sort();
}

test("a free user's key sees open tools and its plan's features, not gumroad", async () => {
  assert.deepEqual(await namesFor(USER.id), ["lyric_only", "open_tool"]);
});

test("a super-admin key sees every feature tool; unknown requires values stay hidden", async () => {
  assert.deepEqual(await namesFor(ADMIN.id), ["gumroad_only", "lyric_only", "open_tool", "unknown_feature"]);
});
