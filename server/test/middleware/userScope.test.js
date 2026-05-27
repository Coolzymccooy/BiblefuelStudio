import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { withUserScope } from "../../src/middleware/userScope.js";
import { DATA_DIR, OUTPUT_DIR } from "../../src/lib/paths.js";

function makeReqRes(user) {
  const req = { user };
  let nextCalled = false;
  let statusCode = null;
  let payload = null;
  const next = () => { nextCalled = true; };
  const res = {
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
  };
  return {
    req, res, next,
    get nextCalled() { return nextCalled; },
    get statusCode() { return statusCode; },
    get payload() { return payload; },
  };
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try { return fn(); }
  finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("withUserScope: MULTITENANT=false => legacy ctx with DATA_DIR for everyone", () => {
  withEnv({ MULTITENANT: "false" }, () => {
    const ctx = makeReqRes({ sub: "u_random", email: "anyone@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.outputDir, OUTPUT_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.plan, "super_admin");
  });
});

test("withUserScope: MULTITENANT=true, super-admin email => DATA_DIR (legacy)", () => {
  withEnv({ MULTITENANT: "true", SUPER_ADMIN_EMAIL: "admin@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_admin", email: "admin@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.outputDir, OUTPUT_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.plan, "super_admin");
  });
});

test("withUserScope: MULTITENANT=true, regular user => per-user dir", () => {
  withEnv({ MULTITENANT: "true", SUPER_ADMIN_EMAIL: "admin@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_alice", email: "alice@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_alice"));
    assert.equal(ctx.req.ctx.outputDir, path.join(DATA_DIR, "users", "u_alice", "outputs"));
    assert.equal(ctx.req.ctx.isSuperAdmin, false);
    assert.equal(ctx.req.ctx.plan, "free");
  });
});

test("withUserScope: no req.user => 401", () => {
  const ctx = makeReqRes(undefined);
  withUserScope(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 401);
});

test("withUserScope: user without sub => 401", () => {
  const ctx = makeReqRes({ email: "no@sub.example" });
  withUserScope(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 401);
});
