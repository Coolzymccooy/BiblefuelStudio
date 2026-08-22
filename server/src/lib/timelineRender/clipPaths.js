/**
 * Where a timeline clip's media actually lives.
 *
 * The client's project model stores media on the ASSET (`plan.assets[id].path`)
 * and has clips reference it by `assetId`. The renderer only ever read
 * `clip.path`, which the UI never sets - so every clip added through the
 * interface was filtered out before rendering. Images and motion backgrounds
 * picked from the library rendered as nothing at all, with no error.
 *
 * Older/hand-built plans do put a path on the clip, so that still wins.
 */

/**
 * @param {object} clip
 * @param {{assets?: Record<string, any>}} plan
 * @returns {string|null}
 */
export function clipMediaPath(clip, plan) {
  if (!clip) return null;
  if (clip.path) return clip.path;

  const asset = plan?.assets?.[clip.assetId];
  if (!asset) return null;

  // A ready proxy is the cheaper input; that is what proxies are for.
  if (asset.proxyPath && asset.proxyStatus === 'ready') return asset.proxyPath;
  return asset.path || null;
}

/**
 * Clips on `kind` that have resolvable media, each carrying the resolved path
 * as `resolvedMediaPath` so callers do not have to look it up twice.
 */
export function clipsWithMedia(plan, kind) {
  const clips = plan?.tracks?.find((t) => t.kind === kind)?.clips || [];
  return clips
    .map((clip) => {
      const p = clipMediaPath(clip, plan);
      return p ? { ...clip, resolvedMediaPath: p } : null;
    })
    .filter(Boolean);
}
