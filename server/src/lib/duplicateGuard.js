// Duplicate-post guard.
//
// The operator reposts deliberately (testing times/hashtags) AND has had
// unintended repeats slip through — the grid shows both. So this NEVER blocks:
// it reports. Blocking would break intentional reposting, and a scheduled post
// silently refusing to publish is worse than a duplicate going out.
//
// Identity is (hook + background), because that combination is what a viewer
// actually recognises as "I've seen this one". The same hook over new footage
// reads as a fresh post; the same footage under a new hook does too.

const RECENT_WINDOW = 60; // posts to compare against; older repeats read as fresh

/**
 * Stable identity for a post. Normalized so trivial differences in casing,
 * punctuation spacing, or surrounding whitespace don't read as a new post.
 * @param {{hook?: string, background?: string}} post
 * @returns {string}
 */
export function postFingerprint(post) {
  const norm = (v) => String(v || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${norm(post?.hook)}::${norm(post?.background)}`;
}

/**
 * Check a candidate post against recent history.
 *
 * @param {{hook?: string, background?: string}} candidate
 * @param {Array<{hook?: string, background?: string}>} history most-recent-first
 * @returns {{ duplicate: boolean, reason: string, fingerprint: string }}
 */
export function checkDuplicate(candidate, history) {
  const fingerprint = postFingerprint(candidate);
  const recent = Array.isArray(history) ? history.slice(0, RECENT_WINDOW) : [];

  const exact = recent.findIndex((h) => postFingerprint(h) === fingerprint);
  if (exact >= 0) {
    return {
      duplicate: true,
      reason: `Same hook and background as a post from ${exact + 1} post(s) ago`,
      fingerprint,
    };
  }

  const hookOnly = postFingerprint({ hook: candidate?.hook, background: "" });
  const hookRepeat = recent.findIndex(
    (h) => postFingerprint({ hook: h?.hook, background: "" }) === hookOnly
  );
  if (hookRepeat >= 0) {
    return {
      duplicate: false, // different footage — reads as a fresh post
      reason: `Hook reused from ${hookRepeat + 1} post(s) ago, but the background differs`,
      fingerprint,
    };
  }

  return { duplicate: false, reason: "", fingerprint };
}
