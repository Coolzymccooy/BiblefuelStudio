import { fail } from "./toolResult.js";

/**
 * Plan quota pre-checks for tools that charge daily caps in the handler
 * (R34). The route spends the quota itself; reading it first means a call the
 * route would refuse never spends the agent's daily caps.
 *
 * Lives outside tools/ because the registry loads every file there as tools.
 */

const HINT = "Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.";

/**
 * QUOTA_EXCEEDED when the plan's render quota has nothing left, else null.
 * Unlimited plans pass. If usage cannot be read, pass: the route still enforces it.
 */
export async function renderQuotaRefusal(ctx) {
  let body;
  try {
    body = await ctx.api.call("GET", "/api/billing/usage");
  } catch (err) {
    // Matched by name: importing ApiError from ./api.js would load auth.js.
    if (err?.name === "ApiError") return null;
    throw err;
  }
  const render = body?.usage?.buckets?.render;
  if (!render || render.unlimited || !(Number(render.remaining) <= 0)) return null;
  return fail("QUOTA_EXCEEDED", `Your plan's daily render quota is used up (${render.used} of ${render.limit}).`, {
    bucket: "render",
    used: render.used,
    limit: render.limit,
    hint: HINT,
  });
}
