// Builds the caption shipped to social-media destinations (TikTok, Instagram,
// YouTube, Buffer). Formats the script so the hook lands "above the fold" on
// every platform, scripture + reference read as a block, and hashtags sit at
// the bottom for algorithmic reach without crowding the body.
//
// Length budget defaults to 2100 chars — under Instagram Reels' 2200 limit
// and well under TikTok's current ~4000. YouTube descriptions get the full
// 5000-char allowance via opts.maxChars when called from that path.
//
// When trimming is required:
//   1. If body+tags exceeds the budget, drop tags entirely first.
//   2. If body alone still exceeds, soft-truncate at the last word boundary
//      and append an ellipsis so the cut isn't mid-word.

const DEFAULT_MAX_CHARS = 2100;

function normalizeTag(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s.startsWith("#") ? s : `#${s}`;
}

function softTruncate(text, max) {
  const t = String(text || "");
  if (t.length <= max) return t;
  const slice = t.slice(0, Math.max(1, max));
  const lastSpace = slice.lastIndexOf(" ");
  // Only honour the word boundary if it's not extremely early (avoids
  // truncating to a 3-character first-word).
  if (lastSpace > max * 0.6) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}

/**
 * @param {{ hook?: string, verse?: string, reference?: string, reflection?: string, cta?: string, hashtags?: string[] }} script
 * @param {{ maxChars?: number, includeHashtags?: boolean }} [opts]
 * @returns {string}
 */
export function buildSocialCaption(script, opts = {}) {
  if (!script || typeof script !== "object") return "";
  const maxChars = Math.max(100, Number(opts.maxChars) || DEFAULT_MAX_CHARS);
  const includeHashtags = opts.includeHashtags !== false;

  const sections = [];
  if (script.hook) sections.push(String(script.hook).trim());

  const verseParts = [];
  if (script.verse) verseParts.push(String(script.verse).trim());
  if (script.reference) verseParts.push(`— ${String(script.reference).trim()}`);
  if (verseParts.length) sections.push(verseParts.join("\n"));

  if (script.reflection) sections.push(String(script.reflection).trim());
  if (script.cta) sections.push(String(script.cta).trim());

  const body = sections.filter(Boolean).join("\n\n");

  const tags = includeHashtags && Array.isArray(script.hashtags)
    ? Array.from(new Set(script.hashtags.map(normalizeTag).filter(Boolean)))
    : [];
  const tagLine = tags.length > 0 ? tags.join(" ") : "";

  const full = tagLine ? `${body}\n\n${tagLine}` : body;
  if (full.length <= maxChars) return full;

  if (body.length <= maxChars) return body;

  return `${softTruncate(body, maxChars - 1)}…`;
}

export const SOCIAL_CAPTION_DEFAULTS = { maxChars: DEFAULT_MAX_CHARS };
