import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp } from "../helpers/mcpTestApp.js";

const USER = { id: "u_postiz", email: "postiz@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const { signInternalToken } = await import("../../src/auth.js");
const base = `http://127.0.0.1:${testApp.port}/api/postiz`;

after(() => testApp.close());

const mcpToken = () =>
  signInternalToken({ sub: USER.id, email: USER.email, role: USER.role, emailVerified: true });

async function send(method, path, bearer, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const ACCOUNT_ROUTES = [
  ["POST", "/connect/tiktok", {}],
  ["DELETE", "/disconnect/int_1", undefined],
  ["PUT", "/auto-publish", { enabled: true, platforms: ["tiktok"] }],
  ["POST", "/post", { videoUrl: "https://example.com/v.mp4" }],
];

for (const [method, path, body] of ACCOUNT_ROUTES) {
  test(`${method} ${path} refuses an MCP token with AGENT_FORBIDDEN`, async () => {
    const res = await send(method, path, mcpToken(), body);
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { ok: false, error: "AGENT_FORBIDDEN" });
  });

  test(`${method} ${path} still serves the signed-in user`, async () => {
    const res = await send(method, path, testApp.jwtFor(USER.id), body);
    assert.notEqual(res.body.error, "AGENT_FORBIDDEN");
  });
}

test("an MCP token cannot switch auto-publish on, and the setting is unchanged", async () => {
  await send("PUT", "/auto-publish", testApp.jwtFor(USER.id), { enabled: false, platforms: [] });
  await send("PUT", "/auto-publish", mcpToken(), { enabled: true, platforms: ["tiktok"] });
  const read = await send("GET", "/auto-publish", mcpToken());
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { ok: true, enabled: false, platforms: [] });
});

test("GET /auto-publish stays open to MCP tokens (tools read it)", async () => {
  const res = await send("GET", "/auto-publish", mcpToken());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
