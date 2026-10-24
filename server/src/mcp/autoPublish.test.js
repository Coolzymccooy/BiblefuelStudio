import { test } from "node:test";
import assert from "node:assert/strict";
import { lacksPublishConsent, autoPublishIsOn, renderPublishPlan } from "./autoPublish.js";
import { fakeMcpCtx } from "../../test/helpers/fakeMcpCtx.js";

const apiError = (status = 500) => Object.assign(new Error("boom"), { name: "ApiError", status });

test("consent fails closed: no agentKey, or no publish switch, means no consent", () => {
  assert.equal(lacksPublishConsent({}), true);
  assert.equal(lacksPublishConsent(undefined), true);
  assert.equal(lacksPublishConsent({ agentKey: null }), true);
  assert.equal(lacksPublishConsent({ agentKey: {} }), true);
  assert.equal(lacksPublishConsent({ agentKey: { publishAllowed: false } }), true);
  assert.equal(lacksPublishConsent({ agentKey: { publishAllowed: "yes" } }), true);
  assert.equal(lacksPublishConsent({ agentKey: { publishAllowed: true } }), false);
});

test("autoPublishIsOn needs enabled AND at least one platform", async () => {
  const on = fakeMcpCtx({ "GET /api/postiz/auto-publish": { ok: true, enabled: true, platforms: ["tiktok"] } });
  assert.equal(await autoPublishIsOn(on.ctx), true);
  const noPlatforms = fakeMcpCtx({ "GET /api/postiz/auto-publish": { ok: true, enabled: true, platforms: [] } });
  assert.equal(await autoPublishIsOn(noPlatforms.ctx), false);
  const off = fakeMcpCtx({ "GET /api/postiz/auto-publish": { ok: true, enabled: false, platforms: ["tiktok"] } });
  assert.equal(await autoPublishIsOn(off.ctx), false);
});

test("autoPublishIsOn assumes on when the setting cannot be read, and rethrows other errors", async () => {
  const unreadable = fakeMcpCtx({ "GET /api/postiz/auto-publish": apiError(500) });
  assert.equal(await autoPublishIsOn(unreadable.ctx), true);
  const broken = fakeMcpCtx({ "GET /api/postiz/auto-publish": new TypeError("bug") });
  await assert.rejects(() => autoPublishIsOn(broken.ctx), TypeError);
});

test("renderPublishPlan without consent suppresses auto-publish and never reads the setting", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  const plan = await renderPublishPlan(ctx);
  assert.deepEqual(plan, { suppress: true, charge: {} });
  assert.deepEqual(calls, []);
});

test("renderPublishPlan with consent and auto-publish on counts one publish", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/postiz/auto-publish": { ok: true, enabled: true, platforms: ["youtube"] } });
  const plan = await renderPublishPlan({ ...ctx, agentKey: { publishAllowed: true } });
  assert.deepEqual(plan, { suppress: false, charge: { publishes: 1 } });
});

test("renderPublishPlan with consent and auto-publish off counts no publish and does not suppress", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/postiz/auto-publish": { ok: true, enabled: false, platforms: [] } });
  const plan = await renderPublishPlan({ ...ctx, agentKey: { publishAllowed: true } });
  assert.deepEqual(plan, { suppress: false, charge: {} });
});
