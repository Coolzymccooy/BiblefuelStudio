import { normalizeReference } from "../bible/bibleReference.js";

/**
 * Bible references written the way a narrator says them
 * ("First Corinthians, chapter fifteen, verse ten") or the way a page prints
 * them ("1 Corinthians 15:10"). Pure: no I/O.
 */

const UNITS = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
});
const TENS = Object.freeze({
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
});
const ORDINAL_BOOK = Object.freeze({ first: "1", second: "2", third: "3", i: "1", ii: "2", iii: "3" });

/** "one hundred and nineteen" -> 119, "twenty-three" -> 23, "15" -> 15; null when not a number. */
export function wordsToNumber(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.replace(/-/g, " ").split(/\s+/).filter((w) => w && w !== "and");
  if (!parts.length) return null;
  let total = 0;
  let current = 0;
  for (const w of parts) {
    if (w in UNITS) current += UNITS[w];
    else if (w in TENS) current += TENS[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else return null;
  }
  total += current;
  return total;
}

const NUMBER_WORD = "(?:\\d+|(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and)[\\s-]*)+)";
const SPOKEN_RE = new RegExp(
  `^(?<book>(?:(?:first|second|third|i{1,3}|[123])\\s+)?[a-z]+(?:\\s+of\\s+[a-z]+)?)[\\s,]+chapter\\s+(?<chapter>${NUMBER_WORD})`
  + `(?:[\\s,]+(?:verses?)\\s+(?<from>${NUMBER_WORD})(?:\\s*(?:to|through|-)\\s*(?<to>${NUMBER_WORD}))?)?$`,
  "i",
);

function clean(text) {
  return String(text || "")
    .replace(/[*_`"“”‘’]/g, "")
    .replace(/[.!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bookWithDigits(book) {
  const words = book.trim().split(/\s+/);
  const lead = ORDINAL_BOOK[words[0].toLowerCase()];
  return lead ? [lead, ...words.slice(1)].join(" ") : words.join(" ");
}

/**
 * The reference a whole line names, or null. The line must be nothing but the
 * reference: "Paul wrote in First Corinthians" is narration, not a reference.
 * @returns {{ canonical: string, book: string, chapter: number, verseFrom: number|null, verseTo: number|null } | null}
 */
export function referenceOfLine(text) {
  const s = clean(text);
  if (!s || s.length > 80) return null;
  const spoken = SPOKEN_RE.exec(s);
  let candidate = s;
  if (spoken) {
    const { book, chapter, from, to } = spoken.groups;
    const ch = wordsToNumber(chapter);
    const vf = from ? wordsToNumber(from) : null;
    const vt = to ? wordsToNumber(to) : null;
    if (ch === null || (from && vf === null) || (to && vt === null)) return null;
    candidate = `${bookWithDigits(book)} ${ch}${vf ? `:${vf}` : ""}${vt ? `-${vt}` : ""}`;
  } else if (!/\d/.test(s)) {
    return null;
  }
  const ref = normalizeReference(bookWithDigits(candidate));
  if (!ref || !ref.chapter) return null;
  return {
    canonical: ref.canonical,
    book: ref.book.name,
    chapter: ref.chapter,
    verseFrom: ref.verseFrom ?? null,
    verseTo: ref.verseTo ?? null,
  };
}
