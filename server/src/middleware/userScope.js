import { DATA_DIR, OUTPUT_DIR, ensureUserDirs } from "../lib/paths.js";
import { isSuperAdmin, getPlanForUser } from "../lib/userPlan.js";

/**
 * Express middleware. Must be mounted AFTER requireAuth (i.e. req.user exists).
 *
 * Attaches:
 *   req.ctx = { userId, email, role, plan, dataDir, outputDir, isSuperAdmin }
 *
 * When MULTITENANT !== "true", everyone (including any signed-in user) is
 * treated as super-admin and reads/writes the legacy DATA_DIR / OUTPUT_DIR.
 * This is the rollback lever — flip the env var, behaviour reverts.
 *
 * When MULTITENANT === "true", super-admin (matched by SUPER_ADMIN_EMAIL or
 * SUPER_ADMIN_USER_ID) still hits legacy paths; everyone else resolves to a
 * per-user dir under DATA_DIR/users/<userId>/, lazily created on first hit.
 */
export function withUserScope(req, res, next) {
  const user = req.user;
  if (!user || !user.sub) {
    return res.status(401).json({ ok: false, error: "Missing user context" });
  }

  const multitenant = String(process.env.MULTITENANT || "").toLowerCase() === "true";

  if (!multitenant) {
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
    plan: getPlanForUser(user),
    dataDir,
    outputDir,
    isSuperAdmin: admin,
  };
  next();
}
