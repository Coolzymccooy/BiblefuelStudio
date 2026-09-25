import { resolveScopeDirs, isSingleTenant } from "../lib/paths.js";
import { getPlanForUser } from "../lib/userPlan.js";

/**
 * Express middleware. Must be mounted AFTER requireAuth (i.e. req.user exists).
 *
 * Attaches:
 *   req.ctx = { userId, email, role, plan, dataDir, outputDir, isSuperAdmin }
 *
 * Multi-tenancy is ON by default — a fresh deploy must isolate user data,
 * or every new sign-up sees every other account's jobs and library. The
 * single-tenant escape hatch (MULTITENANT=false) is for the original
 * operator-only deployment shape and must be opted into explicitly.
 *
 * When MULTITENANT === "false", everyone (including any signed-in user) is
 * treated as super-admin and reads/writes the legacy DATA_DIR / OUTPUT_DIR.
 *
 * When MULTITENANT is unset or "true", super-admin (matched by
 * SUPER_ADMIN_EMAIL or SUPER_ADMIN_USER_ID) still hits the legacy paths so
 * the operator's existing global library/jobs aren't orphaned. Everyone
 * else resolves to a per-user dir under DATA_DIR/users/<userId>/.
 */
export function withUserScope(req, res, next) {
  const user = req.user;
  if (!user || !user.sub) {
    return res.status(401).json({ ok: false, error: "Missing user context" });
  }

  // Directory resolution lives in resolveScopeDirs so that callers WITHOUT a
  // JWT — the YouTube OAuth callback, which Google redirects to carrying only
  // ?code=&state= — reach the same answer. Duplicating the rules here is what
  // put a refresh token in a directory the status route never read.
  const { dataDir, outputDir, isSuperAdmin: admin } = resolveScopeDirs(user);

  req.ctx = {
    userId: user.sub,
    email: user.email || "",
    role: admin ? "super_admin" : "user",
    // Single-tenant grants the operator's own tier; otherwise read the plan.
    plan: isSingleTenant() ? "super_admin" : getPlanForUser(user, dataDir),
    dataDir,
    outputDir,
    isSuperAdmin: admin,
  };
  next();
}
