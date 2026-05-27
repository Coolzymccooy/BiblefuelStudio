/**
 * Express middleware that blocks anything that isn't the super-admin.
 *
 * Mount AFTER requireAuth + withUserScope so req.ctx.isSuperAdmin is populated.
 * The flag is sourced from SUPER_ADMIN_EMAIL / SUPER_ADMIN_USER_ID env vars
 * (see lib/userPlan.js), NOT from the users.json `role` column — see the
 * note in withUserScope.js.
 */
export function requireSuperAdmin(req, res, next) {
  if (!req?.ctx?.isSuperAdmin) {
    return res.status(403).json({
      ok: false,
      error: "FORBIDDEN",
      hint: "This endpoint is restricted to the super-admin account.",
    });
  }
  next();
}
