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

test("withUserScope: MULTITENANT UNSET => defaults to multi-tenant (regular user isolated)", () => {
  // The data-leak fix: a fresh deploy with no MULTITENANT env var must
  // isolate users by default. Operator-only single-tenant is opt-out.
  withEnv({ MULTITENANT: undefined, SUPER_ADMIN_EMAIL: "admin@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_bob", email: "bob@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_bob"));
    assert.equal(ctx.req.ctx.isSuperAdmin, false);
    assert.equal(ctx.req.ctx.plan, "free");
  });
});

test("withUserScope: MULTITENANT UNSET, super-admin email match => legacy paths", () => {
  withEnv({ MULTITENANT: undefined, SUPER_ADMIN_EMAIL: "admin@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_admin", email: "admin@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.nextCalled, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
  });
});

// Several super-admins used to share one workspace: every email in
// SUPER_ADMIN_EMAIL read and wrote DATA_DIR, so a second admin saw (and could
// clear, publish and post) the operator's queue, jobs and connected channels.
// Only the owner keeps DATA_DIR now; other admins keep their admin rights but
// get their own folder like any user.
test("withUserScope: the first super-admin email owns the main workspace", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_USER_ID: undefined, SUPER_ADMIN_EMAIL: "owner@example.com, other@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_owner", email: "Owner@Example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
    assert.equal(ctx.req.ctx.outputDir, OUTPUT_DIR);
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.isOwner, true);
  });
});

test("withUserScope: another super-admin keeps admin rights but gets their own folder", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_USER_ID: undefined, SUPER_ADMIN_EMAIL: "owner@example.com, other@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_other", email: "other@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_other"));
    assert.equal(ctx.req.ctx.outputDir, path.join(DATA_DIR, "users", "u_other", "outputs"));
    assert.equal(ctx.req.ctx.isSuperAdmin, true);
    assert.equal(ctx.req.ctx.isOwner, false);
    assert.equal(ctx.req.ctx.role, "super_admin");
    assert.equal(ctx.req.ctx.plan, "super_admin");
  });
});

test("withUserScope: OWNER_EMAIL names the owner when the first listed admin is not", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: "other@example.com", SUPER_ADMIN_USER_ID: undefined, SUPER_ADMIN_EMAIL: "owner@example.com, other@example.com" }, () => {
    const first = makeReqRes({ sub: "u_owner", email: "owner@example.com" });
    withUserScope(first.req, first.res, first.next);
    assert.equal(first.req.ctx.isOwner, false);
    assert.equal(first.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_owner"));
    const named = makeReqRes({ sub: "u_other", email: "other@example.com" });
    withUserScope(named.req, named.res, named.next);
    assert.equal(named.req.ctx.isOwner, true);
    assert.equal(named.req.ctx.dataDir, DATA_DIR);
  });
});

test("withUserScope: OWNER_EMAIL never makes a non-admin the owner", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: "stranger@example.com", SUPER_ADMIN_USER_ID: undefined, SUPER_ADMIN_EMAIL: "owner@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_stranger", email: "stranger@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.isOwner, false);
    assert.equal(ctx.req.ctx.isSuperAdmin, false);
    assert.equal(ctx.req.ctx.dataDir, path.join(DATA_DIR, "users", "u_stranger"));
  });
});

test("withUserScope: SUPER_ADMIN_USER_ID is the owner", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_USER_ID: "u_boss", SUPER_ADMIN_EMAIL: "owner@example.com, other@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_boss", email: "" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.isOwner, true);
    assert.equal(ctx.req.ctx.dataDir, DATA_DIR);
  });
});

test("withUserScope: single-tenant makes everyone the owner", () => {
  withEnv({ MULTITENANT: "false" }, () => {
    const ctx = makeReqRes({ sub: "u_random", email: "anyone@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.isOwner, true);
  });
});

test("withUserScope: a regular user is not the owner", () => {
  withEnv({ MULTITENANT: undefined, OWNER_EMAIL: undefined, SUPER_ADMIN_EMAIL: "owner@example.com" }, () => {
    const ctx = makeReqRes({ sub: "u_alice", email: "alice@example.com" });
    withUserScope(ctx.req, ctx.res, ctx.next);
    assert.equal(ctx.req.ctx.isOwner, false);
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
