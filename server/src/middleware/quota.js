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
 * @returns {{ ok: true } | { ok: false, status: number, body: object }}
 */
export function consumeQuota(ctx, bucket) {
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
  if (used >= limit) {
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
        hint: "Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.",
      },
    };
  }

  incrementUsage(ctx.dataDir, bucket);
  return { ok: true };
}

/**
 * Middleware factory. Mount AFTER withUserScope; see consumeQuota for the
 * counting rules.
 *
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 */
export function quota(bucket) {
  return function quotaCheck(req, res, next) {
    // Reads never spend budget: every GET on the quota-mounted routers is a
    // status/list read, and charging them let a polling client (e.g. the MCP
    // jobs_wait tool) drain the bucket and 429 its own render.
    if (req.method === "GET" || req.method === "HEAD") return next();
    const outcome = consumeQuota(req?.ctx, bucket);
    if (!outcome.ok) return res.status(outcome.status).json(outcome.body);
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
