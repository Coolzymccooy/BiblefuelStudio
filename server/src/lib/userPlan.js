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
  return emailList(adminEmailRaw).includes(userEmail);
}

function emailList(raw) {
  return String(raw || "")
    .split(/[,;]/)
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * True for the super-admin who OWNS the main workspace (DATA_DIR) and the
 * operator's own integrations: env Zernio (the operator's TikTok) and every
 * job in jobs.json. Other super-admins keep their admin rights but get their
 * own folder; sharing the owner's workspace let a second admin see, clear and
 * publish the operator's work.
 *
 * There is exactly ONE owner, by precedence: SUPER_ADMIN_USER_ID when set;
 * otherwise the first email in OWNER_EMAIL; otherwise the FIRST email in
 * SUPER_ADMIN_EMAIL. Never someone who is not a super-admin. (A union of
 * these would let two people share the main workspace again.)
 *
 * @param {JwtUser|undefined} user
 * @returns {boolean}
 */
export function isOwner(user) {
  if (!isSuperAdmin(user)) return false;
  const owner = ownerIdentity();
  if (owner?.id) return String(user.sub || "") === owner.id;
  const userEmail = String(user.email || "").toLowerCase().trim();
  return Boolean(owner?.email) && userEmail === owner.email;
}

/** @returns {{ id: string } | { email: string } | null} who owns the main workspace */
function ownerIdentity() {
  const adminId = String(process.env.SUPER_ADMIN_USER_ID || "").trim();
  if (adminId) return { id: adminId };
  const email = emailList(process.env.OWNER_EMAIL)[0] || emailList(process.env.SUPER_ADMIN_EMAIL)[0];
  return email ? { email } : null;
}

/**
 * A sentence for the startup log when ownership is ambiguous or broken, else
 * null. Without OWNER_EMAIL the owner is whoever is listed first, so
 * reordering SUPER_ADMIN_EMAIL would silently hand the operator's workspace
 * to another admin.
 *
 * @returns {string|null}
 */
export function ownershipWarning() {
  const owner = ownerIdentity();
  if (!owner || owner.id) return null;
  const admins = emailList(process.env.SUPER_ADMIN_EMAIL);
  const named = emailList(process.env.OWNER_EMAIL)[0];
  if (named && !admins.includes(named)) {
    return `OWNER_EMAIL ${named} is not in SUPER_ADMIN_EMAIL, so nobody owns the main workspace.`;
  }
  if (!named && admins.length > 1) {
    return `${owner.email} owns the main workspace because it is listed first in SUPER_ADMIN_EMAIL. Set OWNER_EMAIL to make that explicit.`;
  }
  return null;
}

/**
 * True when a Firebase sign-in uses a super-admin's email that Firebase has
 * not verified. Admin emails skip the access-request gate and are matched by
 * email alone, so an unverified account claiming one must be refused.
 *
 * @param {{ uid?: string, email?: string, email_verified?: boolean }|null|undefined} decoded
 * @returns {boolean}
 */
export function unverifiedAdminSignIn(decoded) {
  const email = String(decoded?.email || "").trim().toLowerCase();
  if (!email || !isSuperAdmin({ sub: "", email })) return false;
  return decoded?.email_verified !== true;
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
