import { test } from "node:test";
import assert from "node:assert/strict";
import { featureGate, PLAN_CAPABILITIES } from "../../src/middleware/featureGate.js";

function makeReqRes(plan) {
  const req = { ctx: plan == null ? undefined : { plan } };
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

test("featureGate: super_admin passes every capability", () => {
  const mw = featureGate("gumroad");
  const ctx = makeReqRes("super_admin");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: free + gumroad => 403 FEATURE_LOCKED", () => {
  const mw = featureGate("gumroad");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 403);
  assert.equal(ctx.payload.error, "FEATURE_LOCKED");
  assert.equal(ctx.payload.capability, "gumroad");
});

test("featureGate: free + tts.elevenlabs => 403", () => {
  const mw = featureGate("tts.elevenlabs");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.statusCode, 403);
});

test("featureGate: free + tts.edge => next", () => {
  const mw = featureGate("tts.edge");
  const ctx = makeReqRes("free");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: premium + tts.elevenlabs => next", () => {
  const mw = featureGate("tts.elevenlabs");
  const ctx = makeReqRes("premium");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, true);
});

test("featureGate: premium + gumroad => 403 (premium does not unlock gumroad)", () => {
  const mw = featureGate("gumroad");
  const ctx = makeReqRes("premium");
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.statusCode, 403);
});

test("featureGate: missing ctx => 401", () => {
  const mw = featureGate("anything");
  const ctx = makeReqRes(null);
  mw(ctx.req, ctx.res, ctx.next);
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 401);
});

test("PLAN_CAPABILITIES: gumroad is super_admin only", () => {
  assert.equal(PLAN_CAPABILITIES.super_admin.has("*"), true);
  assert.equal(PLAN_CAPABILITIES.premium.has("gumroad"), false);
  assert.equal(PLAN_CAPABILITIES.free.has("gumroad"), false);
});
