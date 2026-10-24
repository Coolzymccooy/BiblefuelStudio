import { consumeQuota } from "../../middleware/quota.js";
import { isSingleTenant } from "../paths.js";
import { getPlanForUser } from "../userPlan.js";

/**
 * R38: a scheduled auto_generate run writes, speaks and renders a fresh
 * video, so it spends one unit of the schedule owner's plan render quota,
 * exactly as the Auto-Publish button does through POST /api/jobs/enqueue.
 * The cron has no request, so the owner's plan is read the way withUserScope
 * reads it.
 */

/**
 * @param {{ userId: string|null, dataDir: string, isSuperAdmin?: boolean }} ctx a scheduleOwnerCtx
 * @param {(userId: string) => string} emailFor the owner's email (super-admin by email), "" if unknown
 */
export function scheduleOwnerPlan(ctx, emailFor) {
  if (ctx?.isSuperAdmin || isSingleTenant()) return "super_admin";
  const userId = String(ctx?.userId || "");
  let email = "";
  try {
    email = String(emailFor(userId) || "");
  } catch (err) {
    console.warn(`[SOCIAL][CRON] could not read the owner of ${userId}:`, err?.message || err);
  }
  return getPlanForUser({ sub: userId, email }, ctx?.dataDir);
}

/**
 * Spends one plan render for the run. Returns null when spent (or unlimited),
 * else the QUOTA_EXCEEDED body the route would answer.
 */
export function spendScheduleRender(ctx, emailFor) {
  const spent = consumeQuota({ ...ctx, plan: scheduleOwnerPlan(ctx, emailFor) }, "render");
  return spent.ok ? null : spent.body;
}
