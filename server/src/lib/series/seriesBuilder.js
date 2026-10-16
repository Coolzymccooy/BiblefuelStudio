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
import { extractSpeakableVerseText } from "./speakable.js";

const MAX_PARTS = 12;
// A narrator reads about 12.75 characters a second: 22 seconds is the 280
// characters a short has always spoken.
const SPOKEN_CHARS_PER_SECOND = 12.75;
// "Part 1 of 2 — 1 John 2:1-2" before the verses, with a little room for
// a slow voice.
const INTRO_OUTRO_SECONDS = 3;
// Auto lengthens every part by this much at a time until the passage fits in
// MAX_PARTS videos.
const STRETCH_STEP = 1.1;
const DEFAULT_TARGET_SECONDS = 22;
const DEFAULT_MAX_RENDER_SECONDS = 30;
// Plan parts to at most 90% of the render limit: the timing is an estimate,
// and a slow voice past the limit would have its last words cut off.
const RENDER_SAFETY = 0.9;
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
 * A plan the user asked for that cannot be made, with a reason they can act
 * on. `code` is TOO_MANY_PARTS or PART_TOO_LONG.
 */
export class SeriesPlanError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "SeriesPlanError";
    this.code = code;
  }
}

/**
 * How many characters of verse a video of `seconds` can speak.
 * @param {number} seconds
 * @returns {number}
 */
export function charBudgetFor(seconds) {
  return Math.max(40, Math.floor(Number(seconds) * SPOKEN_CHARS_PER_SECOND));
}

/**
 * About how long a part runs when its verses are `chars` characters long,
 * counting the part intro and the closing line.
 * @param {number} chars
 * @returns {number} whole seconds
 */
export function spokenSeconds(chars) {
  return Math.ceil(Math.max(0, chars) / SPOKEN_CHARS_PER_SECOND) + INTRO_OUTRO_SECONDS;
}

/** @param {unknown} text */
function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/** @param {BibleVerse[]} verses */
function spokenLength(verses) {
  return verses.map((v) => cleanText(v.text)).filter(Boolean).join(" ").length;
}

// A full stop, question or exclamation mark, then any closing quotes or
// brackets.
const SENTENCE_END = /[.!?]["'’”)\]]*$/;

/**
 * Whether a verse finishes its sentence. 1 John 2:1 ends "the righteous:" and
 * its sentence runs on into verse 2, so it does not.
 * @param {string} text
 * @returns {boolean}
 */
export function endsSentence(text) {
  return SENTENCE_END.test(cleanText(text));
}

/**
 * Verses grouped so no group ends mid-sentence. A group also closes once it
 * reaches `maxChars`, so a translation without verse-end punctuation can never
 * run the whole passage into one group.
 * @param {BibleVerse[]} verses
 * @param {number} maxChars
 * @returns {BibleVerse[][]}
 */
export function groupSentences(verses, maxChars) {
  /** @type {BibleVerse[][]} */
  const groups = [];
  /** @type {BibleVerse[]} */
  let current = [];
  for (const verse of verses) {
    current = [...current, verse];
    if (endsSentence(verse.text) || spokenLength(current) >= maxChars) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Split a passage into parts without ever splitting a sentence.
 *  - "auto": as many whole sentences as fit in `budgetChars`.
 *  - a number N: at least N verses each (more when a sentence runs on).
 *  - "one": the whole passage.
 * @param {BibleVerse[]} verses
 * @param {{ versesPerPart: "auto" | "one" | number, budgetChars: number, sentenceMaxChars?: number }} opts
 *        sentenceMaxChars: the longest a sentence may run before it is broken
 *        at a verse (default budgetChars)
 * @returns {BibleVerse[][]}
 */
export function packParts(verses, { versesPerPart, budgetChars, sentenceMaxChars = budgetChars }) {
  if (!verses.length) return [];
  if (versesPerPart === "one") return [[...verses]];
  /** @type {BibleVerse[][]} */
  const parts = [];
  /** @type {BibleVerse[]} */
  let current = [];
  for (const group of groupSentences(verses, sentenceMaxChars)) {
    if (versesPerPart === "auto") {
      if (current.length && spokenLength([...current, ...group]) > budgetChars) {
        parts.push(current);
        current = [];
      }
      current = [...current, ...group];
    } else {
      current = [...current, ...group];
      if (current.length >= versesPerPart) {
        parts.push(current);
        current = [];
      }
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

/**
 * Auto's parts: the video length first; when that needs more than MAX_PARTS
 * videos, every part grows a little at a time until the passage fits.
 * @param {BibleVerse[]} verses
 * @param {number} targetSeconds
 * @param {number} sentenceMaxChars  the longest a sentence may run before it is broken
 * @returns {{ parts: BibleVerse[][], stretched: boolean }}
 */
function packAuto(verses, targetSeconds, sentenceMaxChars) {
  let budgetChars = charBudgetFor(targetSeconds);
  let parts = packParts(verses, { versesPerPart: "auto", budgetChars, sentenceMaxChars });
  let stretched = false;
  while (parts.length > MAX_PARTS) {
    budgetChars = Math.ceil(budgetChars * STRETCH_STEP);
    parts = packParts(verses, { versesPerPart: "auto", budgetChars, sentenceMaxChars });
    stretched = true;
  }
  return { parts, stretched };
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
 * What one part's video says: the part and its reference, then the verses.
 * Nothing follows the verses: the YouVersion link is in the post caption,
 * and reading "Read on YouVersion" out (and showing it as the last caption)
 * ended every video on an advert rather than on scripture.
 *
 * @param {{ partNumber: number, totalParts: number, reference: string, verses: BibleVerse[] }} segment
 * @param {number} maxChars  guard for the spoken verses (the plan already fits them)
 * @returns {{ hook: string, verse: string, reference: string, reflection: string, cta: string }}
 */
export function buildPartScript(segment, maxChars) {
  return {
    hook: `Part ${segment.partNumber} of ${segment.totalParts} — ${segment.reference}`,
    verse: extractSpeakableVerseText(segment.verses, maxChars),
    reference: "",
    reflection: "",
    cta: "",
  };
}

/**
 * Build a complete series plan, given the chapter reference and a verse
 * provider that returns the entire chapter's text.
 *
 * @param {object} args
 * @param {string} args.chapterReference  e.g. "John 3"
 * @param {"auto" | "one" | number} [args.versesPerPart="auto"]
 * @param {number} [args.durationSec=22]  the video length Auto aims for
 * @param {number} [args.maxRenderSeconds=30]  the longest video the renderer makes
 * @param {string} args.translation
 * @param {(verseRange: string) => Promise<BibleVerse[]>} args.fetchVerses
 *        Async function the route layer wires up to scriptureApi.lookupVerses.
 * @returns {Promise<SeriesPlan>}
 * @throws {SeriesPlanError} when the choice needs more than 12 videos, or a
 *         part runs longer than a render allows
 */
export async function buildSeriesPlan({
  chapterReference,
  versesPerPart = "auto",
  durationSec = DEFAULT_TARGET_SECONDS,
  maxRenderSeconds = DEFAULT_MAX_RENDER_SECONDS,
  translation,
  fetchVerses,
}) {
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

  const book = parsed.book.name;
  const rangeRef = (from, to) => (from === to ? `${book} ${parsed.chapter}:${from}` : `${book} ${parsed.chapter}:${from}-${to}`);
  const spanReference = hasRange ? rangeRef(spanStart, spanEnd) : `${book} ${parsed.chapter}`;

  // One fetch for the whole passage: where a part ends depends on where the
  // sentences end, which is only known once the text is in hand.
  const fetched = await fetchVerses(rangeRef(spanStart, spanEnd));
  const verses = (Array.isArray(fetched) ? fetched : []).filter((v) => {
    const n = Number(v?.verse);
    return cleanText(v?.text) && Number.isFinite(n) && n >= spanStart && n <= spanEnd;
  });
  if (!verses.length) throw new Error(`No verses returned for ${spanReference}`);

  const targetSeconds = Number(durationSec) || DEFAULT_TARGET_SECONDS;
  const auto = versesPerPart === "auto";
  const partLimitSeconds = Math.floor(maxRenderSeconds * RENDER_SAFETY);
  // The verses a part may hold before the voice would pass the render limit.
  const partLimitVerseSeconds = Math.max(1, partLimitSeconds - INTRO_OUTRO_SECONDS);
  // A sentence stays whole up to the longest video the server makes, in
  // every mode; only one longer than that is broken, at a verse.
  const sentenceMaxChars = charBudgetFor(partLimitVerseSeconds);
  const { parts, stretched } = auto
    // Auto never aims past what the server can render.
    ? packAuto(verses, Math.min(targetSeconds, partLimitVerseSeconds), sentenceMaxChars)
    : {
        parts: packParts(verses, { versesPerPart, budgetChars: charBudgetFor(targetSeconds), sentenceMaxChars }),
        stretched: false,
      };

  if (parts.length > MAX_PARTS) {
    const per = versesPerPart === 1 ? "1 verse" : `${versesPerPart} verses`;
    throw new SeriesPlanError(
      "TOO_MANY_PARTS",
      `${spanReference} at ${per} per video makes ${parts.length} videos, and a series holds at most ${MAX_PARTS}. Choose more verses per video, Auto, or a shorter passage.`,
    );
  }

  const totalParts = parts.length;
  /** @type {SeriesSegment[]} */
  const segments = parts.map((partVerses, i) => {
    const partNumber = i + 1;
    const seconds = spokenSeconds(spokenLength(partVerses));
    const from = Number(partVerses[0].verse);
    const to = Number(partVerses[partVerses.length - 1].verse);
    const reference = rangeRef(from, to);
    if (seconds > partLimitSeconds) {
      throw new SeriesPlanError(
        "PART_TOO_LONG",
        partVerses.length === 1
          ? `${reference} alone runs about ${seconds} s, and videos on this server stop at ${maxRenderSeconds} s, so it cannot be made into a video here.`
          : `Part ${partNumber} would run about ${seconds} s, and videos stop at ${maxRenderSeconds} s. Choose fewer verses per video or a shorter passage.`,
      );
    }
    const segmentParsed = normalizeReference(reference);
    const youVersionUrl = segmentParsed ? buildYouVersionUrl(segmentParsed, translation) : "";
    const hook = extractHook(partVerses[0].text);
    const caption = buildSegmentCaption({
      partNumber,
      totalParts,
      reference,
      verses: partVerses,
      hook,
      youVersionUrl,
      isLast: partNumber === totalParts,
    });
    return {
      partNumber,
      totalParts,
      reference,
      verseFrom: from,
      verseTo: to,
      verses: partVerses,
      hook,
      caption,
      youVersionUrl,
      seconds,
    };
  });

  const seriesId = `series_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    seriesId,
    chapterReference: spanReference,
    book,
    chapter: parsed.chapter,
    translation,
    totalParts,
    versesPerPart,
    targetSeconds,
    stretched,
    segments,
  };
}
