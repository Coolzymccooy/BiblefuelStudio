import { fail } from "./toolResult.js";

/**
 * Plan quota pre-checks for tools that charge daily caps in the handler
 * (R34). The route spends the quota itself; reading it first means a call the
 * route would refuse never spends the agent's daily caps.
 *
 * Lives outside tools/ because the registry loads every file there as tools.
 */

const HINT = "Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.";

// What each plan bucket meters, for the refusal message.
const BUCKET_WORDS = { render: "render", tts: "voice (tts)", imageGen: "image generation", scripts: "script writing" };

/**
 * QUOTA_EXCEEDED when the plan's `bucket` quota has fewer than `needed` units left
 * (by default: nothing left), else null.
 * Unlimited plans pass. If usage cannot be read, pass: the route still enforces it.
 *
 * @param {object} ctx
 * @param {"render"|"tts"|"imageGen"|"scripts"} bucket
 * @param {number} [needed=1] the units the call will spend (a series spends one render per part)
 */
export async function planQuotaRefusal(ctx, bucket, needed = 1) {
  let body;
  try {
    body = await ctx.api.call("GET", "/api/billing/usage");
  } catch (err) {
    // Matched by name: importing ApiError from ./api.js would load auth.js.
    if (err?.name === "ApiError") return null;
    throw err;
  }
  const usage = body?.usage?.buckets?.[bucket];
  const units = Math.max(1, Math.floor(Number(needed) || 1));
  if (!usage || usage.unlimited || !(Number(usage.remaining) < units)) return null;
  const words = BUCKET_WORDS[bucket] || bucket;
  const message = units > 1
    ? `This call needs ${units} units of your plan's daily ${words} quota and ${Math.max(0, Number(usage.remaining))} are left (${usage.used} of ${usage.limit} used).`
    : `Your plan's daily ${words} quota is used up (${usage.used} of ${usage.limit}).`;
  return fail("QUOTA_EXCEEDED", message, {
    bucket,
    used: usage.used,
    limit: usage.limit,
    ...(units > 1 ? { needed: units } : {}),
    hint: HINT,
  });
}

/** QUOTA_EXCEEDED when the plan's render quota has fewer than `needed` (default 1) left, else null. */
export function renderQuotaRefusal(ctx, needed = 1) {
  return planQuotaRefusal(ctx, "render", needed);
}
