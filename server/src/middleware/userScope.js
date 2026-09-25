import { DATA_DIR, OUTPUT_DIR, ensureUserDirs } from "../lib/paths.js";
import { isSuperAdmin, getPlanForUser } from "../lib/userPlan.js";

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

  const flag = String(process.env.MULTITENANT || "").toLowerCase().trim();
  // Single-tenant only when the operator explicitly opts out.
  const singleTenant = flag === "false" || flag === "0" || flag === "off";

  if (singleTenant) {
    req.ctx = {
      userId: user.sub,
      email: user.email || "",
      role: "super_admin",
      plan: "super_admin",
      dataDir: DATA_DIR,
      outputDir: OUTPUT_DIR,
      isSuperAdmin: true,
    };
    return next();
  }

  const admin = isSuperAdmin(user);
  const { dataDir, outputDir } = admin
    ? { dataDir: DATA_DIR, outputDir: OUTPUT_DIR }
    : ensureUserDirs(user);

  req.ctx = {
    userId: user.sub,
    email: user.email || "",
    role: admin ? "super_admin" : "user",
    plan: getPlanForUser(user, dataDir),
    dataDir,
    outputDir,
    isSuperAdmin: admin,
  };
  next();
}
