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
 * QUOTA_EXCEEDED when the plan's `bucket` quota has nothing left, else null.
 * Unlimited plans pass. If usage cannot be read, pass: the route still enforces it.
 *
 * @param {object} ctx
 * @param {"render"|"tts"|"imageGen"|"scripts"} bucket
 */
export async function planQuotaRefusal(ctx, bucket) {
  let body;
  try {
    body = await ctx.api.call("GET", "/api/billing/usage");
  } catch (err) {
    // Matched by name: importing ApiError from ./api.js would load auth.js.
    if (err?.name === "ApiError") return null;
    throw err;
  }
  const usage = body?.usage?.buckets?.[bucket];
  if (!usage || usage.unlimited || !(Number(usage.remaining) <= 0)) return null;
  const words = BUCKET_WORDS[bucket] || bucket;
  return fail("QUOTA_EXCEEDED", `Your plan's daily ${words} quota is used up (${usage.used} of ${usage.limit}).`, {
    bucket,
    used: usage.used,
    limit: usage.limit,
    hint: HINT,
  });
}

/** QUOTA_EXCEEDED when the plan's render quota has nothing left, else null. */
export function renderQuotaRefusal(ctx) {
  return planQuotaRefusal(ctx, "render");
}
