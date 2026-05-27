import { readUserPlan } from "./userPlanStore.js";

/**
 * @typedef {Object} JwtUser
 * @property {string} sub
 * @property {string} [email]
 * @property {string} [role]
 */

/**
 * Returns true when the user matches the configured super-admin via
 * SUPER_ADMIN_USER_ID or SUPER_ADMIN_EMAIL (case-insensitive).
 *
 * @param {JwtUser|undefined} user
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  const adminEmail = String(process.env.SUPER_ADMIN_EMAIL || "").toLowerCase().trim();
  const adminId    = String(process.env.SUPER_ADMIN_USER_ID || "").trim();
  if (adminId && String(user.sub || "") === adminId) return true;
  if (adminEmail && String(user.email || "").toLowerCase() === adminEmail) return true;
  return false;
}

/**
 * Plan tier resolution.
 *
 * Source order:
 *   1. Super-admin shortcut (env match) → always "super_admin"
 *   2. Per-user plan.json record (Phase 3: set by Stripe webhook)
 *   3. Default: "free"
 *
 * The dataDir parameter is the per-user dir from withUserScope. When the
 * caller doesn't have a dataDir (e.g. boot-time code, tests), pass undefined
 * — the function falls back to super-admin shortcut + "free".
 *
 * @param {JwtUser} user
 * @param {string} [dataDir]
 * @returns {'super_admin'|'free'|'premium'}
 */
export function getPlanForUser(user, dataDir) {
  if (isSuperAdmin(user)) return "super_admin";
  if (!dataDir) return "free";
  const record = readUserPlan(dataDir);
  // Only honour an active or trialing premium subscription; past_due /
  // canceled lapse back to free until the user pays again.
  if (record.plan === "premium" && (record.status === "active" || record.status === "trialing")) {
    return "premium";
  }
  return "free";
}
