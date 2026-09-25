/**
 * Bible reference parsing and metadata.
 *
 * Provides:
 *   - BIBLE_BOOKS: canonical 66-book list with chapter counts
 *   - BIBLE_VERSE_COUNTS: per-chapter verse counts (KJV)
 *   - USFM book codes (for YouVersion + API.Bible passage IDs)
 *   - normalizeReference(input): "jn 3:16-17" -> { book, chapter, verseFrom, verseTo, canonical }
 *
 * Pure module — no I/O, no external calls. Safe to use from any context.
 *
 * Reference data adapted from the lumina-presenter Bible engine, with USFM
 * codes added for YouVersion deep-linking and api.bible passage IDs.
 */

/** @typedef {{ name: string, usfm: string, chapters: number }} BibleBook */

/** @type {ReadonlyArray<BibleBook>} */
export const BIBLE_BOOKS = Object.freeze([
  { name: "Genesis", usfm: "GEN", chapters: 50 },
  { name: "Exodus", usfm: "EXO", chapters: 40 },
  { name: "Leviticus", usfm: "LEV", chapters: 27 },
  { name: "Numbers", usfm: "NUM", chapters: 36 },
  { name: "Deuteronomy", usfm: "DEU", chapters: 34 },
  { name: "Joshua", usfm: "JOS", chapters: 24 },
  { name: "Judges", usfm: "JDG", chapters: 21 },
  { name: "Ruth", usfm: "RUT", chapters: 4 },
  { name: "1 Samuel", usfm: "1SA", chapters: 31 },
  { name: "2 Samuel", usfm: "2SA", chapters: 24 },
  { name: "1 Kings", usfm: "1KI", chapters: 22 },
  { name: "2 Kings", usfm: "2KI", chapters: 25 },
  { name: "1 Chronicles", usfm: "1CH", chapters: 29 },
  { name: "2 Chronicles", usfm: "2CH", chapters: 36 },
  { name: "Ezra", usfm: "EZR", chapters: 10 },
  { name: "Nehemiah", usfm: "NEH", chapters: 13 },
  { name: "Esther", usfm: "EST", chapters: 10 },
  { name: "Job", usfm: "JOB", chapters: 42 },
  { name: "Psalms", usfm: "PSA", chapters: 150 },
  { name: "Proverbs", usfm: "PRO", chapters: 31 },
  { name: "Ecclesiastes", usfm: "ECC", chapters: 12 },
  { name: "Song of Solomon", usfm: "SNG", chapters: 8 },
  { name: "Isaiah", usfm: "ISA", chapters: 66 },
  { name: "Jeremiah", usfm: "JER", chapters: 52 },
  { name: "Lamentations", usfm: "LAM", chapters: 5 },
  { name: "Ezekiel", usfm: "EZK", chapters: 48 },
  { name: "Daniel", usfm: "DAN", chapters: 12 },
  { name: "Hosea", usfm: "HOS", chapters: 14 },
  { name: "Joel", usfm: "JOL", chapters: 3 },
  { name: "Amos", usfm: "AMO", chapters: 9 },
  { name: "Obadiah", usfm: "OBA", chapters: 1 },
  { name: "Jonah", usfm: "JON", chapters: 4 },
  { name: "Micah", usfm: "MIC", chapters: 7 },
  { name: "Nahum", usfm: "NAM", chapters: 3 },
  { name: "Habakkuk", usfm: "HAB", chapters: 3 },
  { name: "Zephaniah", usfm: "ZEP", chapters: 3 },
  { name: "Haggai", usfm: "HAG", chapters: 2 },
  { name: "Zechariah", usfm: "ZEC", chapters: 14 },
  { name: "Malachi", usfm: "MAL", chapters: 4 },
  { name: "Matthew", usfm: "MAT", chapters: 28 },
  { name: "Mark", usfm: "MRK", chapters: 16 },
  { name: "Luke", usfm: "LUK", chapters: 24 },
  { name: "John", usfm: "JHN", chapters: 21 },
  { name: "Acts", usfm: "ACT", chapters: 28 },
  { name: "Romans", usfm: "ROM", chapters: 16 },
  { name: "1 Corinthians", usfm: "1CO", chapters: 16 },
  { name: "2 Corinthians", usfm: "2CO", chapters: 13 },
  { name: "Galatians", usfm: "GAL", chapters: 6 },
  { name: "Ephesians", usfm: "EPH", chapters: 6 },
  { name: "Philippians", usfm: "PHP", chapters: 4 },
  { name: "Colossians", usfm: "COL", chapters: 4 },
  { name: "1 Thessalonians", usfm: "1TH", chapters: 5 },
  { name: "2 Thessalonians", usfm: "2TH", chapters: 3 },
  { name: "1 Timothy", usfm: "1TI", chapters: 6 },
  { name: "2 Timothy", usfm: "2TI", chapters: 4 },
  { name: "Titus", usfm: "TIT", chapters: 3 },
  { name: "Philemon", usfm: "PHM", chapters: 1 },
  { name: "Hebrews", usfm: "HEB", chapters: 13 },
  { name: "James", usfm: "JAS", chapters: 5 },
  { name: "1 Peter", usfm: "1PE", chapters: 5 },
  { name: "2 Peter", usfm: "2PE", chapters: 3 },
  { name: "1 John", usfm: "1JN", chapters: 5 },
  { name: "2 John", usfm: "2JN", chapters: 1 },
  { name: "3 John", usfm: "3JN", chapters: 1 },
  { name: "Jude", usfm: "JUD", chapters: 1 },
  { name: "Revelation", usfm: "REV", chapters: 22 },
]);

/** KJV per-chapter verse counts. Index 0 = chapter 1. */
const BIBLE_VERSE_COUNTS = Object.freeze({
  "Genesis":       [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  "Exodus":        [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  "Leviticus":     [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  "Numbers":       [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  "Deuteronomy":   [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  "Joshua":        [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  "Judges":        [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  "Ruth":          [22,23,18,22],
  "1 Samuel":      [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
  "2 Samuel":      [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  "1 Kings":       [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  "2 Kings":       [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  "1 Chronicles":  [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  "2 Chronicles":  [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  "Ezra":          [11,70,13,24,17,22,28,36,15,44],
  "Nehemiah":      [11,20,32,23,19,19,73,18,38,39,36,47,31],
  "Esther":        [22,23,15,17,14,14,10,17,32,3],
  "Job":           [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  "Psalms":        [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  "Proverbs":      [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],
  "Ecclesiastes":  [18,26,22,16,20,12,29,17,18,20,10,14],
  "Song of Solomon":[17,17,11,16,16,13,13,14],
  "Isaiah":        [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  "Jeremiah":      [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  "Lamentations":  [22,22,66,22,22],
  "Ezekiel":       [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  "Daniel":        [21,49,30,37,31,28,28,27,27,21,45,13],
  "Hosea":         [11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  "Joel":          [20,32,21],
  "Amos":          [15,16,15,13,27,14,17,14,15],
  "Obadiah":       [21],
  "Jonah":         [17,10,10,11],
  "Micah":         [16,13,12,13,15,16,20],
  "Nahum":         [15,13,19],
  "Habakkuk":      [17,20,19],
  "Zephaniah":     [18,15,20],
  "Haggai":        [15,23],
  "Zechariah":     [21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  "Malachi":       [14,17,18,6],
  "Matthew":       [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  "Mark":          [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  "Luke":          [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  "John":          [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  "Acts":          [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  "Romans":        [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  "1 Corinthians": [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  "2 Corinthians": [24,17,18,18,21,18,16,24,15,18,33,21,14],
  "Galatians":     [24,21,29,31,26,18],
  "Ephesians":     [23,22,21,32,33,24],
  "Philippians":   [30,30,21,23],
  "Colossians":    [29,23,25,18],
  "1 Thessalonians":[10,20,13,18,28],
  "2 Thessalonians":[12,17,18],
  "1 Timothy":     [20,15,16,16,25,21],
  "2 Timothy":     [18,26,17,22],
  "Titus":         [16,15,15],
  "Philemon":      [25],
  "Hebrews":       [14,18,19,16,14,20,28,13,28,39,40,29,25],
  "James":         [27,26,18,17,20],
  "1 Peter":       [25,25,22,19,14],
  "2 Peter":       [21,22,18],
  "1 John":        [10,29,24,21,21],
  "2 John":        [13],
  "3 John":        [14],
  "Jude":          [25],
  "Revelation":    [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
});

/** Common abbreviations and aliases. Lower-case only. */
const BOOK_ALIASES = Object.freeze({
  "gen": "Genesis", "ge": "Genesis",
  "exo": "Exodus", "ex": "Exodus",
  "lev": "Leviticus", "lv": "Leviticus",
  "num": "Numbers", "nu": "Numbers", "nm": "Numbers",
  "deu": "Deuteronomy", "dt": "Deuteronomy", "deut": "Deuteronomy",
  "jos": "Joshua", "josh": "Joshua",
  "jdg": "Judges", "judg": "Judges",
  "rut": "Ruth", "ru": "Ruth",
  "1sa": "1 Samuel", "1sam": "1 Samuel", "1 sam": "1 Samuel",
  "2sa": "2 Samuel", "2sam": "2 Samuel", "2 sam": "2 Samuel",
  "1ki": "1 Kings", "1kgs": "1 Kings", "1 kgs": "1 Kings",
  "2ki": "2 Kings", "2kgs": "2 Kings", "2 kgs": "2 Kings",
  "1ch": "1 Chronicles", "1chr": "1 Chronicles", "1 chr": "1 Chronicles",
  "2ch": "2 Chronicles", "2chr": "2 Chronicles", "2 chr": "2 Chronicles",
  "ezr": "Ezra",
  "neh": "Nehemiah",
  "est": "Esther", "esth": "Esther",
  "ps": "Psalms", "psa": "Psalms", "psalm": "Psalms",
  "pr": "Proverbs", "prov": "Proverbs",
  "ecc": "Ecclesiastes", "eccl": "Ecclesiastes", "qoh": "Ecclesiastes",
  "sng": "Song of Solomon", "song": "Song of Solomon", "sos": "Song of Solomon",
  "isa": "Isaiah", "is": "Isaiah",
  "jer": "Jeremiah",
  "lam": "Lamentations",
  "ezk": "Ezekiel", "eze": "Ezekiel", "ezek": "Ezekiel",
  "dan": "Daniel", "dn": "Daniel",
  "hos": "Hosea",
  "jol": "Joel", "joe": "Joel",
  "amo": "Amos", "am": "Amos",
  "oba": "Obadiah", "ob": "Obadiah",
  "jon": "Jonah", "jnh": "Jonah",
  "mic": "Micah",
  "nam": "Nahum", "nah": "Nahum",
  "hab": "Habakkuk",
  "zep": "Zephaniah", "zeph": "Zephaniah",
  "hag": "Haggai",
  "zec": "Zechariah", "zech": "Zechariah",
  "mal": "Malachi",
  "mat": "Matthew", "mt": "Matthew", "matt": "Matthew",
  "mrk": "Mark", "mk": "Mark",
  "luk": "Luke", "lk": "Luke",
  "jhn": "John", "jn": "John", "joh": "John",
  "act": "Acts",
  "rom": "Romans", "ro": "Romans",
  "1co": "1 Corinthians", "1cor": "1 Corinthians", "1 cor": "1 Corinthians",
  "2co": "2 Corinthians", "2cor": "2 Corinthians", "2 cor": "2 Corinthians",
  "gal": "Galatians",
  "eph": "Ephesians",
  "php": "Philippians", "phil": "Philippians",
  "col": "Colossians",
  "1th": "1 Thessalonians", "1thes": "1 Thessalonians", "1 thes": "1 Thessalonians",
  "2th": "2 Thessalonians", "2thes": "2 Thessalonians", "2 thes": "2 Thessalonians",
  "1ti": "1 Timothy", "1tim": "1 Timothy", "1 tim": "1 Timothy",
  "2ti": "2 Timothy", "2tim": "2 Timothy", "2 tim": "2 Timothy",
  "tit": "Titus",
  "phm": "Philemon", "phlm": "Philemon",
  "heb": "Hebrews",
  "jas": "James", "jam": "James",
  "1pe": "1 Peter", "1pet": "1 Peter", "1 pet": "1 Peter",
  "2pe": "2 Peter", "2pet": "2 Peter", "2 pet": "2 Peter",
  "1jn": "1 John", "1jo": "1 John", "1 jn": "1 John", "1 john": "1 John",
  "2jn": "2 John", "2jo": "2 John", "2 jn": "2 John", "2 john": "2 John",
  "3jn": "3 John", "3jo": "3 John", "3 jn": "3 John", "3 john": "3 John",
  "jud": "Jude", "jude": "Jude",
  "rev": "Revelation", "rv": "Revelation", "apoc": "Revelation",
});

const BOOK_BY_NAME = (() => {
  /** @type {Record<string, BibleBook>} */
  const map = {};
  for (const book of BIBLE_BOOKS) map[book.name.toLowerCase()] = book;
  return Object.freeze(map);
})();

const BOOK_PREFIXES = (() => {
  // Sorted longest-first so "1 Corinthians" wins over "1" alone.
  return [...BIBLE_BOOKS]
    .map((b) => b.name)
    .sort((a, b) => b.length - a.length)
    .map((name) => ({ name, lower: name.toLowerCase() }));
})();

/**
 * Resolve any book input (full name, abbreviation, alias) to a canonical book.
 * @param {string} input
 * @returns {BibleBook | null}
 */
export function resolveBook(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ");
  const aliasHit = BOOK_ALIASES[collapsed] || BOOK_ALIASES[collapsed.replace(/\./g, "")];
  if (aliasHit) return BOOK_BY_NAME[aliasHit.toLowerCase()] || null;
  if (BOOK_BY_NAME[collapsed]) return BOOK_BY_NAME[collapsed];
  return null;
}

/** @typedef {{ book: BibleBook, chapter: number, verseFrom: number | null, verseTo: number | null, canonical: string }} ParsedReference */

/**
 * Parse a free-form Bible reference into structured form.
 * Accepts:
 *   "John 3:16"          -> single verse
 *   "John 3:16-17"       -> verse range
 *   "John 3"             -> entire chapter
 *   "Jn 3:16"            -> abbreviation
 *   "1 cor 13:4-7"       -> numbered book + range
 *
 * @param {string} input
 * @returns {ParsedReference | null}
 */
export function normalizeReference(input) {
  const raw = String(input || "")
    .replace(/[–—]/g, "-") // en/em dash -> hyphen
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();

  // Try canonical book prefix match first (longest wins).
  let bookName = null;
  let remainder = "";
  for (const { name, lower: low } of BOOK_PREFIXES) {
    if (lower.startsWith(low + " ") || lower === low) {
      bookName = name;
      remainder = raw.slice(name.length).trim();
      break;
    }
    if (lower.startsWith(low + ":") || lower.startsWith(low + "-")) {
      bookName = name;
      remainder = raw.slice(name.length).trim();
      break;
    }
  }

  // Fall back to alias resolution by taking the first 1-3 words.
  if (!bookName) {
    const words = raw.split(" ");
    for (let take = Math.min(3, words.length); take >= 1; take -= 1) {
      const candidate = words.slice(0, take).join(" ");
      const resolved = resolveBook(candidate);
      if (resolved) {
        bookName = resolved.name;
        remainder = words.slice(take).join(" ").trim();
        break;
      }
    }
  }

  if (!bookName) return null;
  const book = BOOK_BY_NAME[bookName.toLowerCase()];
  if (!book) return null;

  if (!remainder) return null;

  const match = remainder.match(/^(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!match) return null;

  const chapter = Number(match[1]);
  if (!Number.isFinite(chapter) || chapter < 1 || chapter > book.chapters) return null;

  const verseFromRaw = match[2];
  const verseToRaw = match[3];

  if (!verseFromRaw) {
    return {
      book,
      chapter,
      verseFrom: null,
      verseTo: null,
      canonical: `${book.name} ${chapter}`,
    };
  }

  const verseFrom = Number(verseFromRaw);
  const maxVerse = getChapterVerseCount(book.name, chapter);
  if (!Number.isFinite(verseFrom) || verseFrom < 1 || verseFrom > maxVerse) return null;

  const verseTo = verseToRaw ? Number(verseToRaw) : verseFrom;
  if (!Number.isFinite(verseTo) || verseTo < verseFrom || verseTo > maxVerse) return null;

  const canonical = verseTo > verseFrom
    ? `${book.name} ${chapter}:${verseFrom}-${verseTo}`
    : `${book.name} ${chapter}:${verseFrom}`;

  return { book, chapter, verseFrom, verseTo, canonical };
}

/**
 * Verse count for a specific chapter. Returns a sane fallback if the chapter
 * is out of range or the book is unknown.
 * @param {string} bookName
 * @param {number} chapter
 * @returns {number}
 */
export function getChapterVerseCount(bookName, chapter) {
  const counts = BIBLE_VERSE_COUNTS[bookName];
  if (!counts || counts.length === 0) return 30;
  const idx = Math.max(0, Math.min(counts.length - 1, Number(chapter || 1) - 1));
  return counts[idx] || 30;
}

/**
 * Build the API.Bible passage identifier for a reference.
 * Format: `<USFM>.<chapter>` or `<USFM>.<chapter>.<verse>` or
 * `<USFM>.<chapter>.<verseFrom>-<USFM>.<chapter>.<verseTo>`.
 *
 * @param {ParsedReference} ref
 * @returns {string}
 */
export function buildApiBiblePassageId(ref) {
  const usfm = ref.book.usfm;
  if (ref.verseFrom == null) return `${usfm}.${ref.chapter}`;
  if (ref.verseTo == null || ref.verseTo === ref.verseFrom) {
    return `${usfm}.${ref.chapter}.${ref.verseFrom}`;
  }
  return `${usfm}.${ref.chapter}.${ref.verseFrom}-${usfm}.${ref.chapter}.${ref.verseTo}`;
}
