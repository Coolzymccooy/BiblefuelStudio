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
 * Hard-coded plan resolution for Phase 1.
 * Phase 5 (billing) will replace this with a lookup against a per-user record.
 *
 * @param {JwtUser} user
 * @returns {'super_admin'|'free'|'premium'}
 */
export function getPlanForUser(user) {
  if (isSuperAdmin(user)) return "super_admin";
  return "free";
}
