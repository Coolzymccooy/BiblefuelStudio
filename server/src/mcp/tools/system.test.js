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

test("capabilities says it describes the server, not what this key may use", async () => {
  const client = await connect(testApp.keyFor("u_user", "Capabilities description"));
  const { tools } = await client.listTools();
  const description = tools.find((t) => t.name === "capabilities").description;
  assert.match(description, /not what this key may use/);
  assert.match(description, /whoami/);
});

// ---- capabilities: the server-wide health section is cached for 60 s (#121) ----

const { default: systemTools, _setCapabilitiesClockForTests } = await import("./system.js");
const { fakeMcpCtx } = await import("../../../test/helpers/fakeMcpCtx.js");
const capabilitiesTool = systemTools.find((t) => t.name === "capabilities");

const HEALTH = { ok: true, system: { ffmpeg: "ffmpeg version 5.1.9", platform: "linux", node: "v22" }, capabilities: { elevenlabs: false, libass: true } };
function capabilitiesCtx() {
  return fakeMcpCtx({
    "GET /api/health": HEALTH,
    "GET /api/music/capabilities": { ok: true, vocalRemoval: true, laptopOnline: false },
    "GET /api/video-gen/status": { ok: true, enabled: false },
  });
}
const healthReads = (calls) => calls.filter((c) => c.path === "/api/health").length;

test("capabilities reads /api/health once a minute and answers the same from the cache", async () => {
  let clock = 1_000_000;
  _setCapabilitiesClockForTests(() => clock);
  try {
    const first = capabilitiesCtx();
    const fresh = await capabilitiesTool.handler(first.ctx, {});
    const second = capabilitiesCtx();
    clock += 59_000;
    const cached = await capabilitiesTool.handler(second.ctx, {});
    assert.deepEqual(cached.structuredContent, fresh.structuredContent);
    assert.equal(healthReads(first.calls), 1);
    assert.equal(healthReads(second.calls), 0, "within 60 s the health section comes from the cache");
    assert.equal(second.calls.length, 2, "music and AI video are still read on every call");
    const third = capabilitiesCtx();
    clock += 2_000;
    await capabilitiesTool.handler(third.ctx, {});
    assert.equal(healthReads(third.calls), 1, "after 60 s it is read again");
  } finally {
    _setCapabilitiesClockForTests(null);
  }
});

test("capabilities starts its three reads together rather than one after another", async () => {
  _setCapabilitiesClockForTests(() => 5_000_000);
  try {
    const { ctx } = capabilitiesCtx();
    const read = ctx.api.call;
    let inFlight = 0;
    let most = 0;
    ctx.api.call = async (method, p, opts) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return read(method, p, opts);
    };
    const result = await capabilitiesTool.handler(ctx, {});
    assert.equal(most, 3);
    assert.deepEqual(result.structuredContent.server, HEALTH.system);
    assert.deepEqual(result.structuredContent.features, HEALTH.capabilities);
    assert.equal(result.structuredContent.music.vocalRemoval, true);
    assert.equal(result.structuredContent.aiVideo.enabled, false);
  } finally {
    _setCapabilitiesClockForTests(null);
  }
});

test("a failed health read is not cached", async () => {
  _setCapabilitiesClockForTests(() => 9_000_000);
  try {
    const failing = fakeMcpCtx({ "GET /api/health": new Error("down"), "GET /api/music/capabilities": {}, "GET /api/video-gen/status": {} });
    await assert.rejects(capabilitiesTool.handler(failing.ctx, {}), /down/);
    const next = capabilitiesCtx();
    await capabilitiesTool.handler(next.ctx, {});
    assert.equal(healthReads(next.calls), 1);
  } finally {
    _setCapabilitiesClockForTests(null);
  }
});
