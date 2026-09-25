/**
 * Capability matrix per plan tier.
 *
 * "*" (in super_admin) means every capability is implicitly granted, so we don't
 * have to keep this table in sync with every new feature for the operator.
 *
 * Notable Phase 1 decisions (see specs/2026-05-26-public-multitenancy-design.md):
 *   - "tts.elevenlabs" + "voice.clone": premium only (operator's cost driver)
 *   - "gumroad":                        super-admin only (business plan TBD)
 *   - "tts.edge" / "tts.chatterbox":    free (self-hosted, no per-call $)
 */
export const PLAN_CAPABILITIES = Object.freeze({
  super_admin: new Set(["*"]),
  premium: new Set([
    "scripts", "tts.edge", "tts.chatterbox", "tts.elevenlabs",
    "voice.clone", "render", "library", "series", "bible", "social.connect",
  ]),
  free: new Set([
    "scripts", "tts.edge", "tts.chatterbox",
    "render", "library", "series", "bible", "social.connect",
  ]),
});

/**
 * Express middleware factory. Returns a handler that 403s with FEATURE_LOCKED
 * if the current plan does not include the named capability.
 *
 * Mount AFTER withUserScope so req.ctx.plan is populated.
 *
 * @param {string} capability  e.g. "tts.elevenlabs", "gumroad"
 */
export function featureGate(capability) {
  return function gate(req, res, next) {
    const plan = req?.ctx?.plan;
    if (!plan) {
      return res.status(401).json({ ok: false, error: "Missing user context" });
    }
    const caps = PLAN_CAPABILITIES[plan] || new Set();
    if (caps.has("*") || caps.has(capability)) return next();
    return res.status(403).json({
      ok: false,
      error: "FEATURE_LOCKED",
      capability,
      plan,
    });
  };
}
