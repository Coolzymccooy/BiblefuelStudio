/**
 * Per-frame curves for the finished cartoon, shared by the Remotion
 * composition (which evaluates them on every frame) and the tests: how loud
 * the music bed sits under speech and across the two cards, and how a line's
 * words are paged into short caption phrases. Pure and browser-safe: no Node
 * imports, so the composition bundle can load it.
 */

export const BED_BASE = 0.32;
export const BED_DUCK = 0.12;
/** The bed eases down to BED_DUCK over this long before a speech window and back up after it. */
export const DUCK_EASE_SEC = 0.2;
/** A pause longer than this between two words starts a new caption phrase. */
export const PAGE_GAP_SEC = 0.35;
/** At most this many words on screen at once. */
export const PAGE_MAX_WORDS = 7;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const ramp = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : (t - a) / (b - a));

/** 0 away from speech, 1 inside a (padded) speech window, eased at the edges. */
export function duckAmount(t, windows) {
  let amount = 0;
  for (const w of windows || []) {
    if (t < w.from - DUCK_EASE_SEC || t > w.to + DUCK_EASE_SEC) continue;
    const a = Math.min(smooth(ramp(t, w.from - DUCK_EASE_SEC, w.from)), 1 - smooth(ramp(t, w.to, w.to + DUCK_EASE_SEC)));
    amount = Math.max(amount, a);
  }
  return amount;
}

/**
 * The bed's volume at film time t: `base`, eased down to `duck` inside each
 * speech window, faded in across the verse card and out under the end card.
 * @param {{ base: number, duck: number, windows: {from:number,to:number}[] }} bed
 * @param {number} t film seconds
 * @param {{ inTo: number, outFrom: number, total: number }} span verse card end, end card start, film end
 */
export function bedVolume(bed, t, { inTo, outFrom, total }) {
  const level = bed.base - (bed.base - bed.duck) * duckAmount(t, bed.windows);
  const fadeIn = smooth(ramp(t, 0, inTo));
  const fadeOut = 1 - smooth(ramp(t, outFrom, total));
  return clamp01(level * fadeIn * fadeOut);
}

/** A word that ends a sentence: . ! or ? optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?]["'”’)\]]*$/;
const endsSentence = (w) => SENTENCE_END.test(String(w?.text || ""));

/**
 * Split a line's timed words into phrases for the screen: a new phrase after
 * each sentence end, at each pause, and every PAGE_MAX_WORDS words. Words in
 * one speech window are timed back to back, so the sentence rule is what keeps
 * "look! The" from sharing a phrase. A lone last word that was split off only
 * by the word limit takes one word from the full phrase before it, so it never
 * flashes up on its own and no phrase grows past the limit; a lone word after
 * a sentence end or a pause stays on its own.
 * @param {{text:string,start:number,end:number}[]} words
 * @returns {{text:string,start:number,end:number}[][]}
 */
export function captionPages(words) {
  const pages = [];
  for (const w of words || []) {
    const page = pages[pages.length - 1];
    const prev = page?.[page.length - 1];
    if (!page || page.length >= PAGE_MAX_WORDS || w.start - prev.end > PAGE_GAP_SEC || endsSentence(prev)) pages.push([w]);
    else page.push(w);
  }
  const last = pages[pages.length - 1];
  const before = pages[pages.length - 2];
  const tail = before?.[before.length - 1];
  const splitByLimitOnly = before && before.length === PAGE_MAX_WORDS && !endsSentence(tail) && last[0].start - tail.end <= PAGE_GAP_SEC;
  if (last?.length === 1 && splitByLimitOnly && before.length > 2) {
    return [...pages.slice(0, -2), before.slice(0, -1), [tail, ...last]];
  }
  return pages;
}
