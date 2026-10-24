import { CAP_BUCKETS, type CapBucket, type CapUsage, type Caps } from '../../lib/agentKeysApi';

/** How each daily cap bucket is named on the card. */
export const BUCKET_LABELS: Record<CapBucket, string> = {
  renders: 'Renders',
  aiVideoUsd: 'AI video ($)',
  images: 'Images',
  tts: 'Voice (TTS)',
  publishes: 'Publishes',
  imports: 'Imports',
};

/** Whole counts as they are; the dollar bucket always shows cents. */
export function formatAmount(bucket: CapBucket, value: number): string {
  if (bucket === 'aiVideoUsd') return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A key's limit per bucket: its own cap where set, never above the server ceiling (as caps.js effectiveCaps). */
export function effectiveLimits(caps: Partial<Caps> | undefined, ceilings: Caps): Caps {
  const out = {} as Caps;
  for (const bucket of CAP_BUCKETS) {
    const own = caps?.[bucket];
    const usable = typeof own === 'number' && Number.isFinite(own) && own >= 0;
    out[bucket] = usable ? Math.min(ceilings[bucket], own) : ceilings[bucket];
  }
  return out;
}

/** Today's use re-read against new limits, so the row shows them without a reload. */
export function withLimits(
  usage: Record<CapBucket, CapUsage> | undefined,
  limits: Caps,
): Record<CapBucket, CapUsage> | undefined {
  if (!usage) return usage;
  const out = {} as Record<CapBucket, CapUsage>;
  for (const bucket of CAP_BUCKETS) {
    const used = usage[bucket]?.used ?? 0;
    out[bucket] = { used, limit: limits[bucket], remaining: Math.max(0, limits[bucket] - used) };
  }
  return out;
}
