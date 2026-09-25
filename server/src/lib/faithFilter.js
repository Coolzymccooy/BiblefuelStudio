// Faith-appropriateness filter for background media.
//
// @Biblefuel is a Christian theme page. Stock libraries (Pexels/Pixabay) return
// mosques, temples, prayer beads, and other non-Christian religious imagery for
// perfectly innocent queries like "prayer", "worship", "faith" or "meditation" —
// so without an explicit filter a scheduled post can pair a Bible verse with a
// mosque. That is a serious, unrecoverable publishing mistake: it misrepresents
// the page's faith and is visible to every viewer before anyone can pull it.
//
// DESIGN NOTES
//
// This filter is deliberately CONSERVATIVE and one-directional: it excludes
// terms that are distinctly non-Christian religious markers. It does NOT try to
// verify that an image IS Christian — that is not decidable from a filename or
// a search term, and pretending otherwise would give false confidence.
//
// It matches on TEXT ONLY (search query, filename, tags). It cannot see pixels.
// An unlabelled mosque photo will pass. This is a meaningful reduction in risk,
// not a guarantee, and callers should not describe it to users as one.
//
// Ambiguous words are intentionally NOT blocked: "temple" (anatomy, Temple in
// Jerusalem — deeply Christian/biblical), "prayer" and "worship" (shared across
// faiths but core Christian vocabulary), "candle", "incense", "robe". Blocking
// those would gut the legitimate library — the operator's own tagged library
// leans on "prayer" and "worship" heavily.

// Distinctly non-Christian religious markers. Matched as whole words on
// normalized text so "islam" does not fire on "islamic-studies" being absent,
// and — importantly — "mosque" never fires inside an unrelated longer word.
const EXCLUDED_TERMS = Object.freeze([
  // Islam
  "mosque", "masjid", "islam", "islamic", "muslim", "quran", "koran", "ramadan",
  "eid", "hijab", "niqab", "burqa", "minaret", "kaaba", "mecca", "medina",
  "imam", "muezzin", "adhan", "salah", "sujud", "tasbih", "misbaha", "allah",
  // Hinduism
  "hindu", "hinduism", "mandir", "diwali", "holi", "ganesh", "ganesha",
  "shiva", "vishnu", "krishna", "brahma", "puja", "aarti", "bindi", "om",
  "hare", "sadhu", "namaste",
  // Buddhism
  "buddha", "buddhist", "buddhism", "stupa", "pagoda", "dharma", "zen",
  "monk", "sangha", "bodhi", "mala", "thangka",
  // Sikhism
  "sikh", "sikhism", "gurdwara", "guru", "turban", "khanda", "langar",
  // Judaism (distinct-practice markers; shared scripture is NOT blocked)
  "synagogue", "torah", "menorah", "hanukkah", "chanukah", "kippah", "yarmulke",
  "shabbat", "rabbi", "bar mitzvah", "bat mitzvah", "tefillin", "hebrew school",
  // Other traditions / occult / new-age
  "shinto", "shrine", "taoist", "taoism", "confucian", "jain", "bahai",
  "wicca", "wiccan", "pagan", "occult", "tarot", "zodiac", "astrology",
  "horoscope", "chakra", "yoga", "meditation retreat", "mandala", "voodoo",
  "shaman", "witchcraft", "seance", "ouija",
]);

/**
 * Normalize text for matching: lowercase, punctuation → spaces, collapse runs.
 * Keeps word boundaries intact so whole-word matching stays reliable.
 * @param {string} value
 * @returns {string} normalized text, space-padded for boundary matching
 */
function normalize(value) {
  const s = String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${s} `;
}

/**
 * Every text signal attached to a library item, joined for one scan.
 * @param {object} item
 * @returns {string}
 */
function itemText(item) {
  if (!item || typeof item !== "object") return String(item == null ? "" : item);
  const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
  return [item.query, item.title, item.name, item.filename, item.path, item.id, tags]
    .filter(Boolean)
    .join(" ");
}

/**
 * Check text for non-Christian religious markers.
 *
 * @param {string} text
 * @returns {{ blocked: boolean, term: string }} the FIRST matching term, for logging
 */
export function screenText(text) {
  const haystack = normalize(text);
  if (haystack.trim() === "") return { blocked: false, term: "" };
  for (const term of EXCLUDED_TERMS) {
    if (haystack.includes(` ${term} `)) return { blocked: true, term };
  }
  return { blocked: false, term: "" };
}

/**
 * True when a library item carries no non-Christian religious marker.
 * @param {object|string} item
 * @returns {boolean}
 */
export function isFaithAppropriate(item) {
  return !screenText(itemText(item)).blocked;
}

/**
 * Remove non-Christian religious imagery from a background pool.
 *
 * Returns the removed items too, so callers can log what was dropped — a
 * silent filter that quietly empties a pool is very hard to debug.
 *
 * @param {Array<object>} pool
 * @returns {{ kept: Array<object>, removed: Array<{item: object, term: string}> }}
 */
export function filterPool(pool) {
  const list = Array.isArray(pool) ? pool : [];
  const kept = [];
  const removed = [];
  for (const item of list) {
    const verdict = screenText(itemText(item));
    if (verdict.blocked) removed.push({ item, term: verdict.term });
    else kept.push(item);
  }
  return { kept, removed };
}

/**
 * Make a stock-library search query safer at the source.
 *
 * Prevention beats filtering: a query of "prayer" returns mixed-faith results,
 * whereas "christian prayer" biases the provider's own ranking. Returns null
 * when the query itself is for non-Christian imagery, so the caller can refuse
 * the search rather than sanitize it into something the user did not ask for.
 *
 * @param {string} query
 * @returns {{ ok: boolean, query: string, reason: string }}
 */
export function safeSearchQuery(query) {
  const raw = String(query || "").trim();
  if (!raw) return { ok: false, query: "", reason: "empty query" };

  const verdict = screenText(raw);
  if (verdict.blocked) {
    return { ok: false, query: raw, reason: `query requests non-Christian religious imagery ("${verdict.term}")` };
  }

  // Religious-but-shared terms benefit from a Christian qualifier so the
  // provider ranks Christian results first. Only add it when absent.
  const RELIGIOUS_AMBIGUOUS = ["prayer", "pray", "worship", "faith", "praise", "temple", "holy", "sacred", "devotion"];
  const norm = normalize(raw);
  const alreadyQualified = [" christian ", " jesus ", " christ ", " bible ", " gospel ", " church "]
    .some((q) => norm.includes(q));
  const needsQualifier = RELIGIOUS_AMBIGUOUS.some((t) => norm.includes(` ${t} `));

  if (needsQualifier && !alreadyQualified) {
    return { ok: true, query: `christian ${raw}`, reason: "added Christian qualifier to bias provider ranking" };
  }
  return { ok: true, query: raw, reason: "" };
}
