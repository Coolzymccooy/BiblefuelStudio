import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQuotaRefusal } from "./planQuota.js";
import { fakeMcpCtx } from "../../test/helpers/fakeMcpCtx.js";

const usage = (render) => ({ ok: true, usage: { day: "2026-10-24", plan: "free", buckets: { render } } });

test("renderQuotaRefusal refuses with QUOTA_EXCEEDED when the plan has no renders left", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/billing/usage": usage({ used: 5, limit: 5, unlimited: false, remaining: 0 }) });
  const refusal = await renderQuotaRefusal(ctx);
  assert.equal(refusal.isError, true);
  assert.equal(refusal.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(refusal.structuredContent.bucket, "render");
  assert.equal(refusal.structuredContent.used, 5);
  assert.equal(refusal.structuredContent.limit, 5);
});

test("renderQuotaRefusal passes when renders remain, on unlimited plans, and when usage cannot be read", async () => {
  const left = fakeMcpCtx({ "GET /api/billing/usage": usage({ used: 4, limit: 5, unlimited: false, remaining: 1 }) });
  assert.equal(await renderQuotaRefusal(left.ctx), null);
  const unlimited = fakeMcpCtx({ "GET /api/billing/usage": usage({ used: 99, limit: -1, unlimited: true, remaining: null }) });
  assert.equal(await renderQuotaRefusal(unlimited.ctx), null);
  const unreadable = fakeMcpCtx({ "GET /api/billing/usage": Object.assign(new Error("x"), { name: "ApiError", status: 500 }) });
  assert.equal(await renderQuotaRefusal(unreadable.ctx), null);
  const broken = fakeMcpCtx({ "GET /api/billing/usage": new TypeError("bug") });
  await assert.rejects(() => renderQuotaRefusal(broken.ctx), TypeError);
});
