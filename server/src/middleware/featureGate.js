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
 *   - "lyric.video":                   free + premium (Song mode; quota("render") is charged per timing/render run)
 */
export const PLAN_CAPABILITIES = Object.freeze({
  super_admin: new Set(["*"]),
  premium: new Set([
    "scripts", "tts.edge", "tts.chatterbox", "tts.elevenlabs",
    "voice.clone", "render", "library", "series", "bible", "social.connect", "lyric.video",
  ]),
  free: new Set([
    "scripts", "tts.edge", "tts.chatterbox",
    "render", "library", "series", "bible", "social.connect", "lyric.video",
  ]),
});

/**
 * True when `plan` includes `capability` ("*" grants every one). Shared by the
 * route gate below and the MCP registry, which hides `requires: "feature:<capability>"`
 * tools from keys whose user's plan would be refused by the route.
 *
 * @param {string | undefined} plan
 * @param {string} capability
 */
export function planAllows(plan, capability) {
  const caps = PLAN_CAPABILITIES[plan] || new Set();
  return caps.has("*") || caps.has(capability);
}

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
    if (planAllows(plan, capability)) return next();
    return res.status(403).json({
      ok: false,
      error: "FEATURE_LOCKED",
      capability,
      plan,
    });
  };
}
