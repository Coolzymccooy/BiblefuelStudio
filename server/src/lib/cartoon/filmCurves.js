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

/**
 * Split a line's timed words into phrases for the screen: a new phrase at
 * each pause and every PAGE_MAX_WORDS words. A lone last word joins the
 * phrase before it rather than flashing up on its own.
 * @param {{text:string,start:number,end:number}[]} words
 * @returns {{text:string,start:number,end:number}[][]}
 */
export function captionPages(words) {
  const pages = [];
  for (const w of words || []) {
    const page = pages[pages.length - 1];
    const prev = page?.[page.length - 1];
    if (!page || page.length >= PAGE_MAX_WORDS || w.start - prev.end > PAGE_GAP_SEC) pages.push([w]);
    else page.push(w);
  }
  if (pages.length > 1 && pages[pages.length - 1].length === 1 && pages[pages.length - 2].length < PAGE_MAX_WORDS + 2) {
    const last = pages.pop();
    pages[pages.length - 1] = [...pages[pages.length - 1], ...last];
  }
  return pages;
}
