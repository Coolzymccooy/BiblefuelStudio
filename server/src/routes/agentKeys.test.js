import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startTestApp } from "../../test/helpers/mcpTestApp.js";

const USERS = [
  { id: "u_one", email: "one@example.com", role: "user", emailVerified: true },
  { id: "u_two", email: "two@example.com", role: "user", emailVerified: true },
];

const testApp = await startTestApp({ users: USERS });
const { app } = testApp;
const { signInternalToken } = await import("../auth.js");
const { ceilings } = await import("../lib/agentKeys/caps.js");

after(() => testApp.close());

const bearer = (userId) => ({ Authorization: `Bearer ${testApp.jwtFor(userId)}` });

async function createKey(userId, name = "My agent") {
  const res = await request(app).post("/api/agent-keys").set(bearer(userId)).send({ name });
  assert.equal(res.status, 201);
  return res.body;
}

test("create shows the plain key once; list never shows it", async () => {
  const created = await createKey("u_one", "Claude Desktop");
  assert.equal(created.ok, true);
  assert.match(created.plain, /^bfk_/);
  assert.equal(created.key.name, "Claude Desktop");
  assert.equal(created.key.hash, undefined);

  const list = await request(app).get("/api/agent-keys").set(bearer("u_one")).set("Host", "studio.example.com");
  assert.equal(list.status, 200);
  assert.equal(list.body.ok, true);
  assert.equal(list.body.endpoint, "http://studio.example.com/api/mcp");
  assert.deepEqual(list.body.ceilings, ceilings());
  const listed = list.body.keys.find((k) => k.id === created.key.id);
  assert.ok(listed);
  assert.equal(listed.usage.renders.used, 0);
  assert.equal(listed.usage.renders.limit, ceilings().renders);
  assert.equal(JSON.stringify(list.body).includes(created.plain), false);
});

test("create validates the name and the key limit", async () => {
  const noName = await request(app).post("/api/agent-keys").set(bearer("u_two")).send({});
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error, "KEY_NAME");
  const numeric = await request(app).post("/api/agent-keys").set(bearer("u_two")).send({ name: 5 });
  assert.equal(numeric.status, 400);

  for (let i = 0; i < 10; i += 1) await createKey("u_two", `k${i}`);
  const over = await request(app).post("/api/agent-keys").set(bearer("u_two")).send({ name: "one too many" });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, "KEY_LIMIT");
});

test("patch toggles consent and clamps caps to the ceiling", async () => {
  const { key } = await createKey("u_one", "Patchable");
  const ceiling = ceilings().renders;

  const res = await request(app)
    .patch(`/api/agent-keys/${key.id}`)
    .set(bearer("u_one"))
    .send({ publishAllowed: true, caps: { renders: 999, images: 2, bogus: 5 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.key.publishAllowed, true);
  assert.equal(res.body.key.caps.renders, ceiling);
  assert.equal(res.body.key.caps.images, Math.min(2, ceilings().images));
  assert.equal(res.body.key.caps.bogus, undefined);

  const bad = await request(app).patch(`/api/agent-keys/${key.id}`).set(bearer("u_one")).send({ publishAllowed: "yes" });
  assert.equal(bad.status, 400);
  for (const caps of [{ renders: "lots" }, { renders: -1 }, "many"]) {
    const badCaps = await request(app).patch(`/api/agent-keys/${key.id}`).set(bearer("u_one")).send({ caps });
    assert.equal(badCaps.status, 400);
  }

  const stranger = await request(app).patch(`/api/agent-keys/${key.id}`).set(bearer("u_two")).send({ publishAllowed: false });
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.error, "NOT_FOUND");

  const events = (await request(app).get(`/api/agent-keys/activity?keyId=${key.id}`).set(bearer("u_one"))).body.entries.map((e) => e.tool);
  assert.ok(events.includes("key:publish_on"));
  assert.ok(events.includes("key:caps_changed"));
  assert.equal(events.includes("key:publish_off"), false);

  await request(app).patch(`/api/agent-keys/${key.id}`).set(bearer("u_one")).send({ publishAllowed: true });
  const again = (await request(app).get(`/api/agent-keys/activity?keyId=${key.id}`).set(bearer("u_one"))).body.entries;
  assert.equal(again.filter((e) => e.tool === "key:publish_on").length, 1);
});

test("delete revokes; the key then fails at /api/mcp", async () => {
  const { key, plain } = await createKey("u_one", "Doomed");
  const probe = () => request(app).post("/api/mcp").set("Authorization", `Bearer ${plain}`).send({});
  assert.notEqual((await probe()).status, 401);

  const del = await request(app).delete(`/api/agent-keys/${key.id}`).set(bearer("u_one"));
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true });
  const after = await probe();
  assert.equal(after.status, 401);
  assert.equal(after.body.error, "AGENT_KEY_INVALID");

  const again = await request(app).delete(`/api/agent-keys/${key.id}`).set(bearer("u_one"));
  assert.equal(again.status, 404);
  const events = (await request(app).get(`/api/agent-keys/activity?keyId=${key.id}`).set(bearer("u_one"))).body.entries.map((e) => e.tool);
  assert.ok(events.includes("key:revoked"));
});

test("activity returns only the caller's entries", async () => {
  const mine = await createKey("u_one", "Mine for activity");
  const res = await request(app).get("/api/agent-keys/activity").set(bearer("u_one"));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.entries.length > 0);
  assert.ok(res.body.entries.every((e) => e.userId === "u_one"));
  assert.ok(res.body.entries.some((e) => e.keyId === mine.key.id));

  const other = await request(app).get(`/api/agent-keys/activity?keyId=${mine.key.id}`).set(bearer("u_two"));
  assert.deepEqual(other.body.entries, []);

  const limited = await request(app).get("/api/agent-keys/activity?limit=1").set(bearer("u_one"));
  assert.equal(limited.body.entries.length, 1);

  const badDate = await request(app).get("/api/agent-keys/activity?to=not-a-date").set(bearer("u_one"));
  assert.equal(badDate.status, 400);
  assert.equal(badDate.body.error, "BAD_DATE");
  const badFrom = await request(app).get("/api/agent-keys/activity.csv?from=2026-13-99x").set(bearer("u_one"));
  assert.equal(badFrom.status, 400);
});

test("csv has the header row", async () => {
  const res = await request(app).get("/api/agent-keys/activity.csv").set(bearer("u_one"));
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/csv; charset=utf-8/);
  assert.equal(res.headers["content-disposition"], 'attachment; filename="agent-activity.csv"');
  assert.ok(res.text.startsWith("ts,keyId,keyName,userId,email,tool,ok,error,ms,jobKind,jobId"));
  assert.ok(res.text.includes("key:created"));
});

test("an internal token is refused on every agent-keys route", async () => {
  const internal = { Authorization: `Bearer ${signInternalToken({ sub: "u_one", email: "one@example.com", role: "user" })}` };
  const calls = [
    request(app).get("/api/agent-keys"),
    request(app).post("/api/agent-keys").send({ name: "sneaky" }),
    request(app).patch("/api/agent-keys/whatever").send({ publishAllowed: true }),
    request(app).delete("/api/agent-keys/whatever"),
    request(app).get("/api/agent-keys/activity"),
    request(app).get("/api/agent-keys/activity.csv"),
  ];
  for (const call of calls) {
    const res = await call.set(internal);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "AGENT_FORBIDDEN");
  }
});

test("DELETE /api/auth/me and POST /api/billing/checkout refuse an internal token", async () => {
  const internal = { Authorization: `Bearer ${signInternalToken({ sub: "u_one", email: "one@example.com", role: "user" })}` };
  for (const call of [
    request(app).delete("/api/auth/me"),
    request(app).post("/api/billing/checkout").send({}),
    request(app).post("/api/billing/portal").send({}),
    request(app).get("/api/billing/plan"),
  ]) {
    const res = await call.set(internal);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "AGENT_FORBIDDEN");
  }
  const usage = await request(app).get("/api/billing/usage").set(internal);
  assert.equal(usage.status, 200);
  const stillThere = await request(app).get("/api/agent-keys").set(bearer("u_one"));
  assert.equal(stillThere.status, 200);
});
