/**
 * Caption paging — how a passage is shown a page at a time.
 *
 * Six boxed lines of Philippians 4:6-7 parked mid-frame looked like a notice
 * pinned over the picture. A page is now one verse (or, for a long verse, one
 * clause-bounded part of it) on at most two balanced lines, and the pages of
 * a passage take turns across its window.
 *
 * Scripture is burned verbatim: paging only chooses where lines and pages
 * break. It never edits, drops or reorders a word — every function here keeps
 * `pages.join(" ")` equal to the text it was given.
 */

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const sameWords = (a, b) => squash(a) === squash(b);

// Where a page may end, strongest first: a sentence or clause end, then a
// comma, then (only if nothing else fits) between any two words.
const STRONG_BREAK = /[.?!;:]$/;
const COMMA_BREAK = /,$/;

/**
 * Split a piece that's too long for one page at the break nearest its middle,
 * preferring a clause end to a comma to a bare word gap.
 */
function fit(piece, maxChars) {
  if (piece.length <= maxChars) return [piece];
  const tokens = piece.split(" ");
  if (tokens.length < 2) return [piece];

  const mid = piece.length / 2;
  let best = null;
  let pos = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    pos += tokens[i].length + (i > 0 ? 1 : 0);
    const rank = STRONG_BREAK.test(tokens[i]) ? 0 : COMMA_BREAK.test(tokens[i]) ? 1 : 2;
    const score = rank * piece.length + Math.abs(pos - mid);
    if (!best || score < best.score) best = { score, at: i + 1 };
  }
  const left = tokens.slice(0, best.at).join(" ");
  const right = tokens.slice(best.at).join(" ");
  return [...fit(left, maxChars), ...fit(right, maxChars)];
}

/**
 * The pages of one drop, in order.
 *
 * Uses the drop's individual verses when it has them and they say exactly
 * what its text says; otherwise the text, split at sentence ends. Either way
 * a page longer than `maxChars` is broken again at a clause.
 *
 * @param {{ text?: string, verses?: string[] }} drop
 * @param {number} maxChars
 * @returns {string[]}
 */
export function captionPages(drop, maxChars) {
  const text = squash(drop?.text);
  if (!text) return [];
  const verses = Array.isArray(drop?.verses) ? drop.verses.map(squash).filter(Boolean) : [];
  const pieces = verses.length && sameWords(verses.join(" "), text)
    ? verses
    : text.split(/(?<=[.?!])\s+/).filter(Boolean);
  return pieces.flatMap((p) => fit(p, maxChars));
}

/**
 * One page as one line, or two lines broken at the word gap nearest the
 * middle, so the pair reads as a balanced block rather than a long line and
 * a stub.
 *
 * @returns {string[]}
 */
export function balanceLines(page, maxLineChars) {
  const text = squash(page);
  if (text.length <= maxLineChars) return [text];
  const mid = text.length / 2;
  let at = -1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
    if (at === -1 || Math.abs(i - mid) < Math.abs(at - mid)) at = i;
  }
  if (at === -1) return [text];
  return [text.slice(0, at), text.slice(at + 1)];
}

/** Below this a held page can't be read before it goes. */
const MIN_PAGE_SEC = 4;

/**
 * Share [start, end] between pages by length, back to back. A held verse
 * gives every page a readable minimum first, then the rest by length, so a
 * short "Jesus wept." isn't gone before it's seen. While spoken, pass
 * `minSec: 0`: the pages then follow the voice, which reads by length too.
 *
 * @param {{ minSec?: number }} [opts]
 * @returns {Array<{ start: number, end: number }>}
 */
export function pageWindows(start, end, pages, { minSec = MIN_PAGE_SEC } = {}) {
  const total = Math.max(0, end - start);
  const n = pages.length;
  if (n === 0) return [];
  const base = Math.min(Math.max(0, minSec), total / n);
  const spare = total - base * n;
  const lengths = pages.map((p) => Math.max(1, squash(p).length));
  const sum = lengths.reduce((a, b) => a + b, 0);
  const out = [];
  let t = start;
  pages.forEach((_, i) => {
    const next = i === n - 1 ? end : t + base + (spare * lengths[i]) / sum;
    out.push({ start: t, end: next });
    t = next;
  });
  return out;
}
