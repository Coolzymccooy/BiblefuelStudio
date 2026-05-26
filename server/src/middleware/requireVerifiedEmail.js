import { isSuperAdmin } from "../lib/userPlan.js";

/**
 * Express middleware. Mount AFTER requireAuth + withUserScope.
 *
 * Blocks unverified-email users from expensive operations (TTS, render, etc.)
 * Behaviour:
 *   - Super-admin: always passes (env-matched; assumed verified out of band)
 *   - REQUIRE_EMAIL_VERIFIED !== "true": skip the check (dev / pre-launch)
 *   - emailVerified true: pass
 *   - emailVerified false: 403 with EMAIL_NOT_VERIFIED
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 2
 */
export function requireVerifiedEmail(req, res, next) {
  if (String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() !== "true") {
    return next();
  }
  if (req?.ctx?.isSuperAdmin || isSuperAdmin(req?.user)) return next();
  const verified = Boolean(req?.user?.emailVerified);
  if (verified) return next();
  return res.status(403).json({
    ok: false,
    error: "EMAIL_NOT_VERIFIED",
    hint: "Please verify your email address. Check your inbox for the verification link.",
  });
}
