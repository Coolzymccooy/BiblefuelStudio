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
 * Middleware factory. Mount AFTER withUserScope. Increments the counter
 * BEFORE the handler runs so over-quota requests are rejected before we
 * burn the operator's API budget; the cost of false-positive increments
 * (e.g. handler 500s after the bump) is one ghost-tick per error.
 *
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 */
export function quota(bucket) {
  return function quotaCheck(req, res, next) {
    const ctx = req?.ctx;
    if (!ctx) {
      return res.status(401).json({ ok: false, error: "Missing user context" });
    }
    const plan = ctx.plan;
    const limits = QUOTAS[plan] || QUOTAS.free;
    const limit = limits[bucket];

    // Unlimited tier — skip counting (no value to tracking; super-admin is
    // also the operator and never gates herself).
    if (limit === -1) return next();

    const { counts } = readUsage(ctx.dataDir);
    const used = Number(counts[bucket] || 0);
    if (used >= limit) {
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        bucket,
        used,
        limit,
        plan,
        hint: "Upgrade to Premium for unlimited generation, or come back tomorrow — quota resets at midnight UTC.",
      });
    }

    incrementUsage(ctx.dataDir, bucket);
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
