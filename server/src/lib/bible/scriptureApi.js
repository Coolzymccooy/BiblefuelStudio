/**
 * Verse text fetcher with provider routing and on-disk cache.
 *
 * Two providers, picked by translation:
 *   - api.bible (scripture.api.bible) — for copyrighted modern translations
 *     (NIV, NKJV, NLT). Requires SCRIPTURE_API_BIBLE_KEY. Free tier is generous.
 *   - bible-api.com — for public domain translations (KJV, WEB, ASV, BBE, YLT).
 *     No API key needed. Always available as a fallback.
 *
 * Both providers normalize into the same internal verse shape so callers
 * never branch on provider.
 *
 * Cache: disk-backed JSON keyed by `<translation>:<canonical-reference>`,
 * 14-day TTL, plus a memory mirror. Verse text doesn't change; cache hard.
 */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { DATA_DIR } from "../paths.js";
import { normalizeReference, buildApiBiblePassageId } from "./bibleReference.js";

const CACHE_DIR = path.join(DATA_DIR, "bibleCache");
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/** @type {Map<string, { savedAt: number, verses: BibleVerse[] }>} */
const memoryCache = new Map();

/** @typedef {{ book: string, chapter: number, verse: number, text: string }} BibleVerse */

/**
 * Translation registry. Each entry says which provider serves it and any
 * provider-specific id.
 *
 * `apibibleId` values are the Bible IDs from scripture.api.bible. The three
 * IDs below match the active free-tier translations on the lumina-presenter
 * account; they were verified working as of 2026-05.
 */
const TRANSLATIONS = Object.freeze({
  // Public domain — bible-api.com
  kjv: { code: "kjv", label: "King James Version",       provider: "bible-api", publicDomain: true  },
  web: { code: "web", label: "World English Bible",      provider: "bible-api", publicDomain: true  },
  asv: { code: "asv", label: "American Standard Version", provider: "bible-api", publicDomain: true },
  bbe: { code: "bbe", label: "Bible in Basic English",    provider: "bible-api", publicDomain: true },
  ylt: { code: "ylt", label: "Young's Literal Translation", provider: "bible-api", publicDomain: true },

  // Copyrighted — api.bible (requires SCRIPTURE_API_BIBLE_KEY)
  niv:  { code: "niv",  label: "New International Version", provider: "api-bible", apibibleId: "78a9f6124f344018-01", publicDomain: false },
  nkjv: { code: "nkjv", label: "New King James Version",    provider: "api-bible", apibibleId: "63097d2a0a2f7db3-01", publicDomain: false },
  nlt:  { code: "nlt",  label: "New Living Translation",    provider: "api-bible", apibibleId: "65eec8e0b60e656b-01", publicDomain: false },
});

const FALLBACK_TRANSLATION = "kjv";

/**
 * Returns the catalog of translations safe to expose over HTTP.
 * Hides provider details that aren't useful to the client.
 *
 * @returns {Array<{ code: string, label: string, requiresApiKey: boolean }>}
 */
export function listTranslations() {
  return Object.values(TRANSLATIONS).map((t) => ({
    code: t.code,
    label: t.label,
    requiresApiKey: t.provider === "api-bible",
  }));
}

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isKnownTranslation(code) {
  const key = String(code || "").trim().toLowerCase();
  return Boolean(TRANSLATIONS[key]);
}

/**
 * Whether the api.bible provider is configured. If false, copyrighted
 * translations fall back to KJV via bible-api.com.
 *
 * @returns {boolean}
 */
export function isApiBibleConfigured() {
  const key = String(process.env.SCRIPTURE_API_BIBLE_KEY || "").trim();
  return key.length > 0;
}

/**
 * @typedef {object} VerseLookupResult
 * @property {boolean} ok
 * @property {string} translation
 * @property {string} canonical
 * @property {BibleVerse[]} verses
 * @property {"cache" | "api-bible" | "bible-api"} source
 * @property {string} [warning]
 */

/**
 * Fetch verse text for a reference + translation.
 *
 * - Caches aggressively (memory + disk, 14-day TTL).
 * - Routes to api.bible or bible-api.com based on translation registry.
 * - Falls back to KJV (bible-api.com) if api.bible isn't configured or fails.
 *
 * @param {string} reference - free-form, e.g. "John 3:16", "1 Cor 13:4-7"
 * @param {string} translation - translation code, e.g. "kjv", "niv"
 * @returns {Promise<VerseLookupResult>}
 */
export async function lookupVerses(reference, translation) {
  const parsed = normalizeReference(reference);
  if (!parsed) {
    throw new Error(`Could not parse reference: ${reference}`);
  }

  const translationKey = String(translation || FALLBACK_TRANSLATION).trim().toLowerCase();
  const entry = TRANSLATIONS[translationKey] || TRANSLATIONS[FALLBACK_TRANSLATION];

  const cached = readCache(entry.code, parsed.canonical);
  if (cached?.length) {
    return {
      ok: true,
      translation: entry.code,
      canonical: parsed.canonical,
      verses: cached,
      source: "cache",
    };
  }

  // Provider selection with safe fallback chain.
  if (entry.provider === "api-bible") {
    if (isApiBibleConfigured()) {
      try {
        const verses = await fetchFromApiBible(parsed, entry);
        if (verses.length) {
          writeCache(entry.code, parsed.canonical, verses);
          return {
            ok: true,
            translation: entry.code,
            canonical: parsed.canonical,
            verses,
            source: "api-bible",
          };
        }
      } catch (err) {
        console.warn(`[BIBLE] api.bible lookup failed (${entry.code} ${parsed.canonical}):`, err?.message || err);
      }
    }
    // Fall through to KJV via bible-api.com so the caller always gets text.
    const fallback = await fetchFromBibleApi(parsed, TRANSLATIONS[FALLBACK_TRANSLATION]);
    if (fallback.length) {
      writeCache(FALLBACK_TRANSLATION, parsed.canonical, fallback);
      return {
        ok: true,
        translation: FALLBACK_TRANSLATION,
        canonical: parsed.canonical,
        verses: fallback,
        source: "bible-api",
        warning: isApiBibleConfigured()
          ? `${entry.code.toUpperCase()} unavailable upstream; served KJV.`
          : `SCRIPTURE_API_BIBLE_KEY not set; ${entry.code.toUpperCase()} unavailable, served KJV.`,
      };
    }
    return { ok: false, translation: entry.code, canonical: parsed.canonical, verses: [], source: "bible-api" };
  }

  // Public domain path.
  const verses = await fetchFromBibleApi(parsed, entry);
  if (verses.length) {
    writeCache(entry.code, parsed.canonical, verses);
    return {
      ok: true,
      translation: entry.code,
      canonical: parsed.canonical,
      verses,
      source: "bible-api",
    };
  }
  return { ok: false, translation: entry.code, canonical: parsed.canonical, verses: [], source: "bible-api" };
}

// ───────── api.bible provider ─────────

/**
 * @param {import("./bibleReference.js").ParsedReference} ref
 * @param {{ code: string, apibibleId: string }} entry
 * @returns {Promise<BibleVerse[]>}
 */
async function fetchFromApiBible(ref, entry) {
  const apiKey = String(process.env.SCRIPTURE_API_BIBLE_KEY || "").trim();
  if (!apiKey) throw new Error("SCRIPTURE_API_BIBLE_KEY not set");
  if (!entry.apibibleId) throw new Error(`Missing api.bible id for ${entry.code}`);

  const passageId = buildApiBiblePassageId(ref);
  const url = new URL(`https://api.scripture.api.bible/v1/bibles/${entry.apibibleId}/passages/${passageId}`);
  url.searchParams.set("content-type", "text");
  url.searchParams.set("include-notes", "false");
  url.searchParams.set("include-titles", "false");
  url.searchParams.set("include-chapter-numbers", "false");
  url.searchParams.set("include-verse-numbers", "true");
  url.searchParams.set("include-verse-spans", "false");

  const resp = await fetch(url.toString(), {
    headers: { "api-key": apiKey, "Accept": "application/json" },
    // node-fetch supports AbortSignal.timeout in recent versions; fall back to manual.
  });

  if (!resp.ok) {
    const status = resp.status;
    if (status === 401 || status === 403) throw new Error("api.bible authentication failed");
    if (status === 404) return [];
    const body = await resp.text().catch(() => "");
    throw new Error(`api.bible ${status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = String(data?.data?.content || "").trim();
  if (!content) return [];

  return parseApiBibleText(content, ref);
}

/**
 * api.bible returns "text" content with per-verse markers like
 *   "     [16] For God so loved...     [17] For God did not send..."
 * Split on the bracketed verse numbers; each chunk is one verse.
 *
 * @param {string} content
 * @param {import("./bibleReference.js").ParsedReference} ref
 * @returns {BibleVerse[]}
 */
function parseApiBibleText(content, ref) {
  // Collapse whitespace, then split on "[N]" markers.
  const cleaned = content.replace(/\s+/g, " ").trim();
  const matches = cleaned.split(/\[(\d+)\]/).slice(1); // [num, text, num, text, ...]
  if (!matches.length) {
    // No verse markers — single passage (e.g. entire chapter request without numbers).
    // Treat as one logical verse keyed by verseFrom or chapter:1.
    return [{
      book: ref.book.name,
      chapter: ref.chapter,
      verse: ref.verseFrom || 1,
      text: cleaned,
    }];
  }

  /** @type {BibleVerse[]} */
  const verses = [];
  for (let i = 0; i < matches.length; i += 2) {
    const num = Number(matches[i]);
    const text = String(matches[i + 1] || "").trim();
    if (!Number.isFinite(num) || !text) continue;
    verses.push({
      book: ref.book.name,
      chapter: ref.chapter,
      verse: num,
      text,
    });
  }
  return verses;
}

// ───────── bible-api.com provider ─────────

/**
 * @param {import("./bibleReference.js").ParsedReference} ref
 * @param {{ code: string }} entry
 * @returns {Promise<BibleVerse[]>}
 */
async function fetchFromBibleApi(ref, entry) {
  const url = `https://bible-api.com/${encodeURIComponent(ref.canonical)}?translation=${encodeURIComponent(entry.code)}`;
  const resp = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`bible-api.com ${resp.status}`);
  }
  const data = await resp.json();
  if (!Array.isArray(data?.verses)) return [];
  return data.verses.map((v) => ({
    book: String(v?.book_name || ref.book.name),
    chapter: Number(v?.chapter || ref.chapter),
    verse: Number(v?.verse || ref.verseFrom || 1),
    text: String(v?.text || "").trim(),
  })).filter((v) => v.text);
}

// ───────── Cache ─────────

function cacheKey(translation, canonical) {
  return `${String(translation || "").toLowerCase()}::${String(canonical || "").toLowerCase()}`;
}

function cacheFile(translation, canonical) {
  // Sanitize for filename: replace non-alphanumerics with underscore.
  const safe = cacheKey(translation, canonical).replace(/[^a-z0-9]+/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

/** @returns {BibleVerse[] | null} */
function readCache(translation, canonical) {
  const key = cacheKey(translation, canonical);
  const mem = memoryCache.get(key);
  if (mem && (Date.now() - mem.savedAt) <= CACHE_TTL_MS) return mem.verses;

  const file = cacheFile(translation, canonical);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    const savedAt = Number(parsed?.savedAt || 0);
    const verses = Array.isArray(parsed?.verses) ? parsed.verses : [];
    if (!savedAt || !verses.length || (Date.now() - savedAt) > CACHE_TTL_MS) return null;
    memoryCache.set(key, { savedAt, verses });
    return verses;
  } catch {
    return null;
  }
}

function writeCache(translation, canonical, verses) {
  if (!Array.isArray(verses) || !verses.length) return;
  const key = cacheKey(translation, canonical);
  const savedAt = Date.now();
  memoryCache.set(key, { savedAt, verses });
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(translation, canonical), JSON.stringify({ savedAt, verses }, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[BIBLE] cache write failed for ${key}:`, err?.message || err);
  }
}
