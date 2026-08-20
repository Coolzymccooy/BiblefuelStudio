// Canonical background categories. Used for tagging Library items and for
// matching scripts to mood-appropriate visuals during auto-publish campaigns.
export const CATEGORIES = [
  "celebration",
  "sunshine",
  "faith",
  "worship",
  "prayer",
  "sermon",
  "nature",
  "abstract",
  "peace",
  "hope",
  "sky",
  "ocean",
  "mountain",
  "candle",
  "light",
  "stars",
  "urban",
];

// Keyword → categories map. Used in two places:
// 1. classifyScript(): pick the right backgrounds based on script content.
// 2. classifySearchQuery(): auto-tag a Pexels download by its search term.
//
// Keep entries lowercased. Match is substring-based.
const KEYWORD_MAP = {
  // Themes
  anxiety: ["peace", "candle", "light"],
  fear: ["peace", "light", "sky"],
  worry: ["peace", "nature"],
  rest: ["peace", "nature", "ocean"],
  calm: ["peace", "ocean", "nature"],
  hope: ["hope", "sunshine", "sky"],
  joy: ["celebration", "sunshine"],
  celebrate: ["celebration"],
  thanks: ["celebration", "sunshine"],
  praise: ["worship", "celebration"],
  worship: ["worship", "candle", "light"],
  pray: ["prayer", "candle"],
  prayer: ["prayer", "candle"],
  faithful: ["faith", "light"],
  faith: ["faith", "mountain", "light"],
  trust: ["faith", "mountain"],
  god: ["faith", "light"],
  jesus: ["faith", "light"],
  spirit: ["sky", "light"],
  holy: ["light", "candle"],
  glory: ["light", "sunshine"],
  morning: ["sunshine", "sky"],
  light: ["light", "sunshine"],
  dark: ["candle", "stars"],
  night: ["stars", "candle"],
  star: ["stars", "sky"],
  weary: ["peace", "mountain"],
  tired: ["peace", "ocean"],
  strength: ["mountain", "sunshine"],
  strong: ["mountain"],
  rock: ["mountain"],
  mountain: ["mountain"],
  sea: ["ocean"],
  ocean: ["ocean", "nature"],
  water: ["ocean", "nature"],
  storm: ["nature", "ocean"],
  // Pexels-flavoured visual hints
  sunrise: ["sunshine", "hope", "sky"],
  sunset: ["sunshine", "sky", "peace"],
  sun: ["sunshine", "sky"],
  cloud: ["sky", "peace"],
  sky: ["sky"],
  forest: ["nature"],
  tree: ["nature"],
  field: ["nature"],
  flower: ["nature", "celebration"],
  candle: ["candle", "prayer", "worship"],
  fire: ["light", "worship"],
  cross: ["faith", "worship"],
  church: ["worship", "sermon"],
  abstract: ["abstract"],
  texture: ["abstract"],
  city: ["urban"],
};

function tokenize(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/**
 * Suggest categories based on a free-text string. Used for both script
 * classification and Pexels search-query auto-tagging.
 */
export function classifyText(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const buckets = new Map();
  for (const tok of tokens) {
    const cats = KEYWORD_MAP[tok];
    if (!cats) continue;
    for (const c of cats) buckets.set(c, (buckets.get(c) || 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}

/**
 * Classify a script by its content. Returns categories sorted by relevance.
 * Includes the hook (heaviest weight), verse, reference, reflection, CTA.
 */
export function classifyScript(script) {
  if (!script || typeof script !== "object") return [];
  const text = [
    script.hook,
    script.hook, // double weight: hooks are most thematic
    script.verse,
    script.reference,
    script.reflection,
    script.cta,
  ].filter(Boolean).join(" ");
  return classifyText(text);
}

/**
 * Auto-tag a Pexels (or other) search query. Returns up to 3 categories so
 * downloads land in the most relevant buckets without being over-tagged.
 */
export function classifySearchQuery(query) {
  return classifyText(query).slice(0, 3);
}

/**
 * Choose the best Library background for a given script.
 *
 * Priority order:
 * 1. Items whose `categories` overlap with the script's classified categories.
 * 2. Items whose JSON blob matches a free-text `backgroundQuery` (legacy).
 * 3. Any item (random).
 *
 * Random selection within the highest-priority tier prevents predictable
 * sequences while still respecting mood.
 */
/**
 * Like {@link pickBestBackground}, but reports HOW the pick was made.
 *
 * The plain picker falls back to a random item when nothing matches the script's
 * mood, and the caller cannot tell a mood match from that random pick. That is
 * how a verse about anxiety ends up over a celebration clip. This variant
 * surfaces the match quality so callers can prefer AI generation over a
 * mismatched library item.
 *
 * @param {any[]} pool
 * @param {{ script?: object, backgroundQuery?: string }} opts
 * @returns {{ item: any|null, quality: "mood"|"query"|"random"|"empty" }}
 */
export function pickBackgroundWithQuality(pool, { script, backgroundQuery } = {}) {
  const items = Array.isArray(pool) ? pool : [];
  if (items.length === 0) return { item: null, quality: "empty" };

  const scriptCats = script ? classifyScript(script) : [];
  if (scriptCats.length > 0) {
    const matched = items.filter((it) => {
      const cats = Array.isArray(it?.categories) ? it.categories : [];
      return cats.some((c) => scriptCats.includes(String(c).toLowerCase()));
    });
    if (matched.length > 0) {
      return { item: matched[Math.floor(Math.random() * matched.length)], quality: "mood" };
    }
  }

  if (backgroundQuery) {
    const needle = String(backgroundQuery).toLowerCase();
    const matched = items.filter((it) => JSON.stringify(it).toLowerCase().includes(needle));
    if (matched.length > 0) {
      return { item: matched[Math.floor(Math.random() * matched.length)], quality: "query" };
    }
  }

  return { item: items[Math.floor(Math.random() * items.length)], quality: "random" };
}

export function pickBestBackground(pool, { script, backgroundQuery } = {}) {
  const items = Array.isArray(pool) ? pool : [];
  if (items.length === 0) return null;

  const scriptCats = script ? classifyScript(script) : [];
  if (scriptCats.length > 0) {
    const matched = items.filter((it) => {
      const cats = Array.isArray(it?.categories) ? it.categories : [];
      return cats.some((c) => scriptCats.includes(String(c).toLowerCase()));
    });
    if (matched.length > 0) {
      return matched[Math.floor(Math.random() * matched.length)];
    }
  }

  if (backgroundQuery) {
    const needle = String(backgroundQuery).toLowerCase();
    const matched = items.filter((it) => JSON.stringify(it).toLowerCase().includes(needle));
    if (matched.length > 0) {
      return matched[Math.floor(Math.random() * matched.length)];
    }
  }

  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Normalize a categories list: lowercase, dedup, drop empties, clamp to the
 * canonical set when possible. Unknown free-form tags are still allowed
 * (user might add custom ones) but lowercased + deduped.
 */
export function normalizeCategories(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) continue;
    out.push(s);
  }
  return uniq(out).slice(0, 12);
}
