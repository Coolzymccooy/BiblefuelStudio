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
 * SUPER_ADMIN_EMAIL accepts EITHER a single email OR a comma/semicolon-
 * separated list — operators with multiple accounts (e.g. an admin email
 * and a personal Google account) can grant super-admin to both without
 * needing a code change.
 *
 * SUPER_ADMIN_USER_ID is single-value only; the user.sub claim is one id
 * per JWT, so a list would just complicate matching.
 *
 * @param {JwtUser|undefined} user
 * @returns {boolean}
 */
export function isSuperAdmin(user) {
  if (!user) return false;
  const adminId = String(process.env.SUPER_ADMIN_USER_ID || "").trim();
  if (adminId && String(user.sub || "") === adminId) return true;

  const adminEmailRaw = String(process.env.SUPER_ADMIN_EMAIL || "").trim();
  if (!adminEmailRaw) return false;
  const userEmail = String(user.email || "").toLowerCase().trim();
  if (!userEmail) return false;
  const allowed = adminEmailRaw
    .split(/[,;]/)
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
  return allowed.includes(userEmail);
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
