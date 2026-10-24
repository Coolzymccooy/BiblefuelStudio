import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import tools from "./branding.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

const [branding] = tools;
const SETTINGS = { enabled: true, position: "top-right", size: "medium", opacity: 0.85, hasLogo: true };

test("the file declares branding on /api/branding", () => {
  assert.deepEqual(tools.map((t) => t.name), ["branding"]);
  assert.deepEqual(branding.routes, ["/api/branding"]);
  assert.match(branding.description, /logo/i);
});

test("get returns the settings without the logo's data URL", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/branding": { ok: true, branding: { ...SETTINGS, logoDataUrl: "data:image/png;base64,AAAA" } } });
  const result = await branding.handler(ctx, { action: "get" });
  assert.equal(calls[0].method, "GET");
  assert.deepEqual(result.structuredContent, { branding: SETTINGS });
});

test("set sends only the fields given by PUT and returns the saved settings", async () => {
  const { ctx, calls } = fakeMcpCtx({ "PUT /api/branding": { ok: true, branding: { ...SETTINGS, position: "bottom-left" } } });
  const result = await branding.handler(ctx, { action: "set", position: "bottom-left", opacity: undefined });
  assert.deepEqual(calls[0].opts.body, { position: "bottom-left" });
  assert.equal(result.structuredContent.branding.position, "bottom-left");
});

test("set with nothing to change is BAD_INPUT and calls nothing", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  const result = await branding.handler(ctx, { action: "set" });
  assert.equal(result.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("through the real server: get, then set, then turning on without a logo fails", async () => {
  const got = await client.callTool({ name: "branding", arguments: { action: "get" } });
  assert.notEqual(got.isError, true, got.content?.[0]?.text);
  assert.deepEqual(got.structuredContent.branding, { enabled: false, position: "top-right", size: "medium", opacity: 0.85, hasLogo: false });
  const set = await client.callTool({ name: "branding", arguments: { action: "set", position: "bottom-left", size: "large", opacity: 0.5 } });
  assert.notEqual(set.isError, true, set.content?.[0]?.text);
  assert.deepEqual(set.structuredContent.branding, { enabled: false, position: "bottom-left", size: "large", opacity: 0.5, hasLogo: false });
  const on = await client.callTool({ name: "branding", arguments: { action: "set", enabled: true } });
  assert.equal(on.isError, true);
  assert.match(on.content[0].text, /logo/i);
});

test("tools/list shows branding to a normal user", async () => {
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(names.includes("branding"));
});
