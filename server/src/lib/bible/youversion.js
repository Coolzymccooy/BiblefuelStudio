/**
 * YouVersion (bible.com) deep-link builder.
 *
 * YouVersion canonical URL format (verified 2026-05):
 *   https://www.bible.com/bible/<versionId>/<USFM>.<chapter>[.<verseStart>][-<verseEnd>].<versionCode>
 *
 * Examples:
 *   John 3:16 NIV       -> https://www.bible.com/bible/111/JHN.3.16.NIV
 *   John 3:16-17 NIV    -> https://www.bible.com/bible/111/JHN.3.16-17.NIV
 *   John 3 KJV          -> https://www.bible.com/bible/1/JHN.3.KJV
 *
 * Why these links matter:
 *  - Authoritative source for the verse (vs. a paraphrase) — builds trust.
 *  - Drives traffic to YouVersion, the #1 Bible app — creates partnership
 *    leverage even without an API key.
 *  - Free. No approval required to construct these URLs.
 *
 * Pure module — no I/O.
 */

/**
 * @typedef {{ id: number, code: string, label: string }} YouVersionTranslation
 *
 * `id` is YouVersion's internal bible version id (used in URL path).
 * `code` is the suffix YouVersion appends to the slug.
 * `label` is the display name.
 */

/**
 * Whitelist of translations we expose. Sourced from YouVersion's public
 * version registry; the IDs are stable and have been the same for years.
 *
 * @type {Readonly<Record<string, YouVersionTranslation>>}
 */
export const YOUVERSION_TRANSLATIONS = Object.freeze({
  kjv:  { id: 1,    code: "KJV",  label: "King James Version" },
  niv:  { id: 111,  code: "NIV",  label: "New International Version" },
  nkjv: { id: 114,  code: "NKJV", label: "New King James Version" },
  esv:  { id: 59,   code: "ESV",  label: "English Standard Version" },
  nlt:  { id: 116,  code: "NLT",  label: "New Living Translation" },
  amp:  { id: 1588, code: "AMP",  label: "Amplified Bible" },
  msg:  { id: 97,   code: "MSG",  label: "The Message" },
  csb:  { id: 1713, code: "CSB",  label: "Christian Standard Bible" },
  web:  { id: 206,  code: "WEB",  label: "World English Bible" },
  asv:  { id: 12,   code: "ASV",  label: "American Standard Version" },
});

const DEFAULT_TRANSLATION_KEY = "kjv";

/** @typedef {import("./bibleReference.js").ParsedReference} ParsedReference */

/**
 * Resolve a free-form translation string (case-insensitive) to a known entry.
 * Falls back to KJV if unknown so links never break.
 *
 * @param {string | null | undefined} input
 * @returns {YouVersionTranslation}
 */
export function resolveYouVersionTranslation(input) {
  const key = String(input || "").trim().toLowerCase();
  if (key && YOUVERSION_TRANSLATIONS[key]) return YOUVERSION_TRANSLATIONS[key];
  return YOUVERSION_TRANSLATIONS[DEFAULT_TRANSLATION_KEY];
}

/**
 * Build a YouVersion (bible.com) deep link for a parsed reference.
 *
 * @param {ParsedReference} ref
 * @param {string} [translation] - translation key (kjv, niv, nkjv, esv, nlt, ...)
 * @returns {string}
 */
export function buildYouVersionUrl(ref, translation) {
  if (!ref || !ref.book) return "";
  const t = resolveYouVersionTranslation(translation);
  const usfm = ref.book.usfm;
  const chapter = Number(ref.chapter);
  const verseFrom = ref.verseFrom == null ? null : Number(ref.verseFrom);
  const verseTo = ref.verseTo == null ? null : Number(ref.verseTo);

  let slug = `${usfm}.${chapter}`;
  if (verseFrom != null) {
    slug += `.${verseFrom}`;
    if (verseTo != null && verseTo > verseFrom) {
      slug += `-${verseTo}`;
    }
  }
  return `https://www.bible.com/bible/${t.id}/${slug}.${t.code}`;
}

/**
 * List the translations exposed to UI consumers.
 * @returns {Array<{ key: string, code: string, label: string }>}
 */
export function listYouVersionTranslations() {
  return Object.entries(YOUVERSION_TRANSLATIONS).map(([key, value]) => ({
    key,
    code: value.code,
    label: value.label,
  }));
}
