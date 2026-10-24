import { readUsage, incrementUsage } from "../lib/usageStore.js";

/**
 * Per-day quotas by plan tier and bucket.
 * Premium / super-admin are uncapped (-1).
 *
 * Tune these freely; they're the entire knob for the free-tier cost ceiling.
 */
export const QUOTAS = Object.freeze({
  super_admin: { scripts: -1, tts: -1, render: -1, imageGen: -1 },
  premium:     { scripts: -1, tts: -1, render: -1, imageGen: -1 },
  free:        { scripts: 10, tts: 10, render: 5,  imageGen: 5  },
});

/**
 * Checks and counts one unit against a bucket for a request context. Shared by
 * the quota middleware and by routes that spend quota conditionally (the job
 * retry route, which only counts render-type jobs).
 *
 * Increments BEFORE the work runs so over-quota requests are rejected before we
 * burn the operator's API budget; the cost of false-positive increments
 * (e.g. handler 500s after the bump) is one ghost-tick per error.
 *
 * @param {{ dataDir?: string, plan?: string } | null | undefined} ctx req.ctx from withUserScope
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 * @param {number} [amount=1] units to spend at once (a series spends one render per part): all or nothing
 * @returns {{ ok: true } | { ok: false, status: number, body: object }}
 */
export function consumeQuota(ctx, bucket, amount = 1) {
  if (!ctx) {
    return { ok: false, status: 401, body: { ok: false, error: "Missing user context" } };
  }
  const plan = ctx.plan;
  const limits = QUOTAS[plan] || QUOTAS.free;
  const limit = limits[bucket];

  // Unlimited tier — skip counting (no value to tracking; super-admin is
  // also the operator and never gates herself).
  if (limit === -1) return { ok: true };

  const { counts } = readUsage(ctx.dataDir);
  const used = Number(counts[bucket] || 0);
  const units = Math.max(1, Math.floor(Number(amount) || 1));
  if (used + units > limit) {
    return {
      ok: false,
      status: 429,
      body: {
        ok: false,
        error: "QUOTA_EXCEEDED",
        bucket,
        used,
        limit,
        plan,
        ...(units > 1 ? { needed: units } : {}),
        hint: "Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.",
      },
    };
  }

  incrementUsage(ctx.dataDir, bucket, units);
  return { ok: true };
}

/**
 * Gives back up to `amount` units consumeQuota spent today (never below zero), for a
 * request that spent quota up front and then started nothing. Unlimited plans spend
 * nothing, so they get nothing back.
 *
 * @param {{ dataDir?: string, plan?: string } | null | undefined} ctx
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 * @param {number} [amount=1]
 * @param {{ day?: string }} [options] `day`: the UTC day the units were spent on. When the
 *   counter has since rolled over to another day, that day's count is not touched.
 */
export function refundQuota(ctx, bucket, amount = 1, { day } = {}) {
  if (!ctx?.dataDir) return;
  const limit = (QUOTAS[ctx.plan] || QUOTAS.free)[bucket];
  if (limit === -1) return;
  const usage = readUsage(ctx.dataDir);
  if (day && usage.day !== day) return;
  const used = Number(usage.counts[bucket] || 0);
  const back = Math.min(used, Math.max(0, Math.floor(Number(amount) || 0)));
  if (back > 0) incrementUsage(ctx.dataDir, bucket, -back);
}

/**
 * Arranges for the unit this request just spent to come back if it answers with an
 * error status (>= 400): it produced nothing. Also exposes `res.locals.refundQuota()`
 * for a handler that answers 200 yet produced nothing (a compare where every
 * candidate failed). Either way the unit comes back at most once.
 */
function refundOnFailure(req, res, bucket) {
  let refunded = false;
  // The unit was spent on today's counter; a failure after midnight UTC gives nothing back.
  const day = req.ctx?.dataDir ? readUsage(req.ctx.dataDir).day : undefined;
  const refund = () => {
    if (refunded) return;
    refunded = true;
    refundQuota(req.ctx, bucket, 1, { day });
  };
  res.locals.refundQuota = refund;
  // Every response goes through writeHead (res.json and res.end call it implicitly).
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadRefundingFailures(statusCode, ...rest) {
    if (Number(statusCode) >= 400) refund();
    return writeHead.call(this, statusCode, ...rest);
  };
}

/**
 * Middleware factory. Mount AFTER withUserScope; see consumeQuota for the
 * counting rules.
 *
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 * @param {{ skip?: (req: object) => boolean, refundOnFailure?: boolean }} [options]
 *   `skip`: requests on the router that do no billable work (a cancel), so they never
 *   spend or need quota. `refundOnFailure`: give the unit back when the request fails
 *   (see refundOnFailure()), for routers whose failures cost nothing, like TTS (#120).
 */
export function quota(bucket, { skip, refundOnFailure: refundsFailures = false } = {}) {
  return function quotaCheck(req, res, next) {
    // Reads never spend budget: every GET on the quota-mounted routers is a
    // status/list read, and charging them let a polling client (e.g. the MCP
    // jobs_wait tool) drain the bucket and 429 its own render.
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (typeof skip === "function" && skip(req)) return next();
    const outcome = consumeQuota(req?.ctx, bucket);
    if (!outcome.ok) return res.status(outcome.status).json(outcome.body);
    if (refundsFailures) refundOnFailure(req, res, bucket);
    next();
  };
}

/**
 * Read-only helper exposed at /api/billing/usage so the UI can render a
 * progress bar without re-implementing the bucket logic.
 */
export function describeUsage(req) {
  const ctx = req?.ctx;
  if (!ctx) return null;
  const plan = ctx.plan;
  const limits = QUOTAS[plan] || QUOTAS.free;
  const { day, counts } = readUsage(ctx.dataDir);
  const buckets = {};
  for (const key of Object.keys(limits)) {
    const limit = limits[key];
    const used = Number(counts[key] || 0);
    buckets[key] = {
      used,
      limit,
      unlimited: limit === -1,
      remaining: limit === -1 ? null : Math.max(0, limit - used),
    };
  }
  return { day, plan, buckets };
}
