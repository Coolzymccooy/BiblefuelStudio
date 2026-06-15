/**
 * Series builder.
 *
 * Takes a Bible chapter and a target part count and produces an ordered
 * sequence of micro-segments, each carrying:
 *   - a verse range inside the chapter
 *   - the verse text (fetched ahead of time)
 *   - a publish-ready caption with continuity hooks + YouVersion link
 *
 * Each segment is then enqueued as a `campaign_auto_post` job (see
 * routes/series.js). The video render pipeline doesn't need to know it's
 * part of a series — series metadata travels on the job payload only.
 *
 * Pure module — no I/O. The caller fetches verses and constructs segments.
 */

import { normalizeReference, getChapterVerseCount } from "../bible/bibleReference.js";
import { buildYouVersionUrl } from "../bible/youversion.js";

const MIN_PARTS = 2;
const MAX_PARTS = 12;
const HOOK_WORD_COUNT = 9;
const CAPTION_MAX_LENGTH = 2000;

/**
 * @typedef {import("../bible/bibleReference.js").ParsedReference} ParsedReference
 * @typedef {import("../bible/scriptureApi.js").BibleVerse} BibleVerse
 * @typedef {object} SeriesSegment
 * @property {number} partNumber       1-indexed
 * @property {number} totalParts
 * @property {string} reference        e.g. "John 3:1-7"
 * @property {number} verseFrom
 * @property {number} verseTo
 * @property {BibleVerse[]} verses
 * @property {string} hook             short opener (first ~9 words of first verse)
 * @property {string} caption          publish-ready caption (verse text + link + cliffhanger)
 * @property {string} youVersionUrl
 *
 * @typedef {object} SeriesPlan
 * @property {string} seriesId
 * @property {string} chapterReference     e.g. "John 3"
 * @property {string} book
 * @property {number} chapter
 * @property {string} translation
 * @property {number} totalParts
 * @property {SeriesSegment[]} segments
 */

/**
 * Validate and clamp the requested part count.
 * @param {unknown} value
 * @param {number} maxVerses
 * @returns {number}
 */
export function clampPartsCount(value, maxVerses) {
  const fallback = 5;
  // Treat null/undefined as "use default". Number(null) is 0, which would
  // otherwise be clamped up to MIN_PARTS and quietly hide a missing param.
  const requested = (value === null || value === undefined) ? fallback : Number(value);
  const desired = Number.isFinite(requested) ? Math.round(requested) : fallback;
  const upperBound = Math.min(MAX_PARTS, Math.max(MIN_PARTS, maxVerses));
  return Math.min(upperBound, Math.max(MIN_PARTS, desired));
}

/**
 * Compute the verse ranges for a span of `totalVerses` verses divided into N
 * parts. Even split with the remainder distributed to earlier parts so the
 * span is fully partitioned (no orphan verses at the tail).
 *
 * `startVerse` lets the caller partition an arbitrary window inside a chapter
 * (e.g. "John 3:5-12") rather than always verse 1 onward. Returned `from`/`to`
 * are absolute verse numbers.
 *
 * @param {number} totalVerses  number of verses in the span (not the chapter)
 * @param {number} parts
 * @param {number} [startVerse=1]  first verse of the span (absolute)
 * @returns {Array<{ from: number, to: number }>}
 */
export function planVerseRanges(totalVerses, parts, startVerse = 1) {
  const t = Math.max(1, Math.round(totalVerses));
  const p = Math.max(1, Math.min(t, Math.round(parts)));
  const start = Math.max(1, Math.round(startVerse));
  const end = start + t - 1;
  const base = Math.floor(t / p);
  const extra = t - base * p;
  /** @type {Array<{ from: number, to: number }>} */
  const ranges = [];
  let cursor = start;
  for (let i = 0; i < p; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    const from = cursor;
    const to = Math.min(end, cursor + size - 1);
    ranges.push({ from, to });
    cursor = to + 1;
  }
  return ranges;
}

/**
 * First N words of a verse text, trimmed and quote-wrapped.
 * @param {string} text
 * @returns {string}
 */
function extractHook(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ").slice(0, HOOK_WORD_COUNT);
  let hook = words.join(" ").replace(/[,.;:!?]+$/, "");
  if (cleaned.split(" ").length > HOOK_WORD_COUNT) hook += "…";
  return hook;
}

/**
 * Joins verse texts into a single block, prefixing each with its number.
 * @param {BibleVerse[]} verses
 * @returns {string}
 */
function joinVerseText(verses) {
  return verses
    .map((v) => `${v.verse}. ${String(v.text || "").trim()}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the publish-ready caption for one segment.
 *
 * @param {object} args
 * @param {number} args.partNumber
 * @param {number} args.totalParts
 * @param {string} args.reference
 * @param {BibleVerse[]} args.verses
 * @param {string} args.hook
 * @param {string} args.youVersionUrl
 * @param {boolean} args.isLast
 * @returns {string}
 */
export function buildSegmentCaption({ partNumber, totalParts, reference, verses, hook, youVersionUrl, isLast }) {
  const body = joinVerseText(verses);
  const continuity = isLast
    ? "The end of the series — share if it spoke to you."
    : `Part ${partNumber + 1} drops next. Follow so you don't miss it →`;

  const headline = hook
    ? `📖 Part ${partNumber} of ${totalParts}: "${hook}"`
    : `📖 Part ${partNumber} of ${totalParts}`;

  const lines = [
    headline,
    "",
    body,
    "",
    `— ${reference}`,
    `Read on YouVersion: ${youVersionUrl}`,
    "",
    continuity,
  ];
  const caption = lines.join("\n").trim();
  if (caption.length <= CAPTION_MAX_LENGTH) return caption;
  // Trim the body if we're over the limit; keep headline + link + cliffhanger.
  const fixedLen = lines.filter((_, i) => i !== 2).join("\n").length + 1;
  const room = Math.max(80, CAPTION_MAX_LENGTH - fixedLen);
  const trimmedBody = body.slice(0, room - 1).replace(/[\s,;]+$/, "") + "…";
  return [headline, "", trimmedBody, "", `— ${reference}`, `Read on YouVersion: ${youVersionUrl}`, "", continuity].join("\n").trim();
}

/**
 * Build a complete series plan, given the chapter reference and a verse
 * provider that returns the entire chapter's text.
 *
 * @param {object} args
 * @param {string} args.chapterReference  e.g. "John 3"
 * @param {number} args.parts
 * @param {string} args.translation
 * @param {(verseRange: string) => Promise<BibleVerse[]>} args.fetchVerses
 *        Async function the route layer wires up to scriptureApi.lookupVerses.
 * @returns {Promise<SeriesPlan>}
 */
export async function buildSeriesPlan({ chapterReference, parts, translation, fetchVerses }) {
  const parsed = normalizeReference(chapterReference);
  if (!parsed) throw new Error(`Could not parse chapter reference: ${chapterReference}`);

  // Determine the verse window to partition. With no verse part ("John 3")
  // it's the whole chapter; with a verse range ("John 3:5-12") it's exactly
  // that span, and with a single verse ("John 3:16") it's a one-verse window.
  // Previously a range was rejected, forcing whole-chapter splits — so a user
  // asking for 3 videos of John 3:1-5 got the entire 36-verse chapter split
  // into 3 instead.
  const chapterVerseCount = getChapterVerseCount(parsed.book.name, parsed.chapter);
  const hasRange = parsed.verseFrom != null;
  const spanStart = hasRange ? parsed.verseFrom : 1;
  const spanEnd = hasRange
    ? Math.min(parsed.verseTo ?? parsed.verseFrom, chapterVerseCount)
    : chapterVerseCount;
  const spanVerseCount = Math.max(1, spanEnd - spanStart + 1);

  const requestedParts = clampPartsCount(parts, spanVerseCount);
  const ranges = planVerseRanges(spanVerseCount, requestedParts, spanStart);
  // Source of truth for the part count is the ranges we actually produced —
  // clampPartsCount can ask for more parts than a short span has verses, and
  // planVerseRanges caps at one verse per part. Deriving totalParts here keeps
  // captions ("Part X of N") and segment count in lock-step.
  const totalParts = ranges.length;

  const spanReference = hasRange
    ? (spanEnd > spanStart
        ? `${parsed.book.name} ${parsed.chapter}:${spanStart}-${spanEnd}`
        : `${parsed.book.name} ${parsed.chapter}:${spanStart}`)
    : `${parsed.book.name} ${parsed.chapter}`;

  /** @type {SeriesSegment[]} */
  const segments = [];

  for (let i = 0; i < ranges.length; i += 1) {
    const { from, to } = ranges[i];
    const segmentRef = from === to
      ? `${parsed.book.name} ${parsed.chapter}:${from}`
      : `${parsed.book.name} ${parsed.chapter}:${from}-${to}`;

    const verses = await fetchVerses(segmentRef);
    if (!Array.isArray(verses) || !verses.length) {
      throw new Error(`No verses returned for ${segmentRef}`);
    }

    const segmentParsed = normalizeReference(segmentRef);
    const youVersionUrl = segmentParsed ? buildYouVersionUrl(segmentParsed, translation) : "";

    const hook = extractHook(verses[0]?.text);
    const partNumber = i + 1;
    const caption = buildSegmentCaption({
      partNumber,
      totalParts,
      reference: segmentRef,
      verses,
      hook,
      youVersionUrl,
      isLast: partNumber === totalParts,
    });

    segments.push({
      partNumber,
      totalParts,
      reference: segmentRef,
      verseFrom: from,
      verseTo: to,
      verses,
      hook,
      caption,
      youVersionUrl,
    });
  }

  const seriesId = `series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    seriesId,
    chapterReference: spanReference,
    book: parsed.book.name,
    chapter: parsed.chapter,
    translation,
    totalParts,
    segments,
  };
}
